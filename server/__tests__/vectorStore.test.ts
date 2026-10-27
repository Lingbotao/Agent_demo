import { describe, it, expect } from 'vitest';

// 余弦相似度函数（从 vectorStore.ts 复制，避免初始化 Embedding API）
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

describe('向量存储 - 余弦相似度', () => {
  it('相同向量相似度为 1', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it('正交向量相似度为 0', () => {
    const v1 = [1, 0, 0];
    const v2 = [0, 1, 0];
    expect(cosineSimilarity(v1, v2)).toBeCloseTo(0, 5);
  });

  it('相反向量相似度为 -1', () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, [-1, -2, -3])).toBeCloseTo(-1, 5);
  });

  it('空向量返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('零向量返回 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });

  it('不同长度返回 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('相似但不完全相同的向量', () => {
    const score = cosineSimilarity([1, 2, 3], [1.1, 2.1, 2.9]);
    expect(score).toBeGreaterThan(0.99);
    expect(score).toBeLessThan(1);
  });
});