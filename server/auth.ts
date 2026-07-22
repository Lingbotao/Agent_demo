/**
 * 自建登录鉴权模块
 * - bcrypt 散列/校验密码
 * - jsonwebtoken 签发/校验 JWT
 * - 提供 Express 中间件 requireAuth / requireRole
 */

import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import * as db from './db.js';
import type { User, UserRole } from './db.js';

const JWT_SECRET = process.env.JWT_SECRET || 'smart-cs-agent-dev-secret-change-me';
const JWT_EXPIRES_IN = '7d';

export interface AuthPayload {
  sub: string; // user id
  username: string;
  role: UserRole;
}

export interface AuthedRequest extends Request {
  user?: AuthPayload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function signToken(user: Pick<User, 'id' | 'username' | 'role'>): string {
  const payload: AuthPayload = { sub: user.id, username: user.username, role: user.role };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string): AuthPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as AuthPayload;
  } catch {
    return null;
  }
}

/** 解析 Authorization: Bearer xxx，把 payload 挂到 req.user */
export function attachUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7);
    const payload = verifyToken(token);
    if (payload) {
      req.user = payload;
    }
  }
  next();
}

/** 强制要求已登录 */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  next();
}

/** 工厂：要求指定角色 */
export function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: '未登录或登录已过期' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: '权限不足' });
    }
    next();
  };
}

/** 启动时确保至少有 1 个管理员账号（首个注册的即为 admin） */
export async function bootstrapDefaultAdmin(): Promise<void> {
  if (db.getUserCount() > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const hash = await hashPassword(password);
  db.createUser({ username, password_hash: hash, role: 'admin' });
  console.log(`[Auth] 已创建默认管理员账号: ${username} / ${password}（请尽快修改密码）`);
}