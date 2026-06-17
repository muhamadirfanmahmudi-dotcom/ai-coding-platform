import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { getUserFromSid } from './users';
import { v4 as uuid } from 'uuid';
import type { ApiResponse, CreateOrderRequest, OrderResponse, OrderProgressResponse } from '../models';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

export const orderRoutes = Router();

// ─── POST /api/orders ── 创建订单 ─────────────────────

orderRoutes.post('/', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const { title, description, userInfo, problem, features, antiFeatures, successCriteria } = req.body as CreateOrderRequest;

    if (!title || !description) {
      res.status(400).json({ success: false, error: '请填写标题和需求概述' } as ApiResponse);
      return;
    }

    const order = db.createOrder({
      id: uuid(),
      title,
      description,
      userInfo,
      problem,
      features,
      antiFeatures,
      successCriteria,
      buyerId: user.id,
    });

    const response: ApiResponse<OrderResponse> = {
      success: true,
      data: {
        id: order.id,
        title: order.title,
        description: order.description,
        userInfo: order.userInfo,
        problem: order.problem,
        features: order.features,
        antiFeatures: order.antiFeatures,
        successCriteria: order.successCriteria,
        status: order.status as any,
        buyerId: order.buyerId,
        developerId: order.developerId,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      },
    };

    res.status(201).json(response);
  } catch (err: any) {
    console.error('[Orders] Create error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/hall ── 抢单大厅 ──────────────────

orderRoutes.get('/hall', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const orders = db.listHallOrders();
    const data: OrderResponse[] = orders.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      userInfo: o.userInfo,
      problem: o.problem,
      features: o.features,
      antiFeatures: o.antiFeatures,
      successCriteria: o.successCriteria,
      status: o.status,
      buyerId: o.buyerId,
      developerId: o.developerId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    res.json({ success: true, data } as ApiResponse<OrderResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Hall error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/mine ── 我的订单 ──────────────────

orderRoutes.get('/mine', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const orders = db.listMyOrders(user.id);
    const data: OrderResponse[] = orders.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      userInfo: o.userInfo,
      problem: o.problem,
      features: o.features,
      antiFeatures: o.antiFeatures,
      successCriteria: o.successCriteria,
      status: o.status,
      buyerId: o.buyerId,
      developerId: o.developerId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    res.json({ success: true, data } as ApiResponse<OrderResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Mine error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/developer ── 我接的单 ──────────────

orderRoutes.get('/developer', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const orders = db.listDeveloperOrders(user.id);
    const data: OrderResponse[] = orders.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      userInfo: o.userInfo,
      problem: o.problem,
      features: o.features,
      antiFeatures: o.antiFeatures,
      successCriteria: o.successCriteria,
      status: o.status,
      buyerId: o.buyerId,
      developerId: o.developerId,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    }));

    res.json({ success: true, data } as ApiResponse<OrderResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Developer error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/:id ── 订单详情 + 进度 ────────────

orderRoutes.get('/:id', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    const progress = db.getOrderProgress(order.id);

    res.json({
      success: true,
      data: {
        order: {
          id: order.id,
          title: order.title,
          description: order.description,
          userInfo: order.userInfo,
          problem: order.problem,
          features: order.features,
          antiFeatures: order.antiFeatures,
          successCriteria: order.successCriteria,
          status: order.status,
          buyerId: order.buyerId,
          developerId: order.developerId,
          createdAt: order.createdAt,
          updatedAt: order.updatedAt,
        },
        progress: progress.map((p) => ({
          id: p.id,
          orderId: p.orderId,
          title: p.title,
          content: p.content,
          createdAt: p.createdAt,
        })),
      },
    });
  } catch (err: any) {
    console.error('[Orders] Detail error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/orders/:id/claim ── 接单 ────────────────

orderRoutes.post('/:id/claim', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }
  if (user.role !== 'developer') {
    res.status(403).json({ success: false, error: '只有开发者可以接单' } as ApiResponse);
    return;
  }

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.status !== 'pending') {
      res.status(409).json({ success: false, error: '该订单已被接单' } as ApiResponse);
      return;
    }
    if (order.buyerId === user.id) {
      res.status(403).json({ success: false, error: '不能接自己的单' } as ApiResponse);
      return;
    }

    db.updateOrder(order.id, { developerId: user.id, status: 'claimed' });

    res.json({ success: true, data: { status: 'claimed' } } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Claim error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/orders/:id/progress ── 添加进度 ─────────

orderRoutes.post('/:id/progress', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有接单的开发者可以添加进度' } as ApiResponse);
      return;
    }

    const { title, content } = req.body as { title?: string; content?: string };
    if (!content) {
      res.status(400).json({ success: false, error: '请填写进度内容' } as ApiResponse);
      return;
    }

    db.addProgress({ id: uuid(), orderId: order.id, title, content });

    res.status(201).json({ success: true } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Progress error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/:id/progress ── 获取进度 ──────────

orderRoutes.get('/:id/progress', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    const progress = db.getOrderProgress(order.id);

    res.json({
      success: true,
      data: progress.map((p) => ({
        id: p.id,
        orderId: p.orderId,
        title: p.title,
        content: p.content,
        createdAt: p.createdAt,
      })),
    } as ApiResponse<OrderProgressResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Progress list error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/orders/:id/status ── 更新状态 ───────────

orderRoutes.post('/:id/status', (req: Request, res: Response) => {
  const user = getUserFromSid(req);
  if (!user) {
    res.status(401).json({ success: false, error: '未登录' } as ApiResponse);
    return;
  }

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有接单的开发者可以更新状态' } as ApiResponse);
      return;
    }

    const { status } = req.body as { status?: string };
    const validStatuses = ['pending', 'claimed', 'in_progress', 'reviewing', 'completed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      res.status(400).json({ success: false, error: '无效的状态' } as ApiResponse);
      return;
    }

    db.updateOrder(order.id, { status });

    res.json({ success: true, data: { status } } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Status error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});
