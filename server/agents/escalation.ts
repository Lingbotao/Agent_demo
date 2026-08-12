/**
 * 转人工（工单）节点
 * 当 Agent 无法解决问题时，创建工单并通知用户
 */

import * as db from '../db.js';
import type { CSAgentState } from './types.js';
import type { Ticket } from '../db.js';

/** 意图对应的工单优先级 */
const INTENT_PRIORITY_MAP: Record<string, Ticket['priority']> = {
  refund: 'high',
  order_inquiry: 'normal',
  tech_support: 'normal',
  general: 'low',
};

/**
 * LangGraph 转人工节点
 */
export async function escalationNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  try {
    // 创建工单
    const summary = state.userInput.slice(0, 200);
    const priority = INTENT_PRIORITY_MAP[state.intent || 'general'] || 'normal';

    const ticket = db.createTicket({
      session_id: state.sessionId,
      intent: state.intent || 'general',
      summary: state.userInput,
      status: 'pending',
      priority,
      assigned_to: null,
      resolution: null,
    });

    // 生成转人工提示信息
    const escalationMessage = `已为您转接人工客服，工单编号：${ticket.id.slice(0, 8)}。\n\n我们的客服人员将在工作时间内尽快与您联系，请留意消息通知。\n\n⏰ 人工客服工作时间：工作日 9:00 - 18:00\n📧 您也可以发送邮件至 support@example.com`;

    return {
      ticketId: ticket.id,
      finalResponse: escalationMessage,
      shouldEscalate: true,
    };
  } catch (error: any) {
    console.error('[Escalation] 创建工单失败:', error.message);
    return {
      finalResponse: '抱歉，转人工服务暂时不可用。请稍后再试，或通过 400-XXX-XXXX 联系客服。',
      shouldEscalate: true,
      error: error.message,
    };
  }
}
