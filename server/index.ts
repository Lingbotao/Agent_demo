import * as dotenv from 'dotenv';
dotenv.config();
import express from "express";
import { query, unstable_v2_createSession, PermissionResult, CanUseTool } from "@tencent-ai/agent-sdk";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import * as db from "./db.js";
import { getWorkflow } from "./agents/graph.js";
import { initializeFaqKnowledge } from "./rag/faqLoader.js";
import adminRoutes from "./admin/routes.js";
import {
  attachUser,
  requireAuth,
  requireRole,
  hashPassword,
  verifyPassword,
  signToken,
  bootstrapDefaultAdmin,
  type AuthedRequest,
} from "./auth.js";

const execAsync = promisify(exec);

// 待处理的权限请求
interface PendingPermission {
  resolve: (result: PermissionResult) => void;
  reject: (error: Error) => void;
  toolName: string;
  input: Record<string, unknown>;
  sessionId: string;
  timestamp: number;
}

const pendingPermissions = new Map<string, PendingPermission>();

// 权限请求超时时间（5分钟）
const PERMISSION_TIMEOUT = 5 * 60 * 1000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(attachUser);

// 缓存可用模型列表
let cachedModels: Array<{ modelId: string; name: string; description?: string }> = [];

/** 根据不同 LLM Provider 确定默认模型 */
function getDefaultModel(): string {
  if (process.env.CODEBUDDY_API_KEY) return 'claude-sonnet-4';
  if (process.env.MINIMAX_API_KEY) return 'cs-agent';
  if (process.env.OPENAI_API_KEY) return 'cs-agent';
  return 'cs-agent'; // 兜底
}

const defaultModel = getDefaultModel();

// 健康检查
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ============= 自建鉴权 =============

interface RegisterBody {
  username?: string;
  password?: string;
  role?: 'admin' | 'agent' | 'visitor';
}

interface LoginBody {
  username?: string;
  password?: string;
}

// POST /api/auth/register —— 注册（仅 admin 可调用，用于创建客服/访客账号）
app.post("/api/auth/register", requireAuth, requireRole('admin'), async (req: AuthedRequest, res) => {
  const { username, password, role } = (req.body || {}) as RegisterBody;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: '用户名至少 3 位、密码至少 6 位' });
  }
  const safeRole: 'admin' | 'agent' | 'visitor' =
    role === 'admin' || role === 'agent' || role === 'visitor' ? role : 'visitor';

  if (db.getUserByUsername(username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }
  const password_hash = await hashPassword(password);
  const user = db.createUser({ username, password_hash, role: safeRole });
  res.json({
    id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at,
  });
});

