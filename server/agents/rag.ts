/**
 * FAQ RAG 检索节点
 * 从向量存储中检索匹配的 FAQ
 */

import { getVectorStore } from '../rag/vectorStore.js';
import * as db from '../db.js';
import type { CSAgentState, FaqResult } from './types.js';
import { FAQ_CONFIDENCE_THRESHOLD } from './types.js';

/**
 * LangGraph RAG 检索节点
 */
export async function ragNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  const { userInput, intent } = state;

  console.log(`[RAG] 检索 FAQ, 意图: ${intent || 'all'}, 查询: "${userInput.slice(0, 50)}"`);

  try {
    const vectorStore = getVectorStore();

    // 按意图类别过滤搜索
    const vectorResults = await vectorStore.search(
      userInput,
      intent && intent !== 'general' ? intent : undefined,
      3,
      0.15
    );

    if (vectorResults.length === 0) {
      console.log('[RAG] 未找到匹配的 FAQ');
      return { faqResults: [] };
    }

    // 获取完整 FAQ 内容
    const faqResults: FaqResult[] = [];
    for (const r of vectorResults) {
      const faq = db.getAllFaq().find(f => f.id === r.id);
      if (faq) {
        faqResults.push({
          id: faq.id,
          question: faq.question,
          answer: faq.answer,
          category: faq.category,
          score: r.score,
        });
      }
    }

    console.log(`[RAG] 找到 ${faqResults.length} 个匹配 (最高分: ${faqResults[0]?.score?.toFixed(2) || 'N/A'})`);

    return { faqResults };
  } catch (error: any) {
    console.error('[RAG] 检索失败:', error.message);
    return { faqResults: [] };
  }
}

/**
 * 判断 FAQ 匹配度是否足够直接返回
 */
export function shouldUseFaqAnswer(state: CSAgentState): boolean {
  const bestMatch = state.faqResults[0];
  const isHighConfidence = bestMatch && bestMatch.score >= FAQ_CONFIDENCE_THRESHOLD;

  // 如果 FAQ 置信度高，且用户没有要求转人工
  const askingForHuman = /转人工|人工客服|人工服务|找人工|客服人员/.test(state.userInput);
  
  if (isHighConfidence && !askingForHuman) {
    return true;
  }

  return false;
}

/**
 * 直接从 FAQ 生成回复
 */
export function getFaqResponse(state: CSAgentState): Partial<CSAgentState> {
  const bestMatch = state.faqResults[0];
  
  if (!bestMatch) {
    return { finalResponse: '抱歉，我没有找到相关的答案。' };
  }

  const faqAnswer = bestMatch.answer;
  const response = `根据知识库，我为您找到了相关答案：\n\n${faqAnswer}\n\n💡 提示：如果这个答案没有解决您的问题，您可以输入"转人工"联系人工客服。`;

  // 记录意图和 FAQ 匹配
  try {
    db.recordIntent({
      session_id: state.sessionId,
      message_id: state.messageId,
      intent: state.intent || 'general',
      confidence: state.intentConfidence,
      faq_matched: bestMatch.id,
      faq_score: bestMatch.score,
    });
  } catch (e) {
    // 忽略记录失败
  }

  return {
    finalResponse: response,
    usedFaq: true,
    usedFaqId: bestMatch.id,
    shouldEscalate: false,
  };
}
