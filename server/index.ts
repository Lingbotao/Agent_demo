import * as dotenv from 'dotenv';
dotenv.config();
import express from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { promisify } from "util";
import * as db from "./db.js";
import { getWorkflow } from "./agents/graph.js";
import { initializeFaqKnowledge } from "./rag/faqLoader.js";
import { getLLMProvider } from "./agents/llm-provider.js";
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
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_MODEL || 'cs-agent';
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_MODEL || 'cs-agent';
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
      const minimaxModel = process.env.MINIMAX_MODEL || 'cs-agent';
      const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

      if (process.env.MINIMAX_API_KEY) {
        cachedModels = [{ modelId: minimaxModel, name: minimaxModel, description: 'MiniMax 模型' }];
      } else if (process.env.OPENAI_API_KEY) {
        cachedModels = [{ modelId: openaiModel, name: openaiModel, description: 'OpenAI 兼容模型' }];
      } else {
        cachedModels = [{ modelId: 'cs-agent', name: '智能客服 Agent (演示模式)', description: '未配置 LLM API Key，使用模拟回复' }];
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

// 发送消息并获取流式响应
app.post("/api/chat", requireAuth, async (req, res) => {
  const { sessionId, message, model, systemPrompt } = req.body;

  if (!message) {
    return res.status(400).json({ error: "消息不能为空" });
  }

  // 获取或创建会话
  let session = sessionId ? db.getSession(sessionId) : null;
  const now = new Date().toISOString();

  if (!session) {
    session = db.createSession({
      id: sessionId || uuidv4(),
      title: message.slice(0, 30) + (message.length > 30 ? '...' : ''),
      model: model || defaultModel,
      created_at: now,
      updated_at: now
    });
  }

  const selectedModel = model || session.model;

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

  try {
    // 加载历史对话（剔除当前 user 消息），形成多轮上下文
    const HISTORY_LIMIT = 20;
    const dbHistory = db.getMessagesBySession(session.id);
    const historyMessages = dbHistory
      .filter((m) => m.id !== userMessageId)
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: (m.role === 'user' || m.role === 'assistant' || m.role === 'system') ? m.role : 'user',
        content: m.content || '',
      })) as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;

    // 通过统一 LLM Provider 调用
    const provider = await getLLMProvider();

    let fullResponse = '';
    let toolCalls: Array<{
      id: string;
      name: string;
      input?: Record<string, unknown>;
      status: string;
      result?: string;
      isError?: boolean;
    }> = [];

    // 发送会话ID和消息ID
    res.write(`data: ${JSON.stringify({
      type: "init",
      sessionId: session.id,
      userMessageId,
      assistantMessageId,
      model: selectedModel
    })}\n\n`);

    const startTime = Date.now();
    const result = await provider.chat({
      prompt: message,
      systemPrompt: systemPrompt || defaultSystemPrompt,
      model: selectedModel,
      history: historyMessages,
      onText: (text) => {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: "text", content: text })}\n\n`);
      },
    });

    const duration = Date.now() - startTime;

    // 保存助手消息到数据库
    db.createMessage({
      id: assistantMessageId,
      session_id: session.id,
      role: 'assistant',
      content: fullResponse || result.content,
      model: result.model || selectedModel,
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

    res.write(`data: ${JSON.stringify({ type: "done", duration })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error(`[Chat] LLM 调用失败:`, error?.message);

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

    console.log(`[CS-Agent] 完成: intent=${finalState.intent}, faq=${finalState.usedFaq}, escalate=${finalState.shouldEscalate}`);

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
  .finally(async () => {
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
    });

    // 初始化 FAQ 知识库（在 .finally 顶层作用域中 await，不嵌在 listen 回调里）
    try {
      const faqResult = await initializeFaqKnowledge();
      if (faqResult.loaded > 0) {
        console.log(`[Init] FAQ 知识库已初始化: ${faqResult.loaded} 条`);
      } else {
        console.log(`[Init] FAQ 知识库已有 ${faqResult.total} 条数据`);
      }
    } catch (error: any) {
      console.error('[Init] FAQ 初始化失败:', error.message);
    }
  });
