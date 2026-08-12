/**
 * Agent 对话节点
 * 使用 LangChain ChatPromptTemplate 管理提示词模板与历史消息注入，
 * 通过统一 LLM Provider 调用 MiniMax / OpenAI 等后端。
 */

import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { getLLMProvider } from "./llm-provider.js";
import type { CSAgentState } from "./types.js";
import * as db from "../db.js";

// ---- 提示词模板 ----

const AGENT_PROMPT = ChatPromptTemplate.fromMessages([
  [
    "system",
    `你是一个专业的智能客服助手。你的职责是帮助用户解决问题。

## 工作原则
1. 热情友好，耐心解答用户的问题
2. 回答简洁明了，避免冗长
3. 当问题超出你的能力范围时，主动建议用户转接人工客服
4. 不要在回答中编造信息，不确定的事情要诚实告知
5. 优先使用中文回答

## 解决范围
- 退款相关问题：退款流程、退款进度、退款条件等
- 订单相关问题：订单查询、物流追踪、订单修改等
- 技术支持问题：App 使用、支付问题、账号问题等
- 其他一般咨询

## 转人工条件
当遇到以下情况时，请明确告知用户并引导转人工：
- 涉及账户安全和隐私信息
- 需要后台操作（如强制退款、修改系统数据）
- 用户情绪激动或明确要求转人工
- 连续两轮无法解决用户问题

{context}

请尽全力帮助用户！`,
  ],
  new MessagesPlaceholder("history"),
  ["human", "{user_input}"],
]);

// ---- 节点函数 ----

export async function agentNode(
  state: CSAgentState,
  onText?: (text: string) => void,
): Promise<Partial<CSAgentState>> {
  const { userInput, intent, faqResults, messages } = state;

  try {
    // 构建上下文变量
    const context = buildContext(intent, faqResults);

    // 通过 ChatPromptTemplate 构建消息数组
    const promptMessages = await AGENT_PROMPT.formatMessages({
      context,
      user_input: userInput,
      history: messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant") && m.content)
        .map((m) =>
          m.role === "user"
            ? new HumanMessage(m.content)
            : new AIMessage(m.content),
        ),
    });

    // 调用 LLM
    const provider = await getLLMProvider();

    const result = await provider.chat({
      prompt: "", // 由 messages 字段接管
      messages: promptMessages as (SystemMessage | HumanMessage | AIMessage)[],
      onText,
    });

    let fullResponse = result.content;
    if (!fullResponse) {
      fullResponse =
        "抱歉，我暂时无法处理您的问题。" +
        '建议您转接人工客服获取更专业的帮助。请输入"转人工"联系人工客服。';
    }

    const shouldEscalate = checkEscalationNeeded(fullResponse, userInput);

    // 记录意图
    try {
      db.recordIntent({
        session_id: state.sessionId,
        message_id: state.messageId,
        intent: state.intent || "general",
        confidence: state.intentConfidence,
        faq_matched: null,
        faq_score: null,
      });
    } catch {
      // 忽略
    }

    return { finalResponse: fullResponse, shouldEscalate, usedFaq: false };
  } catch (error: any) {
    console.error("[Agent] LLM 调用失败:", error.message);
    return {
      finalResponse:
        '抱歉，服务暂时不可用。请稍后再试，或者输入\u201C转人工\u201D联系人工客服。',
      shouldEscalate: true,
      error: error.message,
      usedFaq: false,
    };
  }
}

// ---- 工具函数 ----

function buildContext(intent: string | null, faqResults: Array<{ question: string; answer: string; score: number }>): string {
  const parts: string[] = [];

  if (intent && intent !== "general") {
    parts.push(`用户意图: ${intent}`);
  }

  const topFaq = faqResults[0];
  if (topFaq && topFaq.score >= 0.4) {
    parts.push(
      `相关 FAQ 参考（仅供参考，请根据实际情况回答）: ` +
        `"${topFaq.question}" → "${topFaq.answer}"`,
    );
  }

  return parts.length > 0 ? `\n## 当前上下文\n${parts.join("\n")}\n` : "";
}

function checkEscalationNeeded(response: string, userInput: string): boolean {
  const lowerResponse = response.toLowerCase();
  const suggestionPatterns = [
    "转人工", "人工客服", "人工服务", "联系客服",
    "无法处理", "无法解决", "能力有限", "超出范围",
    "建议您联系", "请联系我们的人工",
  ];
  for (const pattern of suggestionPatterns) {
    if (lowerResponse.includes(pattern)) return true;
  }
  return /转人工|人工客服|人工服务|找人工|找客服人员/i.test(userInput);
}
