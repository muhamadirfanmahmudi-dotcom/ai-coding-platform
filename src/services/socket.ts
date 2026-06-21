import { Server as HttpServer } from 'http';
import { Server, Socket } from 'socket.io';
import { db } from './database';
import { v4 as uuid } from 'uuid';

// ─── Auth helpers (mirrors middleware/auth.ts) ────────────

function decodeSid(sid: string): { id: string; role: string } | null {
  try {
    const raw = Buffer.from(sid, 'base64').toString('utf-8');
    const data = JSON.parse(raw);
    if (data.id && data.role) return { id: data.id, role: data.role };
    return null;
  } catch { return null; }
}

/** Message shape sent to clients */
export interface SocketChatMessage {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  senderAvatar: string | null;
  content: string;
  createdAt: string;
}

let io: Server | null = null;

export function initSocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    // 退化到 HTTP 长轮询以兼容所有环境
    transports: ['websocket', 'polling'],
  });

  // ─── 鉴权中间件 ─────────────────────────────────────
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      return next(new Error('未登录'));
    }
    const decoded = decodeSid(token as string);
    if (!decoded) {
      return next(new Error('无效的认证信息'));
    }
    const user = db.getUserById(decoded.id);
    if (!user) {
      return next(new Error('用户不存在'));
    }
    (socket as any).userId = user.id;
    (socket as any).userName = user.name;
    (socket as any).userAvatar = (user as any).avatar || null;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const userId = (socket as any).userId;
    const userName = (socket as any).userName;
    const userAvatar = (socket as any).userAvatar;

    // 加入个人房间，用于接收未读通知
    socket.join(`user:${userId}`);

    // ─── 加入聊天房间 ───────────────────────────────
    socket.on('chat:join', (orderId: string) => {
      const order = db.getOrderById(orderId);
      if (!order) return;
      if (userId !== order.buyerId && userId !== order.developerId) return;

      socket.join(`order:${orderId}`);
    });

    // ─── 离开聊天房间 ───────────────────────────────
    socket.on('chat:leave', (orderId: string) => {
      socket.leave(`order:${orderId}`);
    });

    // ─── 发送消息 ───────────────────────────────────
    socket.on('chat:send', (data: { orderId: string; content: string }) => {
      const { orderId, content } = data;
      if (!content || !content.trim()) return;

      // 权限验证
      const order = db.getOrderById(orderId);
      if (!order) return;
      if (userId !== order.buyerId && userId !== order.developerId) return;

      // 存数据库
      const message = db.sendMessage({
        id: uuid(),
        orderId,
        senderId: userId,
        content: content.trim(),
      });

      const chatMsg: SocketChatMessage = {
        id: message.id,
        orderId: message.orderId,
        senderId: message.senderId,
        senderName: userName,
        senderAvatar: userAvatar,
        content: message.content,
        createdAt: message.createdAt,
      };

      // 广播给房间内所有人（包括发送者，前端根据 senderId 判断左右）
      io!.to(`order:${orderId}`).emit('chat:message', chatMsg);

      // 给接收方发个人未读通知（如果不在聊天房间中）
      const recipientId = order.buyerId === userId ? order.developerId : order.buyerId;
      if (recipientId) {
        io!.to(`user:${recipientId}`).emit('chat:unread', { orderId, orderTitle: order.title });
      }
    });

    // ─── 断开连接 ───────────────────────────────────
    socket.on('disconnect', () => {
      // 不需要额外清理，Socket.IO 自动处理
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}