// POST /api/auth/login —— 登录，签发 JWT
app.post("/api/auth/login", async (req, res) => {
  const { username, password } = (req.body || {}) as LoginBody;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  const user = db.getUserByUsername(username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  const token = signToken(user);
  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

// GET /api/auth/me —— 当前登录用户
app.get("/api/auth/me", requireAuth, (req: AuthedRequest, res) => {
  res.json({ user: req.user });
});

// 获取可用模型列表
app.get("/api/models", async (req, res) => {
  try {
    if (cachedModels.length === 0) {
      // 尝试通过 SDK 获取模型列表
      try {
        console.log("[Models] Creating session to fetch available models...");
        const session = await unstable_v2_createSession({ cwd: process.cwd() });
        const models = await session.getAvailableModels();
        if (models && Array.isArray(models)) {
          cachedModels = models;
          console.log("[Models] Got", models.length, "models from SDK");
        }
      } catch (sdkError: any) {
        console.log("[Models] SDK not available, using defaults:", sdkError.message?.slice(0, 100));
      }
      
      // SDK 不可用时，提供通用模型列表
      if (cachedModels.length === 0) {
        const minimaxModel = process.env.MINIMAX_MODEL || 'MiniMax-M1';
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        
        if (process.env.MINIMAX_API_KEY) {
          cachedModels = [{ modelId: minimaxModel, name: minimaxModel, description: 'MiniMax 模型' }];
        } else if (process.env.OPENAI_API_KEY) {
          cachedModels = [{ modelId: openaiModel, name: openaiModel, description: 'OpenAI 兼容模型' }];
        } else {
          cachedModels = [{ modelId: 'cs-agent', name: '智能客服 Agent (演示模式)', description: '未配置 LLM API Key，使用模拟回复' }];
        }
      }
    }
    
    res.json({ 
      models: cachedModels,
      defaultModel 
    });
  } catch (error: any) {
    console.error("[Models] Error:", error);
    res.json({
      models: [{ modelId: 'cs-agent', name: '智能客服 Agent', description: '默认模型' }],
      defaultModel: 'cs-agent',
    });
  }
});

// ============= 会话 API =============

// 获取所有会话（包含消息数量）
app.get("/api/sessions", (req, res) => {
  try {
    const sessions = db.getAllSessions();
    const sessionsWithMessages = sessions.map(session => {
      const messages = db.getMessagesBySession(session.id);
      return {
        ...session,
        messageCount: messages.length
      };
    });
    res.json({ sessions: sessionsWithMessages });
  } catch (error: any) {
    console.error("[Sessions] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 获取单个会话及其消息
app.get("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: "会话不存在" });
    }

    const messages = db.getMessagesBySession(sessionId);

    // 关联意图记录：把 conversation_intents 按 message_id 关联到对应 assistant 消息上
    // 注意：recordIntent 保存的是 user 消息的 id（因为意图是用户这句话触发的），
    // 前端要把 intent 渲染在它之后那个 assistant 回复上。
    const intentRows = db.getIntentsBySession(sessionId);
    // 按会话时间顺序遍历，找到每个 intent 关联的 user message 之后的第一个 assistant message
    const intentByAssistant = new Map<string, { intent: string; confidence: number }>();
    let pendingIntent: { intent: string; confidence: number } | null = null;
    for (const msg of messages) {
      if (msg.role === 'user') {
        const r = intentRows.find((r) => r.message_id === msg.id);
        pendingIntent = r ? { intent: r.intent, confidence: r.confidence } : null;
      } else if (msg.role === 'assistant' && pendingIntent) {
        intentByAssistant.set(msg.id, pendingIntent);
        pendingIntent = null;
      }
    }

    // 解析 tool_calls JSON，并附加 intent / workflowMeta
    const parsedMessages = messages.map(msg => ({
      ...msg,
      tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
      intent: msg.role === 'assistant' ? intentByAssistant.get(msg.id)?.intent ?? null : null,
      intent_confidence: msg.role === 'assistant' ? intentByAssistant.get(msg.id)?.confidence ?? null : null,
      used_faq: msg.role === 'assistant' ? !!msg.used_faq : false,
      should_escalate: msg.role === 'assistant' ? !!msg.should_escalate : false,
      ticket_id: msg.role === 'assistant' ? msg.ticket_id ?? null : null,
      faq_score: msg.role === 'assistant' ? msg.faq_score ?? null : null,
    }));

    res.json({ session, messages: parsedMessages });
  } catch (error: any) {
    console.error("[Session] Error:", error);
    res.status(500).json({ error: error?.message || "获取会话失败" });
  }
});

// 创建新会话
app.post("/api/sessions", (req, res) => {
  try {
    const { model = defaultModel, title = "新对话" } = req.body;
    const now = new Date().toISOString();
    
    const session = db.createSession({
      id: uuidv4(),
      title,
      model,
      created_at: now,
      updated_at: now
    });
    
    res.json({ session });
  } catch (error: any) {
    console.error("[Create Session] Error:", error);
    res.status(500).json({ error: error?.message || "创建会话失败" });
  }
});

// 更新会话
app.patch("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, model } = req.body;
    
    const success = db.updateSession(sessionId, { title, model });
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Update Session] Error:", error);
    res.status(500).json({ error: error?.message || "更新会话失败" });
  }
});

// 删除会话
app.delete("/api/sessions/:sessionId", (req, res) => {
  try {
    const { sessionId } = req.params;
    const success = db.deleteSession(sessionId);
    
    if (!success) {
      return res.status(404).json({ error: "会话不存在" });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    console.error("[Delete Session] Error:", error);
    res.status(500).json({ error: error?.message || "删除会话失败" });
  }
});

// ============= 聊天 API =============

// 权限响应 API
app.post("/api/permission-response", requireAuth, (req, res) => {
  const { requestId, behavior, message } = req.body;
  
  console.log(`[Permission] Response received: requestId=${requestId}, behavior=${behavior}`);
  
  const pending = pendingPermissions.get(requestId);
  if (!pending) {
    console.log(`[Permission] Request not found: ${requestId}`);
    return res.status(404).json({ error: "权限请求不存在或已超时" });
  }
  
  // 清除请求
  pendingPermissions.delete(requestId);
  
  if (behavior === 'allow') {
    pending.resolve({
      behavior: 'allow',
      updatedInput: pending.input
    });
  } else {
    pending.resolve({
      behavior: 'deny',
      message: message || '用户拒绝了此操作'
    });
  }
  
  res.json({ success: true });
});

// 发送消息并获取流式响应
app.post("/api/chat", requireAuth, async (req, res) => {
  const { sessionId, message, model, systemPrompt, cwd, permissionMode } = req.body;
  
  // 请求日志
  console.log(`\n[Chat] ========== 新请求 ==========`);
  console.log(`[Chat] SessionId: ${sessionId}`);
  console.log(`[Chat] Model: ${model}`);
  console.log(`[Chat] Message: ${message?.slice(0, 100)}${message?.length > 100 ? '...' : ''}`);
  console.log(`[Chat] CWD: ${cwd || 'default'}`);

  if (!message) {
    console.log(`[Chat] 错误: 消息为空`);
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  const now = new Date().toISOString();
  
  if (!session) {
    // 创建新会话
    console.log(`[Chat] 创建新会话`);
    session = db.createSession({
      id: sessionId || uuidv4(),
      title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
      model: model || defaultModel,
      sdk_session_id: null,  // 稍后从 SDK 获取
      created_at: now,
      updated_at: now
    });
  } else {
    console.log(`[Chat] 使用现有会话, SDK Session: ${session.sdk_session_id || 'none'}`);
  }

  const selectedModel = model || session.model;
  
  // 获取 SDK session ID（用于恢复对话）
  const sdkSessionId = session.sdk_session_id;

  // 创建用户消息 ID 和助手消息 ID
  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // 保存用户消息到数据库
  try {
    db.createMessage({
      id: userMessageId,
      session_id: session.id,
      role: 'user',
      content: message,
      model: null,
      created_at: now,
      tool_calls: null
    });
    console.log(`[Chat] 用户消息已保存: ${userMessageId}`);
  } catch (dbError: any) {
    console.error(`[Chat] 保存用户消息失败:`, dbError);
    return res.status(500).json({ error: "保存消息失败", detail: dbError?.message });
  }

  // 设置 SSE 头
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 默认系统提示词
  const defaultSystemPrompt = "你是一个专业的AI助手，善于帮助用户解决各种问题。请用简洁清晰的方式回答问题。";

  // 检查 SDK 是否可用：未配置 CODEBUDDY_API_KEY 时不要去碰 SDK query()，否则会抛 Authentication required
  if (!process.env.CODEBUDDY_API_KEY) {
    console.error(`[Chat] 未配置 CODEBUDDY_API_KEY，无法调用 SDK 模型 ${selectedModel}`);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(`data: ${JSON.stringify({ type: "init", sessionId: session.id, userMessageId, assistantMessageId, model: selectedModel })}\n\n`);
    res.write(`data: ${JSON.stringify({
      type: "text",
      content: `当前模型 \`${selectedModel}\` 需要 CodeBuddy SDK，请选择「智能客服 Agent (cs-agent)」或在服务端设置 \`CODEBUDDY_API_KEY\`。`,
    })}\n\n`);
    // 持久化错误提示，便于历史回看
    try {
      db.createMessage({
        id: assistantMessageId,
        session_id: session.id,
        role: 'assistant',
        content: `当前模型 \`${selectedModel}\` 需要 CodeBuddy SDK，请选择「智能客服 Agent (cs-agent)」或在服务端设置 \`CODEBUDDY_API_KEY\`。`,
        model: selectedModel,
        created_at: now,
        tool_calls: null,
      });
    } catch (dbError: any) {
      console.error(`[Chat] 保存错误占位消息失败:`, dbError);
    }
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    return res.end();
  }
  
  // 工作目录：优先使用请求中的 cwd，否则使用当前目录
  const workingDir = cwd || process.cwd();

  try {
    console.log(`[Chat] 调用 SDK query...`);
    console.log(`[Chat] - Model: ${selectedModel}`);
    console.log(`[Chat] - Resume: ${sdkSessionId || 'none'}`);
    console.log(`[Chat] - CWD: ${workingDir}`);
    console.log(`[Chat] - PermissionMode: ${permissionMode || 'default'}`);
    
    // 创建 canUseTool 回调
    const canUseTool: CanUseTool = async (toolName, input, options) => {
      console.log(`[Permission] Tool request: ${toolName}`);
      console.log(`[Permission] Input:`, JSON.stringify(input, null, 2));
      
      // bypassPermissions 模式直接放行
      if (permissionMode === 'bypassPermissions') {
        console.log(`[Permission] Bypassing permissions for ${toolName}`);
        return { behavior: 'allow', updatedInput: input };
      }
      
      // 创建权限请求
      const requestId = uuidv4();
      const permissionRequest = {
        requestId,
        toolUseId: options.toolUseID,
        toolName,
        input,
        sessionId: session.id,
        timestamp: Date.now()
      };
      
      // 发送权限请求到前端
      res.write(`data: ${JSON.stringify({ 
        type: "permission_request", 
        ...permissionRequest
      })}\n\n`);
      
      // 创建 Promise 等待用户响应
      return new Promise<PermissionResult>((resolve, reject) => {
        const pending: PendingPermission = {
          resolve,
          reject,
          toolName,
          input,
          sessionId: session.id,
          timestamp: Date.now()
        };
        
        pendingPermissions.set(requestId, pending);
        
        // 设置超时
        setTimeout(() => {
          if (pendingPermissions.has(requestId)) {
            pendingPermissions.delete(requestId);
            console.log(`[Permission] Request timeout: ${requestId}`);
            resolve({
              behavior: 'deny',
              message: '权限请求超时'
            });
          }
        }, PERMISSION_TIMEOUT);
      });
    };
    
    // 使用 Query API 发送消息
    // 如果有 sdk_session_id，使用 resume 恢复对话上下文
    const stream = query({
      prompt: message,
      options: {
        cwd: workingDir,
        model: selectedModel,
        maxTurns: 10,
        systemPrompt: systemPrompt || defaultSystemPrompt,
        permissionMode: permissionMode || 'default',
        canUseTool,
        ...(sdkSessionId ? { resume: sdkSessionId } : {})  // 使用 resume 恢复对话
      }
    });

    let fullResponse = "";
    let toolCalls: Array<{ 
      id: string; 
      name: string; 
      input?: Record<string, unknown>;
      status: string; 
      result?: string;
      isError?: boolean;
    }> = [];
    let newSdkSessionId: string | null = null;  // 用于存储 SDK 返回的 session_id

    // 发送会话ID和消息ID
    res.write(`data: ${JSON.stringify({ 
      type: "init", 
      sessionId: session.id, 
      userMessageId, 
      assistantMessageId,
      model: selectedModel 
    })}\n\n`);

    // 当前正在执行的工具 ID（用于匹配 tool_result）
    let currentToolId: string | null = null;

    // 处理流式响应
    for await (const msg of stream) {
      console.log("[Stream] Message type:", msg.type, msg);
      
      // 处理 system 消息，获取 SDK 的 session_id
      if (msg.type === "system" && (msg as any).subtype === "init") {
        newSdkSessionId = (msg as any).session_id;
        console.log(`[Stream] Got SDK session_id: ${newSdkSessionId}`);
        
        // 保存 SDK session_id 到数据库（如果是新的）
        if (newSdkSessionId && newSdkSessionId !== sdkSessionId) {
          db.updateSession(session.id, { sdk_session_id: newSdkSessionId });
          console.log(`[Stream] Saved SDK session_id to database`);
        }
      } else if (msg.type === "assistant") {
        const content = msg.message.content;

        if (typeof content === "string") {
          fullResponse += content;
          res.write(`data: ${JSON.stringify({ type: "text", content })}\n\n`);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              fullResponse += block.text;
              res.write(`data: ${JSON.stringify({ type: "text", content: block.text })}\n\n`);
            } else if (block.type === "tool_use") {
              currentToolId = block.id || uuidv4();
              const toolInput = (block as any).input || {};
              console.log(`[Stream] Tool use: id=${currentToolId}, name=${block.name}`);
              console.log(`[Stream] Tool input:`, JSON.stringify(toolInput, null, 2));
              
              const toolCall = { 
                id: currentToolId, 
                name: block.name, 
                input: toolInput,
                status: "running" 
              };
              toolCalls.push(toolCall);
              res.write(`data: ${JSON.stringify({ 
                type: "tool", 
                id: toolCall.id,
                name: toolCall.name,
                input: toolCall.input,
                status: toolCall.status
              })}\n\n`);
            }
          }
        }
      } else if (msg.type === "tool_result") {
        // 处理工具结果（独立的消息类型）
        const msgAny = msg as any;
        const toolId = msgAny.tool_use_id || currentToolId;
        const isError = msgAny.is_error || false;
        const content = msgAny.content;
        
        console.log(`[Stream] Tool result: tool_use_id=${toolId}, is_error=${isError}`);
        console.log(`[Stream] Tool result content type:`, typeof content);
        console.log(`[Stream] Tool result content:`, typeof content === 'string' ? content.slice(0, 500) : JSON.stringify(content, null, 2)?.slice(0, 500));
        
        const tool = toolCalls.find(t => t.id === toolId) || toolCalls[toolCalls.length - 1];
        if (tool) {
          tool.status = isError ? "error" : "completed";
          tool.isError = isError;
          tool.result = typeof content === 'string' 
            ? content 
            : JSON.stringify(content);
          res.write(`data: ${JSON.stringify({ 
            type: "tool_result", 
            toolId: tool.id, 
            content: tool.result,
            isError: isError
          })}\n\n`);
        }
        currentToolId = null;
      } else if (msg.type === "result") {
        // 完成时确保所有工具都标记为完成
        toolCalls.forEach(tool => {
          if (tool.status === "running") {
            tool.status = "completed";
            res.write(`data: ${JSON.stringify({ type: "tool_result", toolId: tool.id, content: tool.result || "已完成" })}\n\n`);
          }
        });
        res.write(`data: ${JSON.stringify({ type: "done", duration: msg.duration, cost: msg.cost })}\n\n`);
      }
    }

    // 保存助手消息到数据库
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse,
      model: selectedModel,
      created_at: new Date().toISOString(),
      tool_calls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null
    });

    // 更新会话标题（如果是第一条消息）
    const messages = db.getMessagesBySession(session.id);
    if (messages.length <= 2) {
      db.updateSession(session.id, { 
        title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
        model: selectedModel
      });
    }

    console.log(`[Chat] 请求完成 ✓`);
    res.end();
  } catch (error: any) {
    console.error(`\n[Chat] ========== 错误 ==========`);
    console.error(`[Chat] Error Name:`, error?.name);
    console.error(`[Chat] Error Message:`, error?.message);
    console.error(`[Chat] Error Code:`, error?.code);
    console.error(`[Chat] Error Stack:`, error?.stack);
    console.error(`[Chat] Full Error:`, JSON.stringify(error, null, 2));
    
    const errorMessage = error?.message || "处理请求时发生错误";
    res.write(`data: ${JSON.stringify({ type: "error", message: errorMessage })}\n\n`);
    res.end();
  }
});

