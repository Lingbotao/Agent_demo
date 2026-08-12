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
        })
      });

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

                  setSessions(prev => prev.map(s => {
                    if (s.id === realSessionId) {
                      return {
                        ...s,
                        messages: s.messages.map(m =>
                          m.id === tempAssistantMessageId
                            ? { ...m, id: realAssistantMessageId }
                            : m
                        )
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

  return {
    isLoading,
    inputValue,
    setInputValue: saveInput,
    sendMessage,
    handleStop,
  };
}
