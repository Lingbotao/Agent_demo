import { describe, it, expect } from 'vitest';

// 模拟 DEFAULT_FAQS 数据结构校验
const DEFAULT_FAQS = [
  { question: '如何申请退款？', answer: '退款流程说明...', category: 'refund', keywords: '退款 申请' },
  { question: '如何查询订单？', answer: '查询订单方法...', category: 'order_inquiry', keywords: '订单 查询' },
  { question: 'App无法登录？', answer: '登录排查...', category: 'tech_support', keywords: '登录 无法' },
  { question: '客服工作时间？', answer: '工作时间...', category: 'general', keywords: '客服 时间' },
];

describe('FAQ 知识库结构', () => {
  it('所有 FAQ 都有必填字段', () => {
    for (const faq of DEFAULT_FAQS) {
      expect(faq.question).toBeTruthy();
      expect(faq.answer).toBeTruthy();
      expect(faq.category).toBeTruthy();
      expect(faq.keywords).toBeTruthy();
    }
  });

  it('分类值在合法范围内', () => {
    const validCategories = ['refund', 'order_inquiry', 'tech_support', 'general'];
    for (const faq of DEFAULT_FAQS) {
      expect(validCategories).toContain(faq.category);
    }
  });

  it('关键词包含 question 中部分词汇', () => {
    // 退款 FAQ 关键词包含"退款"
    const refundFaq = DEFAULT_FAQS.find(f => f.category === 'refund')!;
    expect(refundFaq.keywords).toContain('退款');
  });

  it('每个分类至少有一条 FAQ', () => {
    const categories = new Set(DEFAULT_FAQS.map(f => f.category));
    expect(categories.size).toBe(4);
  });
});