/**
 * 向量存储模块
 * 使用内存向量存储实现轻量级 RAG（无需额外安装向量数据库）
 * 基于余弦相似度的简单向量检索
 */

import * as db from '../db.js';
import type { FaqKnowledge } from '../db.js';

/** 向量条目 */
interface VectorEntry {
  id: string;
  question: string;
  embedding: number[];
  category: string;
}

/** 简单的 TF-IDF 向量化（轻量级替代方案） */
class SimpleEmbedder {
  private vocabulary: Map<string, number> = new Map();
  private idfScores: Map<string, number> = new Map();
  private totalDocs = 0;
  private initialized = false;

  /** 分词 */
  tokenize(text: string): string[] {
    // 中文和英文混合分词
    return text
      .toLowerCase()
      .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  /** 初始化词表和 IDF */
  initialize(documents: FaqKnowledge[]): void {
    const docFreq = new Map<string, number>();
    this.totalDocs = documents.length;

    for (const doc of documents) {
      const tokens = new Set(this.tokenize(doc.question + ' ' + (doc.keywords || '')));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) || 0) + 1);
      }
    }

    // 构建词表
    let idx = 0;
    for (const [token, df] of docFreq) {
      this.vocabulary.set(token, idx);
      // IDF = log(总文档数 / 包含该词的文档数)
      this.idfScores.set(token, Math.log((this.totalDocs + 1) / (df + 1)) + 1);
      idx++;
    }

    this.initialized = true;
    console.log(`[Embedder] 词表大小: ${this.vocabulary.size}, 文档数: ${this.totalDocs}`);
  }

  /** 将文本转为 TF-IDF 向量 */
  embed(text: string): number[] {
    const tokens = this.tokenize(text);
    const vector = new Array(this.vocabulary.size).fill(0);
    
    if (tokens.length === 0) return vector;

    // 计算 TF
    const tf = new Map<string, number>();
    for (const token of tokens) {
      tf.set(token, (tf.get(token) || 0) + 1);
    }

    // TF-IDF
    for (const [token, freq] of tf) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        const tfScore = freq / tokens.length;
        const idfScore = this.idfScores.get(token) || 1;
        vector[idx] = tfScore * idfScore;
      }
    }

    return vector;
  }
}

/** 内存向量存储 */
class InMemoryVectorStore {
  private entries: VectorEntry[] = [];
  private embedder: SimpleEmbedder;

  constructor() {
    this.embedder = new SimpleEmbedder();
    this.reload();
  }

  /** 从数据库重新加载所有 FAQ */
  reload(): void {
    const faqList = db.getAllFaq();
    this.embedder.initialize(faqList);
    
    this.entries = faqList.map(faq => ({
      id: faq.id,
      question: faq.question,
      embedding: this.embedder.embed(faq.question + ' ' + (faq.keywords || '')),
      category: faq.category,
    }));

    console.log(`[VectorStore] 已加载 ${this.entries.length} 条 FAQ`);
  }

  /** 余弦相似度 */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** 关键词加分 */
  private keywordBonus(question: string, query: string): number {
    const queryTokens = new Set(this.embedder.tokenize(query));
    const questionTokens = this.embedder.tokenize(question);
    const matchCount = questionTokens.filter(t => queryTokens.has(t)).length;
    return queryTokens.size > 0 ? matchCount / queryTokens.size * 0.2 : 0;
  }

  /**
   * 搜索最匹配的 FAQ
   * @param query 用户查询
   * @param category 可选的意图类别过滤
   * @param topK 返回结果数量
   * @param minScore 最小相似度阈值
   */
  search(
    query: string,
    category?: string,
    topK: number = 3,
    minScore: number = 0.3
  ): Array<{ id: string; question: string; score: number; category: string }> {
    const queryVector = this.embedder.embed(query);
    
    // 计算相似度
    const scored = this.entries
      .filter(e => !category || e.category === category)
      .map(e => {
        const cosineScore = this.cosineSimilarity(queryVector, e.embedding);
        const bonus = this.keywordBonus(e.question, query);
        return {
          id: e.id,
          question: e.question,
          score: Math.min(cosineScore + bonus, 1.0),
          category: e.category,
        };
      })
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  /** 添加单条向量 */
  addEntry(faq: FaqKnowledge): void {
    this.entries.push({
      id: faq.id,
      question: faq.question,
      embedding: this.embedder.embed(faq.question + ' ' + (faq.keywords || '')),
      category: faq.category,
    });
  }

  /** 删除单条向量 */
  removeEntry(id: string): void {
    this.entries = this.entries.filter(e => e.id !== id);
  }
}

// 全局单例
let storeInstance: InMemoryVectorStore | null = null;

export function getVectorStore(): InMemoryVectorStore {
  if (!storeInstance) {
    storeInstance = new InMemoryVectorStore();
  }
  return storeInstance;
}

export function reloadVectorStore(): void {
  if (storeInstance) {
    storeInstance.reload();
  } else {
    storeInstance = new InMemoryVectorStore();
  }
}
