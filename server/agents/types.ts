/**
 * 智能客服 Agent 状态定义
 * 用于 LangGraph 状态图
 */

import type { BaseMessage } from "@langchain/core/messages";

/** 支持的意图类型 */
export type IntentType = 'refund' | 'order_inquiry' | 'tech_support' | 'general';

/** FAQ 检索结果 */
export interface FaqResult {
  id: string;
  question: string;
  answer: string;
  category: string;
  score: number;
}

/** LangGraph 工作流状态 */
export interface CSAgentState {
  /** 对话消息历史 */
  messages: BaseMessage[];
  /** 当前用户输入 */
  userInput: string;
  /** 会话 ID */
  sessionId: string;
  /** 用户消息 ID */
  messageId: string;
  /** 识别出的意图 */
  intent: IntentType | null;
  /** 意图置信度 (0-1) */
  intentConfidence: number;
  /** FAQ 检索结果列表 */
  faqResults: FaqResult[];
  /** 是否需要转人工 */
  shouldEscalate: boolean;
  /** 转人工生成的工单 ID */
  ticketId: string | null;
  /** 最终回复内容 */
  finalResponse: string | null;
  /** 是否使用了 FAQ 答案 */
  usedFaq: boolean;
  /** 使用的 FAQ ID */
  usedFaqId: string | null;
  /** 错误信息 */
  error: string | null;
}

/** 初始状态工厂 */
export function createInitialState(input: {
  userInput: string;
  sessionId: string;
  messageId: string;
  messages?: BaseMessage[];
}): CSAgentState {
  return {
    messages: input.messages || [],
    userInput: input.userInput,
    sessionId: input.sessionId,
    messageId: input.messageId,
    intent: null,
    intentConfidence: 0,
    faqResults: [],
    shouldEscalate: false,
    ticketId: null,
    finalResponse: null,
    usedFaq: false,
    usedFaqId: null,
    error: null,
  };
}

/** 意图分类标签 */
export const INTENT_LABELS: Record<IntentType, string> = {
  refund: '退款',
  order_inquiry: '查询订单',
  tech_support: '技术支持',
  general: '通用咨询',
};

/** FAQ 匹配置信度阈值：超过此值直接返回 FAQ 答案 */
export const FAQ_CONFIDENCE_THRESHOLD = 0.75;
