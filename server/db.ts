import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 数据库文件路径
const dbPath = path.join(__dirname, '..', 'data', 'chat.db');

// 确保 data 目录存在
import fs from 'fs';
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建数据库连接
const db = new Database(dbPath);

// 启用 WAL 模式以提高性能
db.pragma('journal_mode = WAL');

// 初始化数据库表
db.exec(`
  -- 会话表
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    model TEXT NOT NULL,
    sdk_session_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 消息表
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    model TEXT,
    created_at TEXT NOT NULL,
    tool_calls TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为会话 ID 创建索引
  CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);

  -- FAQ 知识库表
  CREATE TABLE IF NOT EXISTS faq_knowledge (
    id TEXT PRIMARY KEY,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    category TEXT NOT NULL,
    keywords TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- 满意度评分表
  CREATE TABLE IF NOT EXISTS satisfaction_ratings (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 工单表（转人工）
  CREATE TABLE IF NOT EXISTS tickets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'resolved', 'closed')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    assigned_to TEXT,
    resolution TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 对话意图记录表
  CREATE TABLE IF NOT EXISTS conversation_intents (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    intent TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    faq_matched TEXT,
    faq_score REAL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  -- 为工单状态创建索引
  CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
  CREATE INDEX IF NOT EXISTS idx_tickets_session ON tickets(session_id);
  CREATE INDEX IF NOT EXISTS idx_satisfaction_session ON satisfaction_ratings(session_id);
  CREATE INDEX IF NOT EXISTS idx_intents_session ON conversation_intents(session_id);

  -- 用户表（自建登录）
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'visitor')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
`);

// 数据库迁移：添加 sdk_session_id 列（如果不存在）
try {
  const tableInfo = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  const hasColumn = tableInfo.some(col => col.name === 'sdk_session_id');
  if (!hasColumn) {
    db.exec("ALTER TABLE sessions ADD COLUMN sdk_session_id TEXT");
    console.log("[DB] Added sdk_session_id column to sessions table");
  }
} catch (e) {
  // 忽略错误（列可能已存在）
}

// 类型定义
export interface DbSession {
  id: string;
  title: string;
  model: string;
  sdk_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  model: string | null;
  created_at: string;
  tool_calls: string | null;
}

// ============= 会话操作 =============

// 获取所有会话
export function getAllSessions(): DbSession[] {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC');
  return stmt.all() as DbSession[];
}

// 获取单个会话
export function getSession(id: string): DbSession | undefined {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?');
  return stmt.get(id) as DbSession | undefined;
}

// 创建会话
export function createSession(session: DbSession): DbSession {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, title, model, sdk_session_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(session.id, session.title, session.model, session.sdk_session_id, session.created_at, session.updated_at);
  return session;
}

// 更新会话
export function updateSession(id: string, updates: Partial<Pick<DbSession, 'title' | 'model' | 'sdk_session_id'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.title !== undefined) {
    fields.push('title = ?');
    values.push(updates.title);
  }
  if (updates.model !== undefined) {
    fields.push('model = ?');
    values.push(updates.model);
  }
  if (updates.sdk_session_id !== undefined) {
    fields.push('sdk_session_id = ?');
    values.push(updates.sdk_session_id);
  }
  
  if (fields.length === 0) return false;
  
  fields.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(id);
  
  const stmt = db.prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除会话
