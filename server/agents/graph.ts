/**
 * 智能客服 LangGraph 工作流引擎
 *
 * 使用 @langchain/langgraph 的 StateGraph 定义工作流：
 *   intent → rag → route → [faq_answer | agent → route → (escalation | END)]
 *
 * 工作流节点:
 * 1. intent:      识别用户意图（退款/查单/技术支持/通用）
 * 2. rag:         在向量知识库中检索匹配 FAQ
 * 3. faq_answer:  高匹配 → 直接返回 FAQ 答案
 * 4. agent:       低匹配 → 调用 LLM 对话
 * 5. escalation:  无法解决 → 创建工单转人工
 */

import { StateGraph, START, END } from "@langchain/langgraph";
import { classifyIntent } from "./intent.js";
import { ragNode, shouldUseFaqAnswer, getFaqResponse } from "./rag.js";
import { agentNode } from "./agent.js";
import { escalationNode } from "./escalation.js";
import type { CSAgentState, ChatMessage } from "./types.js";
import { createInitialState } from "./types.js";

// ---- 流式文本回调（模块级，节点通过它向外输出流式文本） ----
let onTextCallback: ((text: string) => void) | null = null;
export function setOnTextCallback(cb: ((text: string) => void) | null) {
  onTextCallback = cb;
}

// ---- LangGraph 节点函数 ----
// 每个节点接收 state，返回 Partial<CSAgentState> 更新

async function intentNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  const { intent, confidence } = classifyIntent(state.userInput);
  console.log(`[LangGraph: intent] ${intent} (${confidence.toFixed(2)})`);
  return { intent, intentConfidence: confidence };
}

async function ragSearchNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  return ragNode(state);
}

async function faqAnswerNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  const result = getFaqResponse(state);
  if (result.finalResponse && onTextCallback) {
    onTextCallback(result.finalResponse);
  }
  return result;
}

async function llmAgentNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  return agentNode(state, onTextCallback ?? undefined);
}

async function humanEscalationNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  return escalationNode(state);
}

// ---- 条件路由函数 ----
// 返回下一个节点名称，或 END 终止

function routeAfterRag(state: CSAgentState): string {
  if (state.error) return "escalation";
  return shouldUseFaqAnswer(state) ? "faq_answer" : "agent";
}

function routeAfterAgent(state: CSAgentState): string {
  return state.shouldEscalate ? "escalation" : END;
}

// ---- 编译 LangGraph 状态图 ----

function buildGraph() {
  const graph = new StateGraph<CSAgentState>({
    channels: {
      messages: { reducer: (x: ChatMessage[], y: ChatMessage[]) => y, default: () => [] },
      userInput: { reducer: (_, y) => y, default: () => "" },
      sessionId: { reducer: (_, y) => y, default: () => "" },
      messageId: { reducer: (_, y) => y, default: () => "" },
      intent: { reducer: (_, y) => y, default: () => null },
      intentConfidence: { reducer: (_, y) => y, default: () => 0 },
      faqResults: { reducer: (_, y) => y, default: () => [] },
      shouldEscalate: { reducer: (_, y) => y, default: () => false },
      ticketId: { reducer: (_, y) => y, default: () => null },
      finalResponse: { reducer: (_, y) => y, default: () => null },
      usedFaq: { reducer: (_, y) => y, default: () => false },
      usedFaqId: { reducer: (_, y) => y, default: () => null },
      error: { reducer: (_, y) => y, default: () => null },
    },
  });

  graph
    .addNode("detect_intent", intentNode)
    .addNode("search_faq", ragSearchNode)
    .addNode("reply_faq", faqAnswerNode)
    .addNode("call_agent", llmAgentNode)
    .addNode("create_ticket", humanEscalationNode)
    .addEdge(START, "detect_intent")
    .addEdge("detect_intent", "search_faq")
    .addConditionalEdges("search_faq", routeAfterRag, {
      faq_answer: "reply_faq",
      agent: "call_agent",
      escalation: "create_ticket",
    })
    .addEdge("reply_faq", END)
    .addConditionalEdges("call_agent", routeAfterAgent, {
      escalation: "create_ticket",
      [END]: END,
    })
    .addEdge("create_ticket", END);

  return graph.compile();
}

// ---- 封装类：对外保持兼容 API ----

let compiledGraph = buildGraph();

export class LangGraphWorkflow {
  /**
   * 执行完整工作流
   */
  async run(
    userInput: string,
    sessionId: string,
    messageId: string,
    onText?: (text: string) => void,
    history?: ChatMessage[],
  ): Promise<CSAgentState> {
    const initialState = createInitialState({
      userInput,
      sessionId,
      messageId,
      messages: history || [],
    });

    console.log(`\n[LangGraph] ===== 开始执行 =====`);
    console.log(`[LangGraph] Session: ${sessionId}, Input: "${userInput.slice(0, 80)}"`);

    // 设置流式回调
    setOnTextCallback(onText || null);

    try {
      const result = (await compiledGraph.invoke(initialState)) as CSAgentState;
      console.log(
        `[LangGraph] 结束, intent=${result.intent}, usedFaq=${result.usedFaq}, escalated=${result.shouldEscalate}`,
      );
      return result;
    } finally {
      setOnTextCallback(null);
    }
  }

  /**
   * 仅执行意图识别（用于前端异步展示）
   */
  detectIntent(text: string): { intent: string; confidence: number } {
    return classifyIntent(text);
  }

  /** 重新编译图（切换模型等场景可用） */
  rebuild(): void {
    compiledGraph = buildGraph();
  }
}

// ---- 全局单例 ----

let workflowInstance: LangGraphWorkflow | null = null;

export function getWorkflow(): LangGraphWorkflow {
  if (!workflowInstance) {
    workflowInstance = new LangGraphWorkflow();
  }
  return workflowInstance;
}
