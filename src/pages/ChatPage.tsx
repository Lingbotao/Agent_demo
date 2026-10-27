import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Model, Session, CustomAgent } from '../types';
import { NewChatView } from '../components/NewChatView';
import { ChatMessages } from '../components/ChatMessages';
import { ChatInput } from '../components/ChatInput';
import SatisfactionRating from '../components/SatisfactionRating';
import { Button, Dropdown } from 'tdesign-react';
import { DownloadIcon } from 'tdesign-icons-react';

interface ChatPageProps {
  currentSession: Session | undefined;
  models: Model[];
  selectedModel: string;
  agents: CustomAgent[];
  isLoading: boolean;
  inputValue: string;
  onSendMessage: (message: string, newChatOptions?: NewChatOptions, onNavigate?: (path: string) => void) => void;
  onStop: () => void;
  onInputChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
  onRecallMessage?: (messageId: string) => void;
}

interface NewChatOptions {
  agentId: string;
}

export function ChatPage({
  currentSession,
  models,
  selectedModel,
  agents,
  isLoading,
  inputValue,
  onSendMessage,
  onStop,
  onInputChange,
  onModelChange,
  onRecallMessage,
}: ChatPageProps) {
  const navigate = useNavigate();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 新对话页面状态
  const [newChatAgentId, setNewChatAgentId] = useState('default');
  const [newChatCwd, setNewChatCwd] = useState('');

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages]);

  // 处理发送消息
  const handleSend = useCallback((message: string) => {
    if (!currentSession) {
      // 新对话
      onSendMessage(message, {
        agentId: newChatAgentId,
      }, (path) => {
        // 重置新对话选项
        setNewChatAgentId('default');
        navigate(path);
      });
    } else {
      onSendMessage(message);
    }
  }, [currentSession, newChatAgentId, onSendMessage, navigate]);

  // 处理快捷问题点击
  const handleQuickQuestion = useCallback((question: string) => {
    handleSend(question);
  }, [handleSend]);

  // 处理导出对话
  const handleExport = useCallback((format: 'json' | 'markdown') => {
    if (!currentSession) return;
    const url = `/api/sessions/${currentSession.id}/export?format=${format}`;
    window.open(url, '_blank');
  }, [currentSession]);

  const showNewChatView = !currentSession || currentSession.messages.length === 0;

  return (
    <>
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {showNewChatView ? (
          <NewChatView
            agents={agents}
            models={models}
            selectedModel={selectedModel}
            newChatAgentId={newChatAgentId}
            newChatCwd={newChatCwd}
            onSelectModel={onModelChange}
            onSelectAgent={setNewChatAgentId}
            onSetCwd={setNewChatCwd}
            onQuickQuestion={handleQuickQuestion}
          />
        ) : (
          <>
            <ChatMessages
              messages={currentSession!.messages}
              models={models}
              messagesEndRef={messagesEndRef}
              onRecallMessage={onRecallMessage}
            />
            {/* 导出按钮 */}
            {currentSession && currentSession.messages.length > 0 && (
              <div className="flex justify-center mt-4">
                <Dropdown
                  options={[
                    { content: '导出 JSON', value: 'json' },
                    { content: '导出 Markdown', value: 'markdown' },
                  ]}
                  onClick={(data) => handleExport(data.value as 'json' | 'markdown')}
                >
                  <Button variant="outline" size="small" icon={<DownloadIcon />}>
                    导出对话
                  </Button>
                </Dropdown>
              </div>
            )}
          </>
        )}
        {/* 会话结束后显示满意度评分 */}
        {currentSession && currentSession.messages.length > 0 && !isLoading && (
          <SatisfactionRating sessionId={currentSession.id} />
        )}
      </div>

      {/* 输入区域 */}
      <ChatInput
        inputValue={inputValue}
        selectedModel={selectedModel}
        models={models}
        isLoading={isLoading}
        onSend={handleSend}
        onStop={onStop}
        onChange={onInputChange}
        onModelChange={onModelChange}
      />
    </>
  );
}
