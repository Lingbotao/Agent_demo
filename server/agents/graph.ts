/**
 * 智能客服 LangGraph 工作流引擎
 * 
 * 实现类 LangGraph 的状态图模式:
 *   Intent → RAG Search → Route → [FAQ Answer | Agent | Escalation]
 * 
 * 工作流说明:
 * 1. classifyIntent: 识别用户意图（退款/查单/技术支持/通用）
 * 2. searchFAQ: 在向量知识库中检索匹配的 FAQ
 * 3. routeAfterRag: 判断 FAQ 匹配度是否足够直接返回
 *    - 高匹配 → 直接返回 FAQ 答案
 *    - 低匹配/无匹配 → 进入 Agent 对话
 * 4. agentRespond: 调用 CodeBuddy SDK 进行智能对话
 * 5. routeAfterAgent: 判断 Agent 回答是否需要转人工
 *    - 正常回答 → 返回给用户
 *    - 无法解决 → 进入转人工
 * 6. escalateToHuman: 创建工单，转人工
 */

import { classifyIntent } from './intent.js';
import { ragNode, shouldUseFaqAnswer, getFaqResponse } from './rag.js';
import { agentNode } from './agent.js';
import { escalationNode } from './escalation.js';
import type { CSAgentState } from './types.js';
import { createInitialState } from './types.js';

/** 工作流节点类型 */
type NodeFunc = (state: CSAgentState, onText?: (text: string) => void) => Promise<Partial<CSAgentState>>;
type RouteFunc = (state: CSAgentState) => string;

/** 工作流步骤定义 */
interface WorkflowStep {
  name: string;
  node: NodeFunc;
  /** 路由函数：根据状态决定下一个节点，null 表示终止 */
  route?: RouteFunc;
  /** 如果路由匹配此值，则执行对应节点 */
  routes?: Record<string, string>;
}

/**
 * 智能客服工作流
 * 按序执行节点，每个节点可以决定下一个执行节点
 */
export class CSAgentWorkflow {
  private steps: WorkflowStep[];

  constructor() {
    // 定义工作流
    this.steps = [
      {
        name: 'intent',
        node: this.wrapIntent,
      },
      {
        name: 'rag',
        node: ragNode,
        route: (state: CSAgentState) => {
          // RAG 之后判断: FAQ 匹配度高 → faq_answer, 否则 → agent
          if (state.error) return 'escalation';
          return shouldUseFaqAnswer(state) ? 'faq_answer' : 'agent';
        },
        routes: {
          faq_answer: 'faq_answer',
          agent: 'agent',
          escalation: 'escalation',
        },
      },
      {
        name: 'faq_answer',
        node: this.wrapFaqAnswer,
        // FAQ 回答后直接结束
      },
      {
        name: 'agent',
        node: this.wrapAgent,
        route: (state: CSAgentState) => {
          // Agent 回答后判断: 需要转人工 → escalation, 否则结束
          return state.shouldEscalate ? 'escalation' : 'done';
        },
        routes: {
          escalation: 'escalation',
          done: 'done',
        },
      },
      {
        name: 'escalation',
        node: escalationNode,
        // 转人工后结束
      },
    ];
  }

  /** 封装意图识别 */
  private async wrapIntent(state: CSAgentState, _onText?: (text: string) => void): Promise<Partial<CSAgentState>> {
    const { intent, confidence } = classifyIntent(state.userInput);
    return { intent, intentConfidence: confidence };
  }

  /** 封装 FAQ 回答 */
  private async wrapFaqAnswer(state: CSAgentState, onText?: (text: string) => void): Promise<Partial<CSAgentState>> {
    const result = getFaqResponse(state);
    if (result.finalResponse) {
      onText?.(result.finalResponse);
    }
    return result;
  }

  /** 封装 Agent 调用 */
  private async wrapAgent(state: CSAgentState, onText?: (text: string) => void): Promise<Partial<CSAgentState>> {
    return agentNode(state, onText);
  }

  /**
   * 执行完整工作流
   * @param userInput 用户输入
   * @param sessionId 会话 ID
   * @param messageId 消息 ID
   * @param onText 流式文本回调
   * @returns 最终状态
   */
  async run(
    userInput: string,
    sessionId: string,
    messageId: string,
    onText?: (text: string) => void
  ): Promise<CSAgentState> {
    const initialState = createInitialState({
      userInput,
      sessionId,
      messageId,
    });

    console.log(`\n[Workflow] ===== 开始执行 =====`);
    console.log(`[Workflow] Session: ${sessionId}, Input: "${userInput.slice(0, 80)}"`);

    // 合并 state
    let state: CSAgentState = { ...initialState };

    // 按序执行节点
    // 执行顺序: intent → rag → route → (faq_answer | agent) → (escalation)
    const executionOrder = ['intent', 'rag'];

    for (const stepName of executionOrder) {
      const step = this.steps.find(s => s.name === stepName);
      if (!step) continue;

      console.log(`[Workflow] 执行节点: ${step.name}`);
      const partial = await step.node(state, onText);
      state = { ...state, ...partial };
    }

    // 根据 RAG 结果路由
    const ragStep = this.steps.find(s => s.name === 'rag')!;
    const nextNode = ragStep.route?.(state) || 'done';
    console.log(`[Workflow] 路由: rag → ${nextNode}`);

    if (nextNode === 'faq_answer' || nextNode === 'agent' || nextNode === 'escalation') {
      const nextStep = this.steps.find(s => s.name === nextNode);
      if (nextStep) {
        console.log(`[Workflow] 执行节点: ${nextNode}`);
        const partial = await nextStep.node(state, onText);
        state = { ...state, ...partial };

        // 如果是 agent，再路由一次
        if (nextNode === 'agent') {
          const agentStep = this.steps.find(s => s.name === 'agent')!;
          const afterAgent = agentStep.route?.(state) || 'done';
          console.log(`[Workflow] 路由: agent → ${afterAgent}`);

          if (afterAgent === 'escalation') {
            const escStep = this.steps.find(s => s.name === 'escalation');
            if (escStep) {
              const partial2 = await escStep.node(state, onText);
              state = { ...state, ...partial2 };
            }
          }
        }
      }
    }

    console.log(`[Workflow] 结束, intent=${state.intent}, usedFaq=${state.usedFaq}, escalated=${state.shouldEscalate}`);
    return state;
  }

  /**
   * 仅执行意图识别（用于前端异步展示）
   */
  detectIntent(text: string): { intent: string; confidence: number } {
    return classifyIntent(text);
  }
}

// 全局单例
let workflowInstance: CSAgentWorkflow | null = null;

export function getWorkflow(): CSAgentWorkflow {
  if (!workflowInstance) {
    workflowInstance = new CSAgentWorkflow();
  }
  return workflowInstance;
}
