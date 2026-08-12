/**
 * Agent 对话节点
 * 通过统一 LLM Provider 进行智能对话
 * 支持: MiniMax / OpenAI / 任意 OpenAI 兼容 API
 */

import { getLLMProvider } from './llm-provider.js';
import type { CSAgentState } from './types.js';
import * as db from '../db.js';

/** 智能客服系统提示词 */
const CS_SYSTEM_PROMPT = `你是一个专业的智能客服助手。你的职责是帮助用户解决问题。

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

请尽全力帮助用户！`;

/**
 * LangGraph Agent 对话节点
 */
export async function agentNode(
  state: CSAgentState,
  onText?: (text: string) => void
): Promise<Partial<CSAgentState>> {
  const { userInput, intent, faqResults, messages } = state;

  console.log(`[Agent] 调用 LLM Provider, 意图: ${intent}`);

  try {
    // 构建上下文信息
    const contextParts: string[] = [];

    if (intent && intent !== 'general') {
      contextParts.push(`用户意图: ${intent}`);
    }

    if (faqResults.length > 0) {
      const topFaq = faqResults[0];
      if (topFaq.score >= 0.4) {
        contextParts.push(
          `相关 FAQ 参考（仅供参考，请根据实际情况回答）: ` +
          `"${topFaq.question}" → "${topFaq.answer}"`
        );
      }
    }

    const contextPrompt = contextParts.length > 0
      ? `\n\n## 当前上下文\n${contextParts.join('\n')}\n`
      : '';

    const fullSystemPrompt = CS_SYSTEM_PROMPT + contextPrompt;

    // 通过统一 LLM Provider 调用
    const provider = await getLLMProvider();
    console.log(`[Agent] Provider: ${provider.name}`);

    const result = await provider.chat({
      prompt: userInput,
      systemPrompt: fullSystemPrompt,
      onText,
      history: messages
        .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.content)
        .map((m) => ({ role: m.role, content: m.content })),
    });

    let fullResponse = result.content;

    if (!fullResponse) {
      fullResponse = '抱歉，我暂时无法处理您的问题。建议您转接人工客服获取更专业的帮助。请输入"转人工"联系人工客服。';
    }

    // 检查是否需要转人工
    const shouldEscalate = checkEscalationNeeded(fullResponse, userInput);

    // 记录意图
    try {
      db.recordIntent({
        session_id: state.sessionId,
        message_id: state.messageId,
        intent: state.intent || 'general',
        confidence: state.intentConfidence,
        faq_matched: null,
        faq_score: null,
      });
    } catch (e) {
      // 忽略
    }

    return {
      finalResponse: fullResponse,
      shouldEscalate,
      usedFaq: false,
    };
  } catch (error: any) {
    console.error('[Agent] LLM 调用失败:', error.message);
    return {
      finalResponse: '抱歉，服务暂时不可用。请稍后再试，或者输入"转人工"联系人工客服。',
      shouldEscalate: true,
      error: error.message,
      usedFaq: false,
    };
  }
}

/** 判断是否需要转人工 */
function checkEscalationNeeded(response: string, userInput: string): boolean {
  const lowerResponse = response.toLowerCase();

  const suggestionPatterns = [
    '转人工', '人工客服', '人工服务', '联系客服',
    '无法处理', '无法解决', '能力有限', '超出范围',
    '建议您联系', '请联系我们的人工',
  ];

  for (const pattern of suggestionPatterns) {
    if (lowerResponse.includes(pattern)) {
      return true;
    }
  }

  const userRequestHuman = /转人工|人工客服|人工服务|找人工|找客服人员/i.test(userInput);
  if (userRequestHuman) return true;

  return false;
}
