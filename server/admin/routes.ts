/**
 * 管理后台 API 路由
 * 提供对话记录、满意度统计、工单管理等管理功能
 */

import { Router, Request, Response } from 'express';
import * as db from '../db.js';

const router = Router();

// ============= 对话记录 =============

/** 获取所有对话记录（含意图信息） */
router.get('/conversations', (req: Request, res: Response) => {
  try {
    const sessions = db.getAllSessions();
    
    const conversations = sessions.map(session => {
      const messages = db.getMessagesBySession(session.id);
      const satisfaction = db.getSatisfactionBySession(session.id);
      
      // 获取该会话的意图记录
      let intents: Array<{ message_id: string; intent: string; confidence: number }> = [];
      try {
        intents = db.getIntentsBySession(session.id) || [];
      } catch {
        // conversation_intents 可能尚未初始化
      }

      return {
        sessionId: session.id,
        title: session.title,
        model: session.model,
        messageCount: messages.length,
        firstMessage: messages[0]?.content?.slice(0, 100) || '',
        lastMessage: messages[messages.length - 1]?.content?.slice(0, 100) || '',
        satisfaction: satisfaction ? {
          rating: satisfaction.rating,
          comment: satisfaction.comment,
        } : null,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      };
    });

    res.json({ conversations, total: conversations.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** 获取单条对话详情 */
router.get('/conversations/:sessionId', (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const session = db.getSession(sessionId);

    if (!session) {
      return res.status(404).json({ error: '会话不存在' });
    }

    const messages = db.getMessagesBySession(sessionId);
    const satisfaction = db.getSatisfactionBySession(sessionId);

    // 关联意图 + workflowMeta（与 /api/sessions/:id 保持一致）
    const intentRows = db.getIntentsBySession(sessionId);
    const intentByAssistant = new Map<string, { intent: string; confidence: number }>();
    let pendingIntent: { intent: string; confidence: number } | null = null;
    for (const msg of messages) {
      if (msg.role === 'user') {
        const r = intentRows.find((r) => r.message_id === msg.id);
        pendingIntent = r ? { intent: r.intent, confidence: r.confidence } : null;
      } else if (msg.role === 'assistant' && pendingIntent) {
        intentByAssistant.set(msg.id, pendingIntent);
        pendingIntent = null;
      }
    }

    res.json({
      session,
      messages: messages.map(msg => ({
        ...msg,
        tool_calls: msg.tool_calls ? JSON.parse(msg.tool_calls) : null,
        intent: msg.role === 'assistant' ? intentByAssistant.get(msg.id)?.intent ?? null : null,
        intent_confidence: msg.role === 'assistant' ? intentByAssistant.get(msg.id)?.confidence ?? null : null,
        used_faq: msg.role === 'assistant' ? !!msg.used_faq : false,
        should_escalate: msg.role === 'assistant' ? !!msg.should_escalate : false,
        ticket_id: msg.role === 'assistant' ? msg.ticket_id ?? null : null,
        faq_score: msg.role === 'assistant' ? msg.faq_score ?? null : null,
      })),
      satisfaction: satisfaction || null,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= 满意度统计 =============

/** 获取满意度统计数据 */
router.get('/stats/satisfaction', (req: Request, res: Response) => {
  try {
    const stats = db.getSatisfactionStats();
    
    // 补全 1-5 星的分布
    const fullDistribution = [1, 2, 3, 4, 5].map(rating => {
      const existing = stats.distribution.find(d => d.rating === rating);
      return { rating, count: existing?.count || 0 };
    });

    res.json({
      ...stats,
      distribution: fullDistribution,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** 获取意图分布统计 */
router.get('/stats/intents', (req: Request, res: Response) => {
  try {
    const stats = db.getIntentStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** 获取工单统计 */
router.get('/stats/tickets', (req: Request, res: Response) => {
  try {
    const stats = db.getTicketStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** 获取综合仪表盘数据 */
router.get('/dashboard', (req: Request, res: Response) => {
  try {
    const satisfactionStats = db.getSatisfactionStats();
    const intentStats = db.getIntentStats();
    const ticketStats = db.getTicketStats();
    
    // 总会话数
    const sessions = db.getAllSessions();
    const totalConversations = sessions.length;
    
    // 今日会话数
    const today = new Date().toISOString().slice(0, 10);
    const todayConversations = sessions.filter(s => s.created_at.startsWith(today)).length;
    
    // 满意度分布（补全 1-5）
    const satisfactionDistribution = [1, 2, 3, 4, 5].map(rating => {
      const existing = satisfactionStats.distribution.find(d => d.rating === rating);
      return { rating, count: existing?.count || 0 };
    });

    // 近期对话（最近 20 条）
    const recentConversations = sessions.slice(0, 20).map(session => {
      const messages = db.getMessagesBySession(session.id);
      const satisfaction = db.getSatisfactionBySession(session.id);
      return {
        sessionId: session.id,
        title: session.title,
        messageCount: messages.length,
        satisfaction: satisfaction?.rating || null,
        createdAt: session.created_at,
      };
    });

    res.json({
      overview: {
        totalConversations,
        todayConversations,
        averageSatisfaction: satisfactionStats.average,
        totalTickets: ticketStats.total,
        faqHitRate: intentStats.faqHitRate,
      },
      satisfactionDistribution,
      intentDistribution: intentStats.byIntent,
      ticketByStatus: ticketStats.byStatus,
      recentConversations,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= 工单管理 =============

/** 获取所有工单 */
router.get('/tickets', (req: Request, res: Response) => {
  try {
    const tickets = db.getAllTickets();
    res.json({ tickets, total: tickets.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/** 更新工单状态 */
router.patch('/tickets/:ticketId', (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;
    const { status, resolution } = req.body;
    
    const success = db.updateTicketStatus(ticketId, status, resolution);
    
    if (!success) {
      return res.status(404).json({ error: '工单不存在' });
    }
    
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============= FAQ 管理 =============

/** 获取所有 FAQ */
router.get('/faq', (req: Request, res: Response) => {
  try {
    const faqList = db.getAllFaq();
    res.json({ faqs: faqList, total: faqList.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
