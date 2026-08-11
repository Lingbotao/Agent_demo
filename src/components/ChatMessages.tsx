import { Loading, Tag } from 'tdesign-react';
import { ChatMarkdown } from '@tdesign-react/chat';
import { User, Bot, AlertCircle, CheckCircle2, FileSearch } from 'lucide-react';
import { Message, Model, PermissionRequest, ContentBlock } from '../types';
import { ToolCallsCollapse } from './ToolCallsCollapse';
import { InlinePermissionCard } from './InlinePermissionCard';

/** 意图标签映射 */
const INTENT_LABELS: Record<string, { label: string; theme: 'primary' | 'success' | 'warning' | 'danger' }> = {
  refund: { label: '退款', theme: 'danger' },
  order_inquiry: { label: '查订单', theme: 'primary' },
  tech_support: { label: '技术支持', theme: 'warning' },
  general: { label: '通用咨询', theme: 'success' },
};

interface ChatMessagesProps {
  messages: Message[];
  models: Model[];
  messagesEndRef: React.RefObject<HTMLDivElement>;
  // 内联权限确认相关
  permissionRequest?: PermissionRequest | null;
  onPermissionAllow?: () => void;
  onPermissionDeny?: () => void;
}

export function ChatMessages({ 
  messages, 
  models, 
  messagesEndRef,
  permissionRequest,
  onPermissionAllow,
  onPermissionDeny
}: ChatMessagesProps) {
  const formatModelName = (modelId: string) => {
    const model = models.find(m => m.modelId === modelId);
    const name = model?.name || modelId;
    return name
      .replace(/^(Claude|GPT|Gemini|Kimi|DeepSeek|Qwen|GLM)\s*/i, '')
      .replace(/-/g, ' ')
      .trim() || name;
  };

  // 把单个文本块按 <think>...</think> 拆成 [think | text] 段，think 用弱化样式渲染
  const renderTextBlock = (text: string, baseKey: string, isStreaming?: boolean, isLast?: boolean) => {
    const parts: Array<{ kind: 'think' | 'text'; content: string }> = [];
    const regex = /<think>([\s\S]*?)(?:<\/think>|$)/g;
    let lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > lastIndex) {
        parts.push({ kind: 'text', content: text.slice(lastIndex, m.index) });
      }
      parts.push({ kind: 'think', content: m[1] });
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < text.length) {
      parts.push({ kind: 'text', content: text.slice(lastIndex) });
    }
    if (parts.length === 0) parts.push({ kind: 'text', content: text });

    return parts.map((part, i) => {
      const isLastPart = i === parts.length - 1;
      if (part.kind === 'think') {
        return (
          <div
            key={`${baseKey}-think-${i}`}
            className="px-3 py-2 text-xs italic leading-relaxed break-words"
            style={{
              color: 'var(--td-text-color-placeholder)',
              borderLeft: '2px solid var(--td-component-stroke)',
              borderRadius: '4px',
              backgroundColor: 'transparent',
            }}
          >
            <div className="opacity-80">{part.content}</div>
          </div>
        );
      }
      return (
        <div
          key={`${baseKey}-text-${i}`}
          className="px-4 py-3 leading-relaxed break-words"
          style={{
            backgroundColor: 'var(--td-bg-color-component)',
            color: 'var(--td-text-color-primary)',
            borderRadius: '16px 16px 16px 4px'
          }}
        >
          <div className="chat-markdown">
            <ChatMarkdown content={part.content} />
          </div>
          {isStreaming && isLast && isLastPart && (
            <span
              className="animate-cursor-blink ml-0.5"
              style={{ color: 'var(--td-brand-color)' }}
            >
              |
            </span>
          )}
        </div>
      );
    });
  };

  // 渲染单个内容块
  const renderContentBlock = (block: ContentBlock, index: number, isStreaming?: boolean, isLast?: boolean) => {
    if (block.type === 'text') {
      return (
        <div key={`text-${index}`} className="flex flex-col gap-2">
          {renderTextBlock(block.text, `b${index}`, isStreaming, isLast)}
        </div>
      );
    } else if (block.type === 'tool_use') {
      return (
        <ToolCallsCollapse
          key={`tool-${block.toolCall.id}`}
          toolCalls={[block.toolCall]}
          isStreaming={isStreaming && block.toolCall.status === 'running'}
        />
      );
    }
    return null;
  };

  // 渲染 assistant 消息内容
  const renderAssistantContent = (message: Message) => {
    // 优先使用 contentBlocks（按顺序排列）
    if (message.contentBlocks && message.contentBlocks.length > 0) {
      return message.contentBlocks.map((block, index) => 
        renderContentBlock(block, index, message.isStreaming, index === message.contentBlocks!.length - 1)
      );
    }
    
    // 兼容旧数据：先显示所有工具调用，再显示文本
    return (
      <>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <ToolCallsCollapse
            toolCalls={message.toolCalls}
            isStreaming={message.isStreaming}
          />
        )}
        {message.content && (
          <div className="flex flex-col gap-2">
            {renderTextBlock(message.content, 'legacy', message.isStreaming, true)}
          </div>
        )}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-3xl mx-auto">
      {messages.map(message => (
        <div 
          key={message.id} 
          className={`flex gap-3 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
        >
          <div 
            className="w-9 h-9 flex items-center justify-center flex-shrink-0 rounded-full self-start"
            style={{
              backgroundColor: message.role === 'user' 
                ? 'var(--td-brand-color)' 
                : 'var(--td-bg-color-component)',
              color: message.role === 'user' 
                ? 'white' 
                : 'var(--td-text-color-primary)'
            }}
          >
            {message.role === 'user' ? <User size={18} /> : <Bot size={18} />}
          </div>
          <div 
            className={`flex flex-col gap-2 max-w-[80%] ${message.role === 'user' ? 'items-end' : ''}`}
          >
            {message.role === 'assistant' && message.model && (
              <div className="flex items-center gap-2">
                <span 
                  className="text-xs"
                  style={{ color: 'var(--td-text-color-placeholder)' }}
                >
                  {formatModelName(message.model)}
                </span>
                {/* 意图标签 */}
                {message.intent && INTENT_LABELS[message.intent] && (
                  <Tag size="small" theme={INTENT_LABELS[message.intent].theme} variant="dark">
                    {INTENT_LABELS[message.intent].label}
                  </Tag>
                )}
              </div>
            )}

            {/* 工作流元数据 */}
            {message.workflowMeta && (
              <div className="flex items-center gap-2 text-xs">
                {message.workflowMeta.usedFaq && (
                  <Tag size="small" theme="primary" variant="dark" icon={<FileSearch size={12} />}>
                    知识库匹配
                  </Tag>
                )}
                {message.workflowMeta.shouldEscalate && (
                  <Tag size="small" theme="warning" variant="dark" icon={<AlertCircle size={12} />}>
                    已转人工
                  </Tag>
                )}
                {!message.workflowMeta.usedFaq && !message.workflowMeta.shouldEscalate && (
                  <Tag size="small" theme="success" variant="dark" icon={<CheckCircle2 size={12} />}>
                    AI 回复
                  </Tag>
                )}
              </div>
            )}
            
            {/* 用户消息 */}
            {message.role === 'user' && (
              <div 
                className="px-4 py-3 leading-relaxed break-words"
                style={{
                  backgroundColor: 'var(--td-brand-color)',
                  color: 'white',
                  borderRadius: '16px 16px 4px 16px'
                }}
              >
                {message.content}
              </div>
            )}
            
            {/* 助手消息 - 按顺序渲染内容块 */}
            {message.role === 'assistant' && renderAssistantContent(message)}
            
            {/* 思考中状态（没有任何内容时显示） */}
            {message.role === 'assistant' && message.isStreaming && 
             !message.content && 
             (!message.contentBlocks || message.contentBlocks.length === 0) && 
             (!message.toolCalls || message.toolCalls.length === 0) && (
              <div 
                className="flex items-center gap-2 px-3 py-2 rounded-lg"
                style={{ backgroundColor: 'var(--td-bg-color-component)' }}
              >
                <Loading size="small" />
                <span 
                  className="text-sm"
                  style={{ color: 'var(--td-text-color-secondary)' }}
                >
                  思考中...
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
      
      {/* 内联权限确认 - 横向简洁展示 */}
      {permissionRequest && onPermissionAllow && onPermissionDeny && (
        <div className="flex gap-3 ml-12">
          <InlinePermissionCard
            request={permissionRequest}
            onAllow={onPermissionAllow}
            onDeny={onPermissionDeny}
          />
        </div>
      )}
      
      <div ref={messagesEndRef} />
    </div>
  );
}
