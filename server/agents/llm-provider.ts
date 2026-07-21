/**
 * 统一 LLM Provider 抽象层
 * 支持多种 LLM 后端，通过环境变量自动切换：
 *   - CodeBuddy SDK (CODEBUDDY_API_KEY)
 *   - MiniMax API (MINIMAX_API_KEY)
 *   - 任意 OpenAI 兼容 API (OPENAI_API_KEY + OPENAI_BASE_URL)
 */

interface LLMChatOptions {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  onText?: (text: string) => void;
}

interface LLMResponse {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** 抽象 LLM Provider */
interface LLMProvider {
  name: string;
  chat(options: LLMChatOptions): Promise<LLMResponse>;
}

// ============== CodeBuddy SDK Provider ==============

let codeBuddyQuery: any = null;

async function getCodeBuddyQuery() {
  if (codeBuddyQuery) return codeBuddyQuery;
  try {
    const sdk = await import('@tencent-ai/agent-sdk');
    codeBuddyQuery = sdk.query;
    return codeBuddyQuery;
  } catch {
    return null;
  }
}

class CodeBuddyProvider implements LLMProvider {
  name = 'CodeBuddy';

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const queryFn = await getCodeBuddyQuery();
    if (!queryFn) {
      throw new Error('CodeBuddy SDK 不可用，请安装 @tencent-ai/agent-sdk');
    }

    const stream = queryFn({
      prompt: options.prompt,
      options: {
        model: options.model || 'claude-sonnet-4',
        maxTurns: 5,
        systemPrompt: options.systemPrompt || '你是一个专业的智能客服助手。',
        permissionMode: 'default',
      },
    });

    let fullResponse = '';
    for await (const msg of stream) {
      if (msg.type === 'assistant') {
        const content = msg.message.content;
        if (typeof content === 'string') {
          fullResponse += content;
          options.onText?.(content);
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              fullResponse += block.text;
              options.onText?.(block.text);
            }
          }
        }
      }
    }

    return { content: fullResponse, model: options.model || 'claude-sonnet-4' };
  }
}

// ============== OpenAI 兼容 API Provider ==============
// 适用于 MiniMax、DeepSeek、Qwen、SiliconFlow 等所有 OpenAI 兼容接口

class OpenAICompatibleProvider implements LLMProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;

  constructor(config: { apiKey: string; baseUrl: string; defaultModel: string; name?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.defaultModel = config.defaultModel;
    this.name = config.name || 'OpenAI Compatible';
  }

  async chat(options: LLMChatOptions): Promise<LLMResponse> {
    const model = options.model || this.defaultModel;
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: options.prompt });

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens || 2048,
        temperature: options.temperature ?? 0.7,
        stream: options.onText ? true : false,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`LLM API 错误 (${response.status}): ${errBody.slice(0, 200)}`);
    }

    // 流式处理
    if (options.onText && response.body) {
      return this.handleStream(response.body, model, options.onText);
    }

    // 非流式处理
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    return {
      content,
      model,
      usage: data.usage,
    };
  }

  /** 处理 SSE 流式响应 */
  private async handleStream(
    body: ReadableStream<Uint8Array>,
    model: string,
    onText: (text: string) => void
  ): Promise<LLMResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const dataStr = trimmed.slice(6);

        if (dataStr === '[DONE]') continue;

        try {
          const data = JSON.parse(dataStr);
          const delta = data.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            onText(delta);
          }
        } catch {
          // 跳过解析失败的行
        }
      }
    }

    return { content: fullContent, model };
  }
}

// ============== Provider 检测和创建 ==============

let cachedProvider: LLMProvider | null = null;

/**
 * 自动检测可用的 LLM Provider
 * 优先级: CodeBuddy > MiniMax > OpenAI 兼容 > 默认兜底
 */
export async function getLLMProvider(): Promise<LLMProvider> {
  if (cachedProvider) return cachedProvider;

  const codeBuddyKey = process.env.CODEBUDDY_API_KEY;
  const minimaxKey = process.env.MINIMAX_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  // 1. CodeBuddy SDK
  if (codeBuddyKey) {
    const sdkAvailable = await getCodeBuddyQuery();
    if (sdkAvailable) {
      console.log('[LLM] 使用 CodeBuddy SDK Provider');
      cachedProvider = new CodeBuddyProvider();
      return cachedProvider;
    }
  }

  // 2. MiniMax API
  if (minimaxKey) {
    console.log('[LLM] 使用 MiniMax API Provider');
    cachedProvider = new OpenAICompatibleProvider({
      apiKey: minimaxKey,
      baseUrl: process.env.MINIMAX_BASE_URL || 'https://api.minimax.chat/v1',
      defaultModel: process.env.MINIMAX_MODEL || 'MiniMax-M1',
      name: 'MiniMax',
    });
    return cachedProvider;
  }

  // 3. 通用 OpenAI 兼容 API
  if (openaiKey) {
    console.log('[LLM] 使用 OpenAI 兼容 API Provider');
    cachedProvider = new OpenAICompatibleProvider({
      apiKey: openaiKey,
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      defaultModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      name: 'OpenAI Compatible',
    });
    return cachedProvider;
  }

  // 4. 兜底：假 Provider（开发/演示用）
  console.warn('[LLM] ⚠️ 未配置任何 API Key，使用模拟回复模式');
  cachedProvider = createFallbackProvider();
  return cachedProvider;
}

/** 无 API Key 时的兜底 Provider（返回预设回复） */
function createFallbackProvider(): LLMProvider {
  return {
    name: 'Fallback',
    async chat(options: LLMChatOptions): Promise<LLMResponse> {
      const msg = `您好！感谢您的咨询。

⚠️ 当前为演示模式（未配置 LLM API Key）。

关于「${options.prompt.slice(0, 30)}」的问题：

1. 您可以设置 MINIMAX_API_KEY 环境变量来启用 MiniMax
2. 或设置 CODEBUDDY_API_KEY 来使用 CodeBuddy SDK
3. 也支持任何 OpenAI 兼容的 API（OPENAI_API_KEY + OPENAI_BASE_URL）

如需转人工服务，请回复"转人工"。`;

      options.onText?.(msg);
      return { content: msg, model: 'fallback' };
    },
  };
}

/** 清除缓存的 Provider（切换配置后调用） */
export function clearProviderCache(): void {
  cachedProvider = null;
}
