import { Input } from 'tdesign-react';
import { FolderOpenIcon } from 'tdesign-icons-react';
import { Bot, Zap } from 'lucide-react';
import { APP_CONFIG } from '../config';
import { Model, Agent } from '../types';
import { ICON_MAP } from '../utils/iconMap';
import { useState, useEffect } from 'react';

interface FaqSuggestion {
  id: string;
  question: string;
  category: string;
}

interface NewChatViewProps {
  agents: Agent[];
  models: Model[];
  selectedModel: string;
  newChatAgentId: string;
  newChatCwd: string;
  onSelectModel: (modelId: string) => void;
  onSelectAgent: (agentId: string) => void;
  onSetCwd: (cwd: string) => void;
  onQuickQuestion?: (question: string) => void;
}

/** 分类标签映射 */
const CATEGORY_LABELS: Record<string, string> = {
  refund: '退款',
  order_inquiry: '订单查询',
  tech_support: '技术支持',
  general: '通用',
};

export function NewChatView({
  agents,
  newChatAgentId,
  newChatCwd,
  onSelectAgent,
  onSetCwd,
  onQuickQuestion,
}: NewChatViewProps) {
  const selectedAgent = agents.find(a => a.id === newChatAgentId);
  const [suggestions, setSuggestions] = useState<Record<string, FaqSuggestion[]>>({});

  useEffect(() => {
    fetch('/api/faq/suggestions')
      .then(r => r.json())
      .then(data => setSuggestions(data.suggestions || {}))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col items-center justify-center h-full">
      <div className="w-full max-w-lg">
        {/* Logo 和标题 */}
        <div className="text-center mb-8">
          <div 
            className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 shadow-lg mx-auto"
            style={{ 
              background: 'linear-gradient(135deg, var(--td-brand-color), var(--td-brand-color-hover))'
            }}
          >
            <span className="text-3xl font-bold text-white">{APP_CONFIG.nameInitial}</span>
          </div>
          <h2 
            className="text-2xl font-semibold mb-2"
            style={{ color: 'var(--td-text-color-primary)' }}
          >
            {APP_CONFIG.name}
          </h2>
          <p style={{ color: 'var(--td-text-color-secondary)' }}>
            选择一个 Agent 开始对话
          </p>
        </div>
        
        {/* Agent 选择 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-3" style={{ color: 'var(--td-text-color-primary)' }}>
            选择 Agent
          </label>
          <div className="grid grid-cols-2 gap-3 max-h-[280px] overflow-y-auto">
            {agents.map(agent => {
              const AgentIcon = ICON_MAP[agent.icon || 'Bot'] || Bot;
              const isSelected = agent.id === newChatAgentId;
              return (
                <div
                  key={agent.id}
                  className="p-3 rounded-xl cursor-pointer transition-all border-2"
                  style={{
                    borderColor: isSelected ? (agent.color || 'var(--td-brand-color)') : 'transparent',
                    backgroundColor: isSelected ? 'var(--td-brand-color-light)' : 'var(--td-bg-color-component)',
                  }}
                  onClick={() => {
                    onSelectAgent(agent.id);
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: agent.color || '#0052d9' }}
                    >
                      <AgentIcon size={20} color="white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate" style={{ color: 'var(--td-text-color-primary)' }}>
                        {agent.name}
                      </div>
                      {agent.description && (
                        <div className="text-xs truncate mt-0.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
                          {agent.description}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 工作目录 */}
        <div className="mb-6">
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--td-text-color-primary)' }}>
            工作目录 <span style={{ color: 'var(--td-text-color-placeholder)' }}>(可选)</span>
          </label>
          <Input
            value={newChatCwd}
            onChange={(v) => onSetCwd(v as string)}
            placeholder="例如：/Users/username/projects/my-app"
            prefixIcon={<FolderOpenIcon />}
          />
          <p className="text-xs mt-1.5" style={{ color: 'var(--td-text-color-placeholder)' }}>
            指定 Agent 的工作目录，用于文件操作等
          </p>
        </div>

        {/* 快捷问题推荐 */}
        {Object.keys(suggestions).length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={16} style={{ color: 'var(--td-warning-color)' }} />
              <label className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                快捷问题
              </label>
            </div>
            <div className="space-y-2">
              {Object.entries(suggestions).map(([category, items]) => (
                <div key={category} className="flex flex-wrap gap-2">
                  {items.map(item => (
                    <button
                      key={item.id}
                      className="text-xs px-3 py-1.5 rounded-full border transition-colors hover:opacity-80"
                      style={{
                        borderColor: 'var(--td-component-stroke)',
                        backgroundColor: 'var(--td-bg-color-component)',
                        color: 'var(--td-text-color-secondary)',
                      }}
                      onClick={() => onQuickQuestion?.(item.question)}
                    >
                      {CATEGORY_LABELS[category] || category}: {item.question}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 选中的 Agent 预览 */}
        {selectedAgent && (
          <div 
            className="p-4 rounded-xl"
            style={{ backgroundColor: 'var(--td-bg-color-component)' }}
          >
            <div className="flex items-center gap-2 mb-2">
              {(() => {
                const Icon = ICON_MAP[selectedAgent.icon || 'Bot'] || Bot;
                return (
                  <>
                    <div 
                      className="w-6 h-6 rounded-md flex items-center justify-center"
                      style={{ backgroundColor: selectedAgent.color || '#0052d9' }}
                    >
                      <Icon size={14} color="white" />
                    </div>
                    <span className="text-sm font-medium" style={{ color: 'var(--td-text-color-primary)' }}>
                      {selectedAgent.name}
                    </span>
                  </>
                );
              })()}
            </div>
            <p className="text-xs line-clamp-2" style={{ color: 'var(--td-text-color-secondary)' }}>
              {selectedAgent.systemPrompt}
            </p>
          </div>
        )}
        
        {/* 提示文字 */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--td-text-color-placeholder)' }}>
          模型可在输入框下方切换
        </p>
      </div>
    </div>
  );
}