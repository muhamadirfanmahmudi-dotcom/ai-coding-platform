import { Router, Request, Response } from 'express';
import { requireAuth, AuthenticatedRequest, getUserFromSid } from '../middleware/auth';
import { db } from '../services/database';
import { v4 as uuid } from 'uuid';
import type { RegisterRequest, LoginRequest, ApiResponse, UserResponse, ProfileUpdateRequest } from '../models';

export const userRoutes = Router();

// ─── Sid helpers ─────────────────────────────────────

function encodeSid(userId: string, role: string): string {
  return Buffer.from(JSON.stringify({ id: userId, role, t: Date.now() })).toString('base64');
}

// ─── POST /api/users/register ──────────────────────────

userRoutes.post('/register', (req: Request, res: Response) => {
  try {
    const { name, email, password, role } = req.body as RegisterRequest;

    if (!name || !email || !password) {
      res.status(400).json({ success: false, error: '请填写完整信息' } as ApiResponse);
      return;
    }

    const existing = db.getUserByEmail(email);
    if (existing) {
      res.status(409).json({ success: false, error: '该邮箱已注册' } as ApiResponse);
      return;
    }

    const id = uuid();
    const user = db.createUser({ id, name, email, password, role: role || 'buyer' });

    const response: ApiResponse<UserResponse> = {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: 'buyer', sid: '' },
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
    const { email, password, role } = req.body as LoginRequest;

    if (!email || !password) {
      res.status(400).json({ success: false, error: '请填写邮箱和密码' } as ApiResponse);
      return;
    }

    const validRoles = ['buyer', 'developer'];
    const loginRole = role && validRoles.includes(role) ? role : 'buyer';

    const user = db.getUserByEmail(email);
    if (!user || user.password !== password) {
      res.status(401).json({ success: false, error: '邮箱或密码错误' } as ApiResponse);
      return;
    }

    const sid = encodeSid(user.id, loginRole);

    const response: ApiResponse<UserResponse> = {
      success: true,
      data: { id: user.id, name: user.name, email: user.email, role: loginRole, sid, avatar: user.avatar || null },
    };

    res.json(response);
  } catch (err: any) {
    console.error('[Users] Login error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/users/me ─────────────────────────────────

userRoutes.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

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
      role: user.role,
      sid: req.headers.authorization!.replace('Bearer ', ''),
      avatar: fullUser.avatar || null,
    },
  };

  res.json(response);
});

// ─── GET /api/users/developers ── 开发者列表（人才推荐）──

userRoutes.get('/developers', requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const developers = db.listDevelopers();
    const data = developers.map((d) => ({
      id: d.id,
      name: d.name,
      role: 'developer',
      avatar: d.avatar || null,
      createdAt: d.createdAt,
    }));

    res.json({ success: true, data } as ApiResponse);
  } catch (err: any) {
    console.error('[Users] Developers list error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── PUT /api/users/profile ── 更新用户名/头像 ──────────

userRoutes.put('/profile', requireAuth, (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const { name, avatar } = req.body as ProfileUpdateRequest;

    // Validate name
    if (name !== undefined && (!name || !name.trim())) {
      res.status(400).json({ success: false, error: '用户名不能为空' } as ApiResponse);
      return;
    }

    // Validate avatar size (max 500KB for base64)
    if (avatar !== undefined && avatar !== null) {
      const sizeInBytes = Math.round((avatar.length * 3) / 4);
      if (sizeInBytes > 500 * 1024) {
        res.status(400).json({ success: false, error: '头像文件过大，请控制在 500KB 以内' } as ApiResponse);
        return;
      }
    }

    const updateData: { name?: string; avatar?: string | null } = {};
    if (name !== undefined) updateData.name = name.trim();
    if (avatar !== undefined) updateData.avatar = avatar;

    const updated = db.updateUserProfile(user.id, updateData);
    if (!updated) {
      res.status(400).json({ success: false, error: '没有需要更新的内容' } as ApiResponse);
      return;
    }

    const response: ApiResponse<UserResponse> = {
      success: true,
      data: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: user.role,
        sid: req.headers.authorization!.replace('Bearer ', ''),
        avatar: updated.avatar,
      },
    };

    res.json(response);
  } catch (err: any) {
    console.error('[Users] Profile update error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});
