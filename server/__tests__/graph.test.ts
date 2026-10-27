import { describe, it, expect } from 'vitest';
import { classifyIntent } from '../agents/intent.js';

describe('意图识别', () => {
  it('退款意图', () => {
    const r = classifyIntent('我要退款');
    expect(r.intent).toBe('refund');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('查单意图', () => {
    const r = classifyIntent('我的订单到哪了');
    expect(r.intent).toBe('order_inquiry');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('技术支持意图', () => {
    const r = classifyIntent('登录不了了');
    expect(r.intent).toBe('tech_support');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('通用意图', () => {
    const r = classifyIntent('今天天气怎么样');
    expect(r.intent).toBe('general');
    expect(r.confidence).toBeGreaterThan(0);
  });

  it('空字符串返回 general', () => {
    const r = classifyIntent('');
    expect(r.intent).toBe('general');
  });
});