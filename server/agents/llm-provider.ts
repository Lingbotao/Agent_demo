/**
 * 统一 LLM Provider 抽象层
 * 使用 LangChain ChatOpenAI 替代手写 HTTP+SSE 调用。
 * 支持：MiniMax / OpenAI 兼容 / 任意 OpenAI 格式 API
 *
 * 通过环境变量自动切换：
 *   - MINIMAX_API_KEY → MiniMax
 *   - OPENAI_API_KEY   → OpenAI 兼容
 *   - 无 Key           → 演示兜底
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage } from "@langchain/core/messages";

// ---- 对外接口（保持不变） ----

interface LLMChatOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  onText?: (text: string) => void;
  /** 历史对话（OpenAI Chat Completions 风格，按时间顺序） */
  history?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
}

interface LLMResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

interface LLMProvider {
  name: string;
  chat(options: LLMChatOptions): Promise<LLMResponse>;
}

// ---- 消息格式转换 ----

function buildMessages(options: LLMChatOptions) {
  const msgs: (SystemMessage | HumanMessage | AIMessage)[] = [];

  if (options.systemPrompt) {
    msgs.push(new SystemMessage(options.systemPrompt));
  }

  if (options.history && options.history.length > 0) {
    for (const h of options.history) {
      if (!h?.role || !h?.content) continue;
      if (h.role === 'system') msgs.push(new SystemMessage(h.content));
      else if (h.role === 'assistant') msgs.push(new AIMessage(h.content));
      else msgs.push(new HumanMessage(h.content));
    }
  }

  msgs.push(new HumanMessage(options.prompt));
  return msgs;
}

// ---- ChatOpenAI Provider ----

class LangChainChatProvider implements LLMProvider {
  name: string;
  private llm: ChatOpenAI;
  private defaultModel: string;

  constructor(config: { apiKey: string; baseURL: string; defaultModel: string; name?: string }) {
    this.name = config.name || 'LangChain';
    this.defaultModel = config.defaultModel;

    this.llm = new ChatOpenAI({
      apiKey: config.apiKey,
      configuration: { baseURL: config.baseURL },
      model: config.defaultModel,
      temperature: 0.7,
      maxTokens: 2048,
    });
  }

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const model = options.model || this.defaultModel;

    // 如果指定了不同模型，临时创建一个新实例
    const llm =
      model !== this.defaultModel
        ? new ChatOpenAI({
            apiKey: this.llm.clientConfig?.apiKey as string,
            configuration: { baseURL: (this.llm as any).clientConfig?.baseURL },
            model,
            temperature: options.temperature ?? 0.7,
            maxTokens: options.maxTokens ?? 2048,
          })
        : this.llm;

    const messages = buildMessages(options);

    // 流式模式
    if (options.onText) {
      const stream = await llm.stream(messages);
      let fullContent = '';

      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string'
          ? chunk.content
          : Array.isArray(chunk.content)
            ? chunk.content.map((b: any) => b.text || '').join('')
            : '';

        if (text) {
          fullContent += text;
          options.onText(text);
        }
      }

      return { content: fullContent, model };
    }

    // 非流式模式
    const result = await llm.invoke(messages);
    const content = typeof result.content === 'string'
      ? result.content
      : Array.isArray(result.content)
        ? result.content.map((b: any) => b.text || '').join('')
        : '';

    return {
      content,
      model,
      usage: result.usage_metadata
        ? {
            promptTokens: (result.usage_metadata as any).input_tokens || 0,
            completionTokens: (result.usage_metadata as any).output_tokens || 0,
          }
        : undefined,
    };
  }
}

// ---- Provider 检测和创建 ----

let cachedProvider: LLMProvider | null = null;

export async function getLLMProvider(): Promise<LLMProvider> {
  if (cachedProvider) return cachedProvider;

  const minimaxKey = process.env.MINIMAX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // 1. MiniMax API
  if (minimaxKey) {
    console.log('[LLM] 使用 MiniMax API (LangChain ChatOpenAI)');
    cachedProvider = new LangChainChatProvider({
      apiKey: minimaxKey,
      baseURL: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
      defaultModel: process.env.MINIMAX_MODEL || 'MiniMax-M1',
      name: 'MiniMax',
    });
    return cachedProvider;
  }

  // 2. 通用 OpenAI 兼容 API
  if (openaiKey) {
    console.log('[LLM] 使用 OpenAI 兼容 API (LangChain ChatOpenAI)');
    cachedProvider = new LangChainChatProvider({
      apiKey: openaiKey,
      baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      name: 'OpenAI Compatible',
    });
    return cachedProvider;
  }

  // 3. 兜底：假 Provider（演示模式）
  console.warn('[LLM] ⚠️ 未配置任何 API Key，使用模拟回复模式');
  cachedProvider = createFallbackProvider();
  return cachedProvider;
}

function createFallbackProvider(): LLMProvider {
  return {
    name: 'Fallback',
    async chat(options: LLMChatOptions): Promise<LLMResponse> {
      const msg = `您好！感谢您的咨询。

⚠️ 当前为演示模式（未配置 LLM API Key）。

关于「${options.prompt.slice(0, 30)}」的问题：

1. 您可以设置 MINIMAX_API_KEY 环境变量来启用 MiniMax
2. 也支持任何 OpenAI 兼容的 API（OPENAI_API_KEY + OPENAI_BASE_URL）

如需转人工服务，请回复"转人工"。`;

      options.onText?.(msg);
      return { content: msg, model: 'fallback' };
    },
  };
}

export function clearProviderCache(): void {
  cachedProvider = null;
}
