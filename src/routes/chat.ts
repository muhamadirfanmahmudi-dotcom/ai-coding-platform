import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { v4 as uuid } from 'uuid';
import type { ApiResponse, ChatMessageResponse, SendChatRequest } from '../models';

export const chatRoutes = Router();

// ─── 所有聊天路由都需要登录 ────────────────────────────
chatRoutes.use(requireAuth);

// ─── GET /api/chat/:orderId ── 获取聊天消息列表 ─────────

chatRoutes.get('/:orderId', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;

  try {
    const order = db.getOrderById(orderId);
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    // Only buyer and developer of this order can view chat
    if (user.id !== order.buyerId && user.id !== order.developerId) {
      res.status(403).json({ success: false, error: '无权查看该订单的聊天' } as ApiResponse);
      return;
    }

    const messages = db.getChatMessages(orderId);

    // Enrich with sender names
    const data: ChatMessageResponse[] = messages.map((m) => {
      const sender = db.getUserById(m.senderId);
      return {
        id: m.id,
        orderId: m.orderId,
        senderId: m.senderId,
        senderName: sender ? sender.name : '未知用户',
        senderAvatar: sender ? (sender as any).avatar || null : null,
        content: m.content,
        createdAt: m.createdAt,
      };
    });

    res.json({ success: true, data } as ApiResponse<ChatMessageResponse[]>);
  } catch (err: any) {
    console.error('[Chat] List error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/chat/:orderId ── 发送消息 ────────────────

chatRoutes.post('/:orderId', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  const orderId = Array.isArray(req.params.orderId) ? req.params.orderId[0] : req.params.orderId;

  try {
    const order = db.getOrderById(orderId);
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    // Only buyer and developer of this order can send messages
    if (user.id !== order.buyerId && user.id !== order.developerId) {
      res.status(403).json({ success: false, error: '无权在该订单发送消息' } as ApiResponse);
      return;
    }

    const { content } = req.body as SendChatRequest;
    if (!content || !content.trim()) {
      res.status(400).json({ success: false, error: '消息不能为空' } as ApiResponse);
      return;
    }

    const message = db.sendMessage({
      id: uuid(),
      orderId,
      senderId: user.id,
      content: content.trim(),
    });

    const sender = db.getUserById(message.senderId);

    const data: ChatMessageResponse = {
      id: message.id,
      orderId: message.orderId,
      senderId: message.senderId,
      senderName: sender ? sender.name : '未知用户',
      senderAvatar: sender ? (sender as any).avatar || null : null,
      content: message.content,
      createdAt: message.createdAt,
    };

    res.status(201).json({ success: true, data } as ApiResponse<ChatMessageResponse>);
  } catch (err: any) {
    console.error('[Chat] Send error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});
