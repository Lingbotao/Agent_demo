import { useState, useEffect, useCallback } from 'react';
import { Model } from '../types';

const STORAGE_KEY = 'defaultModel';

export function useModels() {
  const [models, setModels] = useState<Model[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEY) || '';
  });

  const fetchModels = useCallback(async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      const apiModels = data.models || [];
      
      // 添加智能客服 Agent 模型
      const csAgentModel: Model = {
        modelId: 'cs-agent',
        name: '智能客服 Agent',
        description: '具备意图识别、FAQ知识库检索、自动转人工能力的智能客服',
      };
      
      const allModels = [...apiModels, csAgentModel];
      setModels(allModels);
      
      if (allModels.length > 0 && !selectedModel) {
        const savedDefault = localStorage.getItem(STORAGE_KEY);
        const modelToUse = savedDefault && allModels.some((m: Model) => m.modelId === savedDefault)
          ? savedDefault
          : (data.defaultModel || allModels[0].modelId);
        setSelectedModel(modelToUse);
        localStorage.setItem(STORAGE_KEY, modelToUse);
      }
    } catch (error) {
      console.error('Failed to fetch models:', error);
    }
  }, [selectedModel]);

  // 初始加载
  useEffect(() => {
    fetchModels();
  }, []);

  return {
    models,
    selectedModel,
    setSelectedModel,
    fetchModels,
  };
}
