/**
 * 向量存储模块 (LangChain Embedding + 轻量内存存储)
 *
 * Embedding: LangChain OpenAIEmbeddings → MiniMax embo-01 或 OpenAI text-embedding-3
 * 存储:     内存向量数组 + 余弦相似度检索
 *
 * 用 LangChain 的 Embedding 层替换了 TF-IDF，语义匹配能力质的飞跃。
 */

import { OpenAIEmbeddings } from "@langchain/openai";
import { Document } from "@langchain/core/documents";
import * as db from "../db.js";
import type { FaqKnowledge } from "../db.js";

// ---- LangChain Embeddings 实例 ----

function createEmbeddings(): OpenAIEmbeddings {
  const apiKey = process.env.MINIMAX_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseURL =
    process.env.MINIMAX_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    "https://api.openai.com/v1";
  const model =
    process.env.MINIMAX_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL || "text-embedding-3-small";

  return new OpenAIEmbeddings({
    apiKey,
    configuration: { baseURL, timeout: 15000 },
    model,
    maxRetries: 1,
    maxConcurrency: 5,
  });
}

// ---- 向量条目 ----

interface VectorEntry {
  id: string;
  question: string;
  vector: number[];
  category: string;
}

// ---- 余弦相似度 ----

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

// ---- LangChain 向量存储封装 ----

class LangChainVectorStore {
  private entries: VectorEntry[] = [];
  private embeddings: OpenAIEmbeddings;
  private ready = false;

  constructor() {
    this.embeddings = createEmbeddings();
  }

  /** 从数据库全量重建（生成 embedding 并建索引） */
  async reload(): Promise<void> {
    const faqList = db.getAllFaq();
    if (faqList.length === 0) {
      this.entries = [];
      this.ready = true;
      return;
    }

    try {
      // 批量生成 embedding
      const texts = faqList.map(f => `${f.question}\n${f.keywords || ""}`);
      const vectors = await this.embeddings.embedDocuments(texts);

      this.entries = faqList.map((faq, i) => ({
        id: faq.id,
        question: faq.question,
        vector: vectors[i],
        category: faq.category,
      }));
      this.ready = true;
    } catch (error: any) {
      console.error(`[VectorStore] Embedding API 不可用 (${error.message?.slice(0, 80)})`);
      // 降级：标记为 ready，后续 search 会直接返回空（不阻塞服务器启动）
      this.entries = [];
      this.ready = true;
    }
  }

  async ensureInit(): Promise<void> {
    if (!this.ready) await this.reload();
  }

  /**
   * 语义搜索
   */
  async search(
    query: string,
    category?: string,
    topK: number = 3,
    minScore: number = 0.3,
  ): Promise<Array<{ id: string; question: string; score: number; category: string }>> {
    await this.ensureInit();
    if (this.entries.length === 0) return [];

    try {
      // 生成查询向量
      const queryVec = await this.embeddings.embedQuery(query);

      // 余弦相似度排序
      return this.entries
        .filter(e => !category || e.category === category)
        .map(e => ({
          id: e.id,
          question: e.question,
          score: cosineSimilarity(queryVec, e.vector),
          category: e.category,
        }))
        .filter(r => r.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    } catch (error: any) {
      console.error(`[VectorStore] 检索失败: ${error.message?.slice(0, 80)}`);
      return [];
    }
  }

  /** 添加单条 FAQ */
  async addEntry(faq: FaqKnowledge): Promise<void> {
    await this.ensureInit();
    try {
      const [vec] = await this.embeddings.embedDocuments([
        `${faq.question}\n${faq.keywords || ""}`,
      ]);
      this.entries.push({
        id: faq.id,
        question: faq.question,
        vector: vec,
        category: faq.category,
      });
    } catch (error: any) {
      console.error(`[VectorStore] 添加条目失败: ${error.message?.slice(0, 80)}`);
    }
  }

  /** 删除指定 ID */
  async removeEntry(id: string): Promise<void> {
    await this.ensureInit();
    this.entries = this.entries.filter(e => e.id !== id);
  }
}

// ---- 全局单例 ----

let storeInstance: LangChainVectorStore | null = null;

export function getVectorStore(): LangChainVectorStore {
  if (!storeInstance) {
    storeInstance = new LangChainVectorStore();
  }
  return storeInstance;
}

export function reloadVectorStore(): void {
  if (storeInstance) {
    storeInstance.reload();
  } else {
    storeInstance = new LangChainVectorStore();
  }
}
