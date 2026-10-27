import { useState, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { Message, Session, CustomAgent, CSAgentWorkflowMeta } from '../types';
import { useAuth } from './useAuth';

const STORAGE_KEYS = {
  draftInput: 'draftInput',
};

interface UseChatOptions {
  currentSession: Session | undefined;
  currentSessionId: string | null;
  selectedModel: string;
  getAgent: (id: string) => CustomAgent | undefined;
  addSession: (session: Session) => void;
  updateSession: (sessionId: string, updates: Partial<Session>) => void;
  updateSessionMessages: (sessionId: string, updater: (messages: Message[]) => Message[]) => void;
  updateSessionModel: (sessionId: string, modelId: string) => void;
  setCurrentSessionId: (id: string | null) => void;
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>;
}

interface NewChatOptions {
  agentId: string;
}

export function useChat(options: UseChatOptions) {
  const {
    currentSession,
    currentSessionId,
    selectedModel,
    getAgent,
    updateSessionModel,
    setCurrentSessionId,
    setSessions,
  } = options;
  const { authHeader } = useAuth();

  const [isLoading, setIsLoading] = useState(false);
  const [inputValue, setInputValue] = useState(() => {
    return localStorage.getItem(STORAGE_KEYS.draftInput) || '';
  });

  // 保存输入框内容到 localStorage（防抖）
  const saveInput = useCallback((value: string) => {
    setInputValue(value);
  }, []);

  // 发送消息
  const sendMessage = useCallback(async (
    messageContent: string,
    newChatOptions?: NewChatOptions,
    onNavigate?: (path: string) => void
  ) => {
    if (!messageContent.trim() || isLoading) return;

    let sessionId = currentSessionId;
    let currentAgentId = currentSession?.agentId || 'default';

    // 如果没有当前会话，使用新对话页面的选项创建新会话
    if (!sessionId && newChatOptions) {
      const newSession: Session = {
        id: uuidv4(),
        title: messageContent.slice(0, 30) + (messageContent.length > 30 ? '...' : ''),
        model: selectedModel,
        agentId: newChatOptions.agentId,
        createdAt: new Date(),
        messages: []
      };

      setSessions(prev => [newSession, ...prev]);
      setCurrentSessionId(newSession.id);
      sessionId = newSession.id;
      currentAgentId = newSession.agentId || 'default';

      updateSessionModel(newSession.id, selectedModel);

      onNavigate?.(`/chat/${newSession.id}`);
    }

    const tempUserMessageId = uuidv4();
    const tempAssistantMessageId = uuidv4();

    const userMessage: Message = {
      id: tempUserMessageId,
      role: 'user',
      content: messageContent,
      timestamp: new Date()
    };

    const assistantMessage: Message = {
      id: tempAssistantMessageId,
      role: 'assistant',
      content: '',
      model: selectedModel,
      timestamp: new Date(),
      isStreaming: true,
      contentBlocks: []
    };

    setSessions(prev => prev.map(s => {
      if (s.id === sessionId) {
        const newTitle = s.messages.length === 0
          ? messageContent.slice(0, 30) + (messageContent.length > 30 ? '...' : '')
          : s.title;
        return {
          ...s,
          title: newTitle,
          messages: [...s.messages, userMessage, assistantMessage]
        };
      }
      return s;
    }));

    setInputValue('');
    localStorage.removeItem(STORAGE_KEYS.draftInput);
    setIsLoading(true);

    const agent = getAgent(currentAgentId);
    const systemPrompt = agent?.systemPrompt;

    try {
      // 判断是否使用智能客服 Agent
      const isCSAgent = selectedModel === 'cs-agent';
      const apiUrl = isCSAgent ? '/api/cs-agent/chat' : '/api/chat';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          sessionId,
          message: messageContent,
          model: selectedModel,
          systemPrompt: isCSAgent ? undefined : systemPrompt,
          // 把前端临时 user 消息 ID 传给服务端，避免后续撤回时 ID 不匹配
          clientMessageId: tempUserMessageId,
        })
      });

      // 输入端敏感词命中：返回非 SSE 错误
      if (response.status === 400) {
        const ct = response.headers.get('content-type') || '';
        if (!ct.includes('text/event-stream')) {
          const data = await response.json();
          const reason = data?.reasons?.join('；') || data?.error || '请求被拦截';
          setSessions(prev => prev.map(s => {
            if (s.id === sessionId) {
              return {
                ...s,
                messages: s.messages.map(m =>
                  m.id === tempAssistantMessageId
                    ? { ...m, content: `⚠️ ${reason}`, isStreaming: false }
                    : m
                )
              };
            }
            return s;
          }));
          return;
        }
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';
      let usedModel = selectedModel;
      let realSessionId: string = sessionId!;
      let realAssistantMessageId = tempAssistantMessageId;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === 'init') {
                  realSessionId = data.sessionId;
                  realAssistantMessageId = data.assistantMessageId;
                  usedModel = data.model;

                  if (realSessionId !== sessionId) {
                    setSessions(prev => prev.map(s =>
                      s.id === sessionId ? { ...s, id: realSessionId } : s
                    ));
                    setCurrentSessionId(realSessionId);
                    sessionId = realSessionId;
                  }

                  // 如果服务端返回的 userMessageId 不同于前端临时 ID（旧服务端兼容），同步之
                  const serverUserId = data.userMessageId as string | undefined;
                  const targetUserId = (serverUserId && serverUserId !== tempUserMessageId)
                    ? serverUserId
                    : tempUserMessageId;

                  setSessions(prev => prev.map(s => {
                    if (s.id === realSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m => {
                          if (m.id === tempAssistantMessageId) {
                            return { ...m, id: realAssistantMessageId };
                          }
                          if (serverUserId && m.id === tempUserMessageId) {
                            return { ...m, id: targetUserId };
                          }
                          return m;
                        })
                      };
                    }
                    return s;
                  }));
                } else if (data.type === 'text') {
                  fullContent += data.content;

                  setSessions(prev => prev.map(s => {
                    if (s.id === realSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === realAssistantMessageId
                            ? { ...m, content: fullContent, model: usedModel }
                            : m
                        )
                      };
                    }
                    return s;
                  }));
                } else if (data.type === 'done') {
                  setSessions(prev => prev.map(s => {
                    if (s.id === realSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === realAssistantMessageId
                            ? { ...m, isStreaming: false }
                            : m
                        )
                      };
                    }
                    return s;
                  }));
                } else if (data.type === 'intent') {
                  // CS Agent: 意图识别结果
                  setSessions(prev => prev.map(s => {
                    if (s.id === realSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === realAssistantMessageId
                            ? { ...m, intent: data.intent, intentConfidence: data.confidence }
                            : m
                        )
                      };
                    }
                    return s;
                  }));
                } else if (data.type === 'workflow_meta') {
                  // CS Agent: 工作流元数据
                  const wm: CSAgentWorkflowMeta = {
                    intent: data.intent,
                    usedFaq: data.usedFaq,
                    shouldEscalate: data.shouldEscalate,
                    ticketId: data.ticketId,
                    faqScore: data.faqScore,
                  };
                  setSessions(prev => prev.map(s => {
                    if (s.id === realSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === realAssistantMessageId
                            ? { ...m, workflowMeta: wm }
                            : m
                        )
                      };
                    }
                    return s;
                  }));
                }
              } catch {
                // 忽略解析错误
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      setSessions(prev => prev.map(s => {
        if (s.id === sessionId) {
          return {
            ...s,
            messages: s.messages.map(m =>
              m.id === tempAssistantMessageId
                ? { ...m, content: '发生错误，请重试', isStreaming: false }
                : m
            )
          };
        }
        return s;
      }));
    } finally {
      setIsLoading(false);
    }
  }, [currentSession, currentSessionId, selectedModel, getAgent, updateSessionModel, setCurrentSessionId, setSessions, isLoading]);

  // 处理停止事件
  const handleStop = useCallback(() => {
    console.log('ChatSender stop event');
    setIsLoading(false);
  }, []);

  // 撤回消息
  const recallMessage = useCallback(async (messageId: string) => {
    if (!messageId || typeof messageId !== 'string' || messageId.length < 8) {
      console.error('[Recall] messageId 格式异常:', messageId);
      return;
    }
    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}/recall`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        // 成对撤回：用户消息 + 紧随其后的 assistant 消息
        const assistantId = data.assistantMessageId as string | undefined;
        setSessions(prev => prev.map(s => ({
          ...s,
          messages: s.messages.map(m => {
            if (m.id === messageId) {
              return { ...m, content: '[消息已撤回]', status: 'recalled' };
            }
            if (assistantId && m.id === assistantId) {
              return { ...m, content: '[消息已撤回]', status: 'recalled' };
            }
            return m;
          })
        })));
        if (data.alreadyRecalled) {
          console.log('[Recall] 消息已是 recalled 状态，跳过更新');
        }
        if (assistantId) {
          console.log(`[Recall] 已配对撤回 user=${messageId} + assistant=${assistantId}`);
        }
      } else {
        let errBody: any = null;
        try { errBody = await response.json(); } catch {}
        const errMsg = errBody?.error || `HTTP ${response.status}`;
        console.error(`[Recall] 失败 (${response.status}): ${errMsg}`, errBody);
        // 即便服务端失败，也在前端做视觉撤回（乐观更新），但保留 status 用于排查
        setSessions(prev => prev.map(s => ({
          ...s,
          messages: s.messages.map(m =>
            m.id === messageId
              ? { ...m, content: '[消息已撤回]', status: 'client-recalled-failed' }
              : m
          )
        })));
      }
    } catch (error) {
      console.error('[Recall] 网络错误:', error);
    }
  }, [setSessions, authHeader]);

  return {
    isLoading,
    inputValue,
    setInputValue: saveInput,
    sendMessage,
    handleStop,
    recallMessage,
  };
}
