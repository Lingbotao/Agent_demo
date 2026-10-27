import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

// 使用临时数据库进行测试
const testDbPath = path.join(__dirname, '..', '..', 'data', 'test_chat.db');

// 清空并重建 schema
function setupTestDb(): Database.Database {
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
  const db = new Database(testDbPath);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      model TEXT NOT NULL,
      sdk_session_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      model TEXT,
      created_at TEXT NOT NULL,
      tool_calls TEXT,
      status TEXT DEFAULT 'active',
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS faq_knowledge (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      category TEXT NOT NULL,
      keywords TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS satisfaction_ratings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
      comment TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
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
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'agent', 'visitor')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('DB 核心操作', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = setupTestDb();
  });

  afterEach(() => {
    db.close();
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  const now = () => new Date().toISOString();

  describe('sessions', () => {
    it('创建会话', () => {
      const ts = now();
      const stmt = db.prepare(
        'INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      );
      stmt.run('s1', 'test', 'cs-agent', ts, ts);
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.title).toBe('test');
      expect(row.model).toBe('cs-agent');
    });

    it('按 updated_at DESC 排序', () => {
      const ts1 = '2026-01-01T00:00:00.000Z';
      const ts2 = '2026-01-02T00:00:00.000Z';
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'old', 'cs-agent', ts1, ts1);
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s2', 'new', 'cs-agent', ts2, ts2);
      const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as any[];
      expect(rows[0].id).toBe('s2');
      expect(rows[1].id).toBe('s1');
    });

    it('更新会话标题和模型', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'old', 'cs-agent', ts, ts);
      db.prepare('UPDATE sessions SET title = ?, model = ? WHERE id = ?').run('new title', 'gpt-4', 's1');
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get('s1') as any;
      expect(row.title).toBe('new title');
      expect(row.model).toBe('gpt-4');
    });

    it('删除会话级联删除消息', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'user', 'hello', ts);
      db.prepare('DELETE FROM sessions WHERE id = ?').run('s1');
      const msg = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1');
      expect(msg).toBeUndefined();
    });
  });

  describe('messages', () => {
    it('创建消息并检查 role 约束', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'user', 'hello', ts);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m2', 's1', 'assistant', 'hi', ts);
      const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC').all('s1') as any[];
      expect(rows).toHaveLength(2);
      expect(rows[0].role).toBe('user');
      expect(rows[1].role).toBe('assistant');
    });

    it('role 约束阻止非法值', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      expect(() => {
        db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'system', 'hello', ts);
      }).toThrow();
    });

    it('更新消息内容', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'user', 'original', ts);
      db.prepare('UPDATE messages SET content = ? WHERE id = ?').run('updated', 'm1');
      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1') as any;
      expect(row.content).toBe('updated');
    });
  });

  describe('faq_knowledge', () => {
    it('增删改 FAQ', () => {
      const ts = now();
      const id = 'faq-1';
      db.prepare(
        'INSERT INTO faq_knowledge (id, question, answer, category, keywords, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(id, 'test q?', 'test a', 'refund', 'test', ts, ts);

      let row = db.prepare('SELECT * FROM faq_knowledge WHERE id = ?').get(id) as any;
      expect(row.question).toBe('test q?');
      expect(row.category).toBe('refund');

      db.prepare('UPDATE faq_knowledge SET question = ?, answer = ? WHERE id = ?').run('updated q', 'updated a', id);
      row = db.prepare('SELECT * FROM faq_knowledge WHERE id = ?').get(id) as any;
      expect(row.question).toBe('updated q');

      db.prepare('DELETE FROM faq_knowledge WHERE id = ?').run(id);
      row = db.prepare('SELECT * FROM faq_knowledge WHERE id = ?').get(id);
      expect(row).toBeUndefined();
    });

    it('按分类筛选', () => {
      const ts = now();
      db.prepare('INSERT INTO faq_knowledge (id, question, answer, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('f1', 'q1', 'a1', 'refund', ts, ts);
      db.prepare('INSERT INTO faq_knowledge (id, question, answer, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('f2', 'q2', 'a2', 'tech_support', ts, ts);
      const rows = db.prepare('SELECT * FROM faq_knowledge WHERE category = ?').all('refund') as any[];
      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe('q1');
    });
  });

  describe('satisfaction_ratings', () => {
    it('创建满意度评分并验证约束', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO satisfaction_ratings (id, session_id, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)').run('r1', 's1', 5, 'great', ts);
      const row = db.prepare('SELECT * FROM satisfaction_ratings WHERE id = ?').get('r1') as any;
      expect(row.rating).toBe(5);
      expect(row.comment).toBe('great');
    });

    it('rating 范围约束', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      expect(() => {
        db.prepare('INSERT INTO satisfaction_ratings (id, session_id, rating, created_at) VALUES (?, ?, ?, ?)').run('r1', 's1', 6, ts);
      }).toThrow();
      expect(() => {
        db.prepare('INSERT INTO satisfaction_ratings (id, session_id, rating, created_at) VALUES (?, ?, ?, ?)').run('r1', 's1', 0, ts);
      }).toThrow();
    });
  });

  describe('tickets', () => {
    it('创建工单并验证默认值', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO tickets (id, session_id, intent, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 's1', 'refund', 'user wants refund', ts, ts);
      const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get('t1') as any;
      expect(row.status).toBe('pending');
      expect(row.priority).toBe('normal');
    });

    it('更新工单状态', () => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO tickets (id, session_id, intent, summary, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('t1', 's1', 'refund', 'test', ts, ts);
      db.prepare('UPDATE tickets SET status = ?, resolution = ? WHERE id = ?').run('resolved', 'solved', 't1');
      const row = db.prepare('SELECT * FROM tickets WHERE id = ?').get('t1') as any;
      expect(row.status).toBe('resolved');
      expect(row.resolution).toBe('solved');
    });
  });

  describe('users', () => {
    it('创建用户', () => {
      const ts = now();
      db.prepare('INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('u', 'admin', 'hash', 'admin', ts, ts);
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get('admin') as any;
      expect(row.role).toBe('admin');
      expect(row.password_hash).toBe('hash');
    });

    it('用户名唯一约束', () => {
      const ts = now();
      db.prepare('INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('u1', 'admin', 'hash', 'admin', ts, ts);
      expect(() => {
        db.prepare('INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run('u2', 'admin', 'hash2', 'visitor', ts, ts);
      }).toThrow();
    });
  });

  describe('recallMessage (模拟)', () => {
    // 通过真实 SQL 模拟 recallMessage 的行为
    function recallMsg(msgId: string): boolean {
      const result = db.prepare(
        "UPDATE messages SET status = 'recalled', content = '[消息已撤回]' WHERE id = ? AND role = 'user'"
      ).run(msgId);
      return result.changes > 0;
    }

    beforeEach(() => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
    });

    it('成功撤回 user 消息', () => {
      const ts = now();
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'user', 'hello', ts);

      const ok = recallMsg('m1');
      expect(ok).toBe(true);

      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1') as any;
      expect(row.status).toBe('recalled');
      expect(row.content).toBe('[消息已撤回]');
    });

    it('撤回 assistant 消息返回 false', () => {
      const ts = now();
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'assistant', 'hi', ts);

      const ok = recallMsg('m1');
      expect(ok).toBe(false);

      const row = db.prepare('SELECT * FROM messages WHERE id = ?').get('m1') as any;
      expect(row.content).toBe('hi'); // 未变更
    });

    it('撤回不存在的消息返回 false', () => {
      const ok = recallMsg('non-existent-uuid');
      expect(ok).toBe(false);
    });

    it('重复撤回只变更一次', () => {
      const ts = now();
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('m1', 's1', 'user', 'hello', ts);

      expect(recallMsg('m1')).toBe(true);
      expect(recallMsg('m1')).toBe(true); // 内容相同，changes>0 但无实际变更
    });
  });

  describe('recallMessagePair (配对撤回)', () => {
    beforeEach(() => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s2', 'test2', 'cs-agent', ts, ts);
    });

    /**
     * 模拟 db.ts 中的 recallMessagePair
     * 找到 user 消息后，紧随其后的 assistant 消息一并撤回
     */
    function recallPair(userMsgId: string): { userRecalled: boolean; assistantId?: string; assistantRecalled?: boolean } {
      const userMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(userMsgId) as any;
      if (!userMsg || userMsg.role !== 'user') return { userRecalled: false };

      const sibling = db.prepare(
        `SELECT id FROM messages
         WHERE session_id = ? AND role = 'assistant' AND created_at > ?
         ORDER BY created_at ASC LIMIT 1`
      ).get(userMsg.session_id, userMsg.created_at) as { id: string } | undefined;

      db.prepare("UPDATE messages SET status = 'recalled', content = '[消息已撤回]' WHERE id = ?").run(userMsgId);

      let assistantId: string | undefined;
      let assistantRecalled: boolean | undefined;
      if (sibling) {
        assistantId = sibling.id;
        const r = db.prepare("UPDATE messages SET status = 'recalled', content = '[消息已撤回]' WHERE id = ?").run(assistantId);
        assistantRecalled = r.changes > 0;
      }

      return { userRecalled: true, assistantId, assistantRecalled };
    }

    it('撤回 user 消息时同时撤回紧跟的 assistant 消息', () => {
      const ts1 = '2026-01-01T00:00:00.000Z';
      const ts2 = '2026-01-01T00:00:01.000Z';
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 's1', 'user', 'hello', ts1);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('a1', 's1', 'assistant', 'hi', ts2);

      const r = recallPair('u1');
      expect(r.userRecalled).toBe(true);
      expect(r.assistantId).toBe('a1');
      expect(r.assistantRecalled).toBe(true);

      const u = db.prepare('SELECT status, content FROM messages WHERE id = ?').get('u1') as any;
      const a = db.prepare('SELECT status, content FROM messages WHERE id = ?').get('a1') as any;
      expect(u.status).toBe('recalled');
      expect(a.status).toBe('recalled');
      expect(u.content).toBe('[消息已撤回]');
      expect(a.content).toBe('[消息已撤回]');
    });

    it('没有 assistant 回复时只撤回 user 消息', () => {
      const ts = now();
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 's1', 'user', 'hello', ts);

      const r = recallPair('u1');
      expect(r.userRecalled).toBe(true);
      expect(r.assistantId).toBeUndefined();
      expect(r.assistantRecalled).toBeUndefined();
    });

    it('只撤回 user 之后的 assistant（不影响更早的回复）', () => {
      const ts1 = '2026-01-01T00:00:00.000Z';
      const ts2 = '2026-01-01T00:00:01.000Z';
      const ts3 = '2026-01-01T00:00:02.000Z';
      const ts4 = '2026-01-01T00:00:03.000Z';
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 's1', 'user', 'first q', ts1);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('a1', 's1', 'assistant', 'first a', ts2);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('u2', 's1', 'user', 'second q', ts3);
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('a2', 's1', 'assistant', 'second a', ts4);

      const r = recallPair('u2');
      expect(r.userRecalled).toBe(true);
      expect(r.assistantId).toBe('a2');

      // u1 和 a1 应保持 active 不变
      const u1 = db.prepare('SELECT status FROM messages WHERE id = ?').get('u1') as any;
      const a1 = db.prepare('SELECT status FROM messages WHERE id = ?').get('a1') as any;
      expect(u1.status).toBe('active');
      expect(a1.status).toBe('active');
    });

    it('跨会话不会误撤回其他会话的 assistant', () => {
      const ts1 = '2026-01-01T00:00:00.000Z';
      const ts2 = '2026-01-01T00:00:01.000Z';
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('u1', 's1', 'user', 'hello', ts1);
      // 另一个会话里的 assistant
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('a-other', 's2', 'assistant', 'other a', ts2);

      const r = recallPair('u1');
      expect(r.assistantId).toBeUndefined();

      const other = db.prepare('SELECT status FROM messages WHERE id = ?').get('a-other') as any;
      expect(other.status).toBe('active');
    });

    it('assistant 角色消息调用配对撤回不会误判', () => {
      const ts = now();
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('a1', 's1', 'assistant', 'hi', ts);

      const r = recallPair('a1');
      expect(r.userRecalled).toBe(false);
    });
  });

  describe('ID 同步契约', () => {
    beforeEach(() => {
      const ts = now();
      db.prepare('INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run('s1', 'test', 'cs-agent', ts, ts);
    });

    /**
     * 模拟 recallMessage API 行为：
     * 服务端用 clientMessageId 写入数据库，前端用同一 ID 撤回。
     * 验证：前后端共享同一 ID 是撤回成功的关键。
     */
    function simulateChatInsert(clientMessageId: string, content: string) {
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(clientMessageId, 's1', 'user', content, now());
    }

    it('服务端用 clientMessageId 写入，前端用同 ID 可正常撤回', () => {
      const clientId = 'temp-uuid-1234-5678';
      simulateChatInsert(clientId, 'hello');

      const exists = db.prepare('SELECT id FROM messages WHERE id = ?').get(clientId);
      expect(exists).toBeDefined();

      // 模拟 recallMessagePair（让 assistant 时间略晚，确保 created_at > 严格成立）
      const assistantTs = new Date(Date.now() + 1000).toISOString();
      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run('a1', 's1', 'assistant', 'hi', assistantTs);

      const r = (() => {
        const userMsg = db.prepare('SELECT * FROM messages WHERE id = ?').get(clientId) as any;
        if (!userMsg || userMsg.role !== 'user') return { userRecalled: false };
        const sibling = db.prepare(
          `SELECT id FROM messages WHERE session_id = ? AND role = 'assistant' AND created_at > ? ORDER BY created_at ASC LIMIT 1`
        ).get(userMsg.session_id, userMsg.created_at) as { id: string } | undefined;
        db.prepare("UPDATE messages SET status = 'recalled', content = '[消息已撤回]' WHERE id = ?").run(clientId);
        let assistantId: string | undefined;
        let assistantRecalled: boolean | undefined;
        if (sibling) {
          assistantId = sibling.id;
          const r = db.prepare("UPDATE messages SET status = 'recalled', content = '[消息已撤回]' WHERE id = ?").run(assistantId);
          assistantRecalled = r.changes > 0;
        }
        return { userRecalled: true, assistantId, assistantRecalled };
      })();

      expect(r.userRecalled).toBe(true);
      expect(r.assistantId).toBe('a1');
      expect(r.assistantRecalled).toBe(true);
    });

    it('若服务端忽略 clientMessageId 用自己的 UUID，前端 ID 查不到', () => {
      // 模拟「坏」的服务端：忽略 clientMessageId
      const clientId = 'temp-uuid-1234-5678';
      const serverId = 'server-generated-uuid-different';

      db.prepare('INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)').run(serverId, 's1', 'user', 'hello', now());

      const exists = db.prepare('SELECT id FROM messages WHERE id = ?').get(clientId);
      expect(exists).toBeUndefined(); // 验证 bug：找不到 clientId

      const existsServer = db.prepare('SELECT id FROM messages WHERE id = ?').get(serverId);
      expect(existsServer).toBeDefined(); // 服务端的 ID 是另一个
    });
  });
});