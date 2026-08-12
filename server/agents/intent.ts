/**
 * 意图识别节点
 * 基于关键词匹配 + 规则引擎快速分类用户意图
 */

import type { CSAgentState, IntentType } from './types.js';
import { INTENT_LABELS } from './types.js';

/** 意图关键词词典 */
const INTENT_PATTERNS: Record<IntentType, { keywords: string[]; weight: number }[]> = {
  refund: [
    { keywords: ['退款', '退钱', '退货', '退款申请', '退款进度', '退款到账', '钱退', '退还', '退单'], weight: 1.0 },
    { keywords: ['不要了', '取消', '申请退款', '怎么退', '退款流程', '还能退吗'], weight: 0.8 },
    { keywords: ['不满意', '买错了', '不想要', '退差价', '退款原因'], weight: 0.5 },
  ],
  order_inquiry: [
    { keywords: ['订单', '下单', '查单', '订单号', '物流', '快递', '发货', '配送', '收货'], weight: 1.0 },
    { keywords: ['买了什么', '什么时候到', '查物流', '追踪', '到哪了', '还没收到'], weight: 0.8 },
    { keywords: ['修改订单', '改地址', '催单', '多久发货', '订单状态', '已下单'], weight: 0.6 },
  ],
  tech_support: [
    { keywords: ['报错', '错误', 'bug', '故障', '崩溃', '无法使用', '闪退', '打不开', '登录不了'], weight: 1.0 },
    { keywords: ['技术', '支持', '问题', '不行', '不能用', '异常', '出错', '失败', '不显示'], weight: 0.7 },
    { keywords: ['配置', '设置', '安装', '更新', '版本', '兼容', '卡顿', '慢'], weight: 0.5 },
  ],
  general: [
    { keywords: ['你好', '您好', 'hi', 'hello', '在吗', '有人吗'], weight: 0.3 },
    { keywords: ['帮助', '怎么用', '介绍一下', '是什么', '功能', '服务'], weight: 0.3 },
  ],
};

/**
 * 基于规则识别用户意图
 * 返回意图类型和置信度
 */
export function classifyIntent(userInput: string): { intent: IntentType; confidence: number } {
  const input = userInput.toLowerCase().trim();
  
  const scores: Record<IntentType, number> = {
    refund: 0,
    order_inquiry: 0,
    tech_support: 0,
    general: 0,
  };

  // 为每个意图计算加权得分
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
    for (const { keywords, weight } of patterns) {
      for (const keyword of keywords) {
        if (input.includes(keyword)) {
          scores[intent as IntentType] += weight;
          break; // 同一权重组只计一次
        }
      }
    }
  }

  // 找到最高得分的意图
  let bestIntent: IntentType = 'general';
  let maxScore = 0;

  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestIntent = intent as IntentType;
    }
  }

  // 归一化置信度 (0-1)
  // 如果有明确的业务关键词匹配，置信度较高
  if (maxScore >= 1.0) {
    return { intent: bestIntent, confidence: Math.min(maxScore / 3, 0.95) };
  } else if (maxScore > 0) {
    return { intent: bestIntent, confidence: Math.min(maxScore / 2, 0.7) };
  }
  
  return { intent: 'general', confidence: 0.3 };
}

/**
 * LangGraph 意图识别节点
 */
export async function intentNode(state: CSAgentState): Promise<Partial<CSAgentState>> {
  const { intent, confidence } = classifyIntent(state.userInput);

  return {
    intent,
    intentConfidence: confidence,
  };
}