// ============= 满意度评分 API =============

// 提交满意度评分
app.post("/api/satisfaction", (req, res) => {
  try {
    const { sessionId, rating, comment } = req.body;
    
    if (!sessionId || !rating) {
      return res.status(400).json({ error: "缺少必要参数" });
    }

    const result = db.createSatisfaction({
      session_id: sessionId,
      rating: Number(rating),
      comment: comment || null,
    });

    res.json({ success: true, rating: result });
  } catch (error: any) {
    console.error("[Satisfaction] Error:", error);
    res.status(500).json({ error: error?.message || "提交失败" });
  }
});

// 获取满意度统计
app.get("/api/satisfaction/stats", (req, res) => {
  try {
    const stats = db.getSatisfactionStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error?.message });
  }
});

// ============= 智能客服 Agent API =============

// 智能客服对话（使用 LangGraph 工作流）
app.post("/api/cs-agent/chat", requireAuth, async (req, res) => {
  const { sessionId, message } = req.body;

  console.log(`\n[CS-Agent] ===== 智能客服请求 =====`);
  console.log(`[CS-Agent] Session: ${sessionId}, Message: "${message?.slice(0, 80)}"`);

  if (!message) {
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  const now = new Date().toISOString();

  if (!session) {
    // 检查是否有转人工请求
    const isTransfer = /转人工|人工客服|人工服务/.test(message);
    const title = isTransfer ? `转人工: ${message.slice(0, 30)}` : message.slice(0, 30) + (message.length > 30 ? '...' : '');
    
    session = db.createSession({
      id: sessionId || uuidv4(),
      title,
      model: 'cs-agent',
      created_at: now,
      updated_at: now,
    });
  }

  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // 保存用户消息
  db.createMessage({
    id: userMessageId,
    session_id: session.id,
    role: 'user',
    content: message,
    model: null,
    created_at: now,
    tool_calls: null,
  });

  // 加载历史对话（剔除当前这条尚未生成回复的 user 消息），注入工作流状态
  const HISTORY_LIMIT = 20;
  const dbHistory = db.getMessagesBySession(session.id);
  const historyMessages = dbHistory
    .filter((m) => m.id !== userMessageId)
    .slice(-HISTORY_LIMIT)
    .map((m) => ({
      role: (m.role === 'user' || m.role === 'assistant' || m.role === 'system') ? m.role : 'user',
      content: m.content || '',
    })) as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  console.log(`[CS-Agent] 加载历史 ${historyMessages.length} 条`);

  // 设置 SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // 发送初始化事件
  res.write(`data: ${JSON.stringify({
    type: "init",
    sessionId: session.id,
    userMessageId,
    assistantMessageId,
    model: 'cs-agent',
  })}\n\n`);

  try {
    const workflow = getWorkflow();

    // 先发送意图识别结果
    const { intent, confidence } = workflow.detectIntent(message);
    const intentLabel = ['refund', 'order_inquiry', 'tech_support', 'general'].includes(intent) ? intent : 'general';
    
    res.write(`data: ${JSON.stringify({
      type: "intent",
      intent: intentLabel,
      confidence,
    })}\n\n`);

    // 执行智能客服工作流
    let fullResponse = '';
    const finalState = await workflow.run(
      message,
      session.id,
      userMessageId,
      (text: string) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({
          type: "text",
          content: text,
        })}\n\n`);
      },
      historyMessages
    );

    console.log(`[CS-Agent] 工作流结果: intent=${finalState.intent}, usedFaq=${finalState.usedFaq}, escalated=${finalState.shouldEscalate}`);

    // 如果有额外的工作流元数据，发送给前端
    res.write(`data: ${JSON.stringify({
      type: "workflow_meta",
      intent: finalState.intent,
      usedFaq: finalState.usedFaq,
      shouldEscalate: finalState.shouldEscalate,
      ticketId: finalState.ticketId,
      faqScore: finalState.faqResults[0]?.score || 0,
    })}\n\n`);

    // 保存助手消息
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse || finalState.finalResponse || '',
      model: 'cs-agent',
      created_at: new Date().toISOString(),
      tool_calls: null,
      used_faq: !!finalState.usedFaq,
      should_escalate: !!finalState.shouldEscalate,
      ticket_id: finalState.ticketId ?? null,
      faq_score: finalState.faqResults?.[0]?.score ?? null,
    });

    // 更新会话标题
    const messages = db.getMessagesBySession(session.id);
    if (messages.length <= 2) {
      const title = finalState.intent && finalState.intent !== 'general'
        ? `[${finalState.intent}] ${message.slice(0, 25)}`
        : message.slice(0, 30) + (message.length > 30 ? '...' : '');
      db.updateSession(session.id, { title });
    }

    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    res.end();
    console.log(`[CS-Agent] 请求完成 ✓`);
  } catch (error: any) {
    console.error(`[CS-Agent] Error:`, error);
    res.write(`data: ${JSON.stringify({ type: "error", message: error?.message || "处理请求时发生错误" })}\n\n`);
    res.end();
  }
});

// ============= 管理后台路由 =============

app.use("/api/admin", requireAuth, requireRole('admin'), adminRoutes);

// 启动服务器
bootstrapDefaultAdmin()
  .catch((err) => console.error('[Auth] 引导管理员失败:', err))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════╗
║                                            ║
║     ◉ API 服务器已启动                      ║
║                                            ║
║     地址: http://localhost:${PORT}            ║
║     数据库: SQLite (data/chat.db)           ║
║     智能客服: /api/cs-agent/chat            ║
║     管理后台: /api/admin/dashboard           ║
║                                            ║
╚════════════════════════════════════════════╝
      `);

      // 初始化 FAQ 知识库
      try {
        const faqResult = initializeFaqKnowledge();
        if (faqResult.loaded > 0) {
          console.log(`[Init] FAQ 知识库已初始化: ${faqResult.loaded} 条`);
        } else {
          console.log(`[Init] FAQ 知识库已有 ${faqResult.total} 条数据`);
        }
      } catch (error: any) {
        console.error('[Init] FAQ 初始化失败:', error.message);
      }
    });
  });