export function deleteSession(id: string): boolean {
  const stmt = db.prepare('DELETE FROM sessions WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// ============= 消息操作 =============

// 获取会话的所有消息
export function getMessagesBySession(sessionId: string): DbMessage[] {
  const stmt = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC');
  return stmt.all(sessionId) as DbMessage[];
}

// 创建消息
export function createMessage(message: DbMessage): DbMessage {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    message.id,
    message.session_id,
    message.role,
    message.content,
    message.model,
    message.created_at,
    message.tool_calls
  );
  
  // 更新会话的 updated_at
  const updateStmt = db.prepare('UPDATE sessions SET updated_at = ? WHERE id = ?');
  updateStmt.run(new Date().toISOString(), message.session_id);
  
  return message;
}

// 更新消息内容
export function updateMessage(id: string, updates: Partial<Pick<DbMessage, 'content' | 'tool_calls'>>): boolean {
  const fields: string[] = [];
  const values: any[] = [];
  
  if (updates.content !== undefined) {
    fields.push('content = ?');
    values.push(updates.content);
  }
  if (updates.tool_calls !== undefined) {
    fields.push('tool_calls = ?');
    values.push(updates.tool_calls);
  }
  
  if (fields.length === 0) return false;
  
  values.push(id);
  
  const stmt = db.prepare(`UPDATE messages SET ${fields.join(', ')} WHERE id = ?`);
  const result = stmt.run(...values);
  return result.changes > 0;
}

// 删除消息
export function deleteMessage(id: string): boolean {
  const stmt = db.prepare('DELETE FROM messages WHERE id = ?');
  const result = stmt.run(id);
  return result.changes > 0;
}

// 批量创建消息（用于保存对话）
export function createMessages(messages: DbMessage[]): void {
  const stmt = db.prepare(`
    INSERT INTO messages (id, session_id, role, content, model, created_at, tool_calls)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertMany = db.transaction((msgs: DbMessage[]) => {
    for (const msg of msgs) {
      stmt.run(msg.id, msg.session_id, msg.role, msg.content, msg.model, msg.created_at, msg.tool_calls);
    }
  });
  
  insertMany(messages);
}

// 清空所有数据
export function clearAllData(): void {
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM sessions');
}

// ============= 智能客服扩展类型 =============

export interface FaqKnowledge {
  id: string;
  question: string;
  answer: string;
  category: string;
  keywords: string | null;
  created_at: string;
  updated_at: string;
}

export interface SatisfactionRating {
  id: string;
  session_id: string;
  rating: number;
  comment: string | null;
  created_at: string;
}

export interface Ticket {
  id: string;
  session_id: string;
  intent: string;
  summary: string;
  status: 'pending' | 'processing' | 'resolved' | 'closed';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  assigned_to: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationIntent {
  id: string;
  session_id: string;
  message_id: string;
  intent: string;
  confidence: number;
  faq_matched: string | null;
  faq_score: number | null;
  created_at: string;
}

// ============= FAQ 知识库操作 =============

export function getAllFaq(): FaqKnowledge[] {
  return db.prepare('SELECT * FROM faq_knowledge ORDER BY category, created_at DESC').all() as FaqKnowledge[];
}

export function getFaqByCategory(category: string): FaqKnowledge[] {
  return db.prepare('SELECT * FROM faq_knowledge WHERE category = ? ORDER BY created_at DESC').all(category) as FaqKnowledge[];
}

export function createFaq(faq: Omit<FaqKnowledge, 'id' | 'created_at' | 'updated_at'> & { id?: string }): FaqKnowledge {
  const now = new Date().toISOString();
  const record: FaqKnowledge = {
    id: faq.id || crypto.randomUUID(),
    question: faq.question,
    answer: faq.answer,
    category: faq.category,
    keywords: faq.keywords || null,
    created_at: now,
    updated_at: now,
  };
  db.prepare('INSERT INTO faq_knowledge (id, question, answer, category, keywords, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(record.id, record.question, record.answer, record.category, record.keywords, record.created_at, record.updated_at);
  return record;
}

export function deleteFaq(id: string): boolean {
  return db.prepare('DELETE FROM faq_knowledge WHERE id = ?').run(id).changes > 0;
}

export function getFaqCount(): number {
  return (db.prepare('SELECT COUNT(*) as count FROM faq_knowledge').get() as { count: number }).count;
}

// ============= 满意度评分操作 =============

export function createSatisfaction(rating: Omit<SatisfactionRating, 'id' | 'created_at'>): SatisfactionRating {
  const now = new Date().toISOString();
  const record: SatisfactionRating = {
    id: crypto.randomUUID(),
    ...rating,
    created_at: now,
  };
  db.prepare('INSERT INTO satisfaction_ratings (id, session_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(record.id, record.session_id, record.rating, record.comment || null, record.created_at);
  return record;
}

export function getSatisfactionBySession(sessionId: string): SatisfactionRating | undefined {
  return db.prepare('SELECT * FROM satisfaction_ratings WHERE session_id = ?').get(sessionId) as SatisfactionRating | undefined;
}

export interface SatisfactionStats {
  total: number;
  average: number;
  distribution: { rating: number; count: number }[];
}

export function getSatisfactionStats(): SatisfactionStats {
  const total = (db.prepare('SELECT COUNT(*) as count FROM satisfaction_ratings').get() as { count: number }).count;
  const avgRow = db.prepare('SELECT AVG(rating) as avg FROM satisfaction_ratings').get() as { avg: number | null };
  const average = avgRow.avg ? Math.round(avgRow.avg * 10) / 10 : 0;
  const distribution = db.prepare(
    'SELECT rating, COUNT(*) as count FROM satisfaction_ratings GROUP BY rating ORDER BY rating'
  ).all() as { rating: number; count: number }[];
  
  return { total, average, distribution };
}

// ============= 工单操作 =============

export function createTicket(ticket: Omit<Ticket, 'id' | 'created_at' | 'updated_at'>): Ticket {
  const now = new Date().toISOString();
  const record: Ticket = {
    id: crypto.randomUUID(),
    ...ticket,
    assigned_to: ticket.assigned_to || null,
    resolution: ticket.resolution || null,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    'INSERT INTO tickets (id, session_id, intent, summary, status, priority, assigned_to, resolution, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(record.id, record.session_id, record.intent, record.summary, record.status, record.priority, record.assigned_to, record.resolution, record.created_at, record.updated_at);
  return record;
}

export function getAllTickets(): Ticket[] {
  return db.prepare('SELECT * FROM tickets ORDER BY created_at DESC').all() as Ticket[];
}

export function updateTicketStatus(id: string, status: Ticket['status'], resolution?: string): boolean {
  const now = new Date().toISOString();
  const stmt = db.prepare('UPDATE tickets SET status = ?, resolution = ?, updated_at = ? WHERE id = ?');
  return stmt.run(status, resolution || null, now, id).changes > 0;
}

export interface TicketStats {
  total: number;
  byStatus: { status: string; count: number }[];
  byIntent: { intent: string; count: number }[];
  byPriority: { priority: string; count: number }[];
}

export function getTicketStats(): TicketStats {
  const total = (db.prepare('SELECT COUNT(*) as count FROM tickets').get() as { count: number }).count;
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM tickets GROUP BY status').all() as { status: string; count: number }[];
  const byIntent = db.prepare('SELECT intent, COUNT(*) as count FROM tickets GROUP BY intent').all() as { intent: string; count: number }[];
  const byPriority = db.prepare('SELECT priority, COUNT(*) as count FROM tickets GROUP BY priority').all() as { priority: string; count: number }[];
  return { total, byStatus, byIntent, byPriority };
}

// ============= 对话意图记录操作 =============

export function recordIntent(record: Omit<ConversationIntent, 'id' | 'created_at'>): ConversationIntent {
  const now = new Date().toISOString();
  const entry: ConversationIntent = {
    id: crypto.randomUUID(),
    ...record,
    created_at: now,
  };
  db.prepare(
    'INSERT INTO conversation_intents (id, session_id, message_id, intent, confidence, faq_matched, faq_score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(entry.id, entry.session_id, entry.message_id, entry.intent, entry.confidence, entry.faq_matched, entry.faq_score, entry.created_at);
  return entry;
}

export interface IntentStats {
  total: number;
  byIntent: { intent: string; count: number }[];
  faqHitRate: number;
}

export function getIntentStats(): IntentStats {
  const total = (db.prepare('SELECT COUNT(*) as count FROM conversation_intents').get() as { count: number }).count;
  const byIntent = db.prepare('SELECT intent, COUNT(*) as count FROM conversation_intents GROUP BY intent ORDER BY count DESC').all() as { intent: string; count: number }[];
  const faqHits = (db.prepare("SELECT COUNT(*) as count FROM conversation_intents WHERE faq_matched IS NOT NULL AND faq_matched != ''").get() as { count: number }).count;
  return { total, byIntent, faqHitRate: total > 0 ? Math.round((faqHits / total) * 100) : 0 };
}

export default db;

// ============= 用户表（自建登录） =============

export type UserRole = 'admin' | 'agent' | 'visitor';

export interface User {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) as User | undefined;
}

export function getUserById(id: string): User | undefined {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
}

export function createUser(user: Omit<User, 'id' | 'created_at' | 'updated_at'> & { id?: string }): User {
  const now = new Date().toISOString();
  const record: User = {
    id: user.id || crypto.randomUUID(),
    username: user.username,
    password_hash: user.password_hash,
    role: user.role,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    'INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(record.id, record.username, record.password_hash, record.role, record.created_at, record.updated_at);
  return record;
}

export function getUserCount(): number {
  return (db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }).count;
}
