import { Request, Response, NextFunction } from 'express';
import { db } from '../services/database';
import type { ApiResponse } from '../models';

export interface AuthenticatedRequest extends Request {
  currentUser: { id: string; name: string; role: string };
}

// ─── Sid helpers ─────────────────────────────────────

function decodeSid(sid: string): { id: string; role: string } | null {
  try {
    const raw = Buffer.from(sid, 'base64').toString('utf-8');
    const data = JSON.parse(raw);
    if (data.id && data.role) return { id: data.id, role: data.role };
    return null;
  } catch {
    return null;
  }
}

export function getUserFromSid(req: Request): { id: string; name: string; role: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;

  const sid = authHeader.replace('Bearer ', '');
  const decoded = decodeSid(sid);
  if (!decoded) return null;

  const user = db.getUserById(decoded.id);
  if (!user) return null;

  return { id: user.id, name: user.name, role: decoded.role };
}

/**
 * 要求用户已登录，否则返回 401。
 * 鉴权通过后，用户信息挂载到 req.currentUser。
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }
  (req as AuthenticatedRequest).currentUser = user;
  next();
}
