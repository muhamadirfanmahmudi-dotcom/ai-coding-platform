import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { v4 as uuid } from 'uuid';
import type { RegisterRequest, LoginRequest, ApiResponse, UserResponse } from '../models';

export const userRoutes = Router();

// ─── Sid helpers ─────────────────────────────────────

function encodeSid(userId: string): string {
  return Buffer.from(JSON.stringify({ id: userId, t: Date.now() })).toString('base64');
}

function decodeSid(sid: string): { id: string } | null {
  try {
    const raw = Buffer.from(sid, 'base64').toString('utf-8');
    const data = JSON.parse(raw);
    if (data.id) return { id: data.id };
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

  return { id: user.id, name: user.name, role: user.role };
}

// ─── POST /api/users/register ──────────────────────────

userRoutes.post('/register', (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body as RegisterRequest;

    if (!name || !email || !password) {
      res.status(400).json({ success: false, error: '请填写完整信息' } as ApiResponse);
      return;
    }

    const validRoles = ['buyer', 'developer'];
    if (role && !validRoles.includes(role)) {
      res.status(400).json({ success: false, error: '无效的角色' } as ApiResponse);
      return;
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: '该邮箱已注册' } as ApiResponse);
      return;
    }

    const id = uuid();
    const user = db.createUser({ id, name, email, password, role });

    const response: ApiResponse<UserResponse> = {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role, sid: '' },
    };

    res.status(201).json(response);
  } catch (err: any) {
    console.error('[Users] Register error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/users/login ─────────────────────────────

userRoutes.post('/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginRequest;

    if (!email || !password) {
      res.status(400).json({ success: false, error: '请填写邮箱和密码' } as ApiResponse);
      return;
    }

    const user = db.getUserByEmail(email);
    if (!user || user.password !== password) {
      res.status(401).json({ success: false, error: '邮箱或密码错误' } as ApiResponse);
      return;
    }

    const sid = encodeSid(user.id);

    const response: ApiResponse<UserResponse> = {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: user.role, sid },
    };

    res.json(response);
  } catch (err: any) {
    console.error('[Users] Login error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/users/me ─────────────────────────────────

userRoutes.get('/me', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  const fullUser = db.getUserById(user.id);
  if (!fullUser) {
    res.status(401).json({ success: false, error: '用户不存在' } as ApiResponse);
    return;
  }

  const response: ApiResponse<UserResponse> = {
    success: true,
    data: {
      id: fullUser.id,
      name: fullUser.name,
      email: fullUser.email,
      role: fullUser.role,
      sid: req.headers.authorization!.replace('Bearer ', ''),
    },
  };

  res.json(response);
});
