import { useRef, useCallback } from 'react';
import { Select } from 'tdesign-react';
import { ChatSender } from '@tdesign-react/chat';
import { ChevronDownIcon } from 'tdesign-icons-react';
import { Model } from '../types';

interface ChatInputProps {
  inputValue: string;
  selectedModel: string;
  models: Model[];
  isLoading: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
  onChange: (value: string) => void;
  onModelChange: (modelId: string) => void;
}

export function ChatInput({
  inputValue,
  selectedModel,
  models,
  isLoading,
  onSend,
  onStop,
  onChange,
  onModelChange,
}: ChatInputProps) {
  const chatSenderRef = useRef<any>(null);

  const handleSend = useCallback((e: any) => {
    console.log('ChatSender send event:', e);
    const content = e?.detail?.message || e?.detail || e?.message || inputValue;
    if (content && typeof content === 'string' && content.trim() && selectedModel) {
      onSend(content.trim());
    } else if (inputValue.trim() && selectedModel) {
      onSend(inputValue.trim());
    }
  }, [inputValue, selectedModel, onSend]);

  const handleChange = useCallback((e: any) => {
    console.log('ChatSender change event:', e);
    const value = e?.detail ?? e ?? '';
    onChange(typeof value === 'string' ? value : '');
  }, [onChange]);

  return (
    <div
      className="px-4 pb-6 pt-4"
      style={{
        backgroundColor: 'var(--td-bg-color-page)'
      }}
    >
      <div className="max-w-3xl mx-auto">
        <ChatSender
          ref={chatSenderRef}
          value={inputValue}
          placeholder="输入消息..."
          disabled={!selectedModel}
          loading={isLoading}
          autosize={{ minRows: 1, maxRows: 6 }}
          actions={['send']}
          onSend={handleSend}
          onStop={onStop}
          onChange={handleChange}
        >
          {/* 模型选择器放在 footer-prefix 插槽 */}
          <div slot="footer-prefix" className="flex items-center gap-2">
            <Select
              value={selectedModel}
              onChange={(value) => onModelChange(value as string)}
              placeholder="选择模型"
              size="small"
              style={{ width: 160 }}
              filterable
              borderless
              suffixIcon={<ChevronDownIcon />}
            >
              {models.map(model => (
                <Select.Option key={model.modelId} value={model.modelId} label={model.name} />
              ))}
            </Select>
          </div>
        </ChatSender>
      </div>
    </div>
  );
}
