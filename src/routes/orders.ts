import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { v4 as uuid } from 'uuid';
import type { ApiResponse, CreateOrderRequest, OrderResponse, OrderProgressResponse, OrderStatus } from '../models';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

/** 数据库行 → OrderResponse（不含 developerName） */
function fmtOrder(o: {
  id: string; title: string; description: string;
  userInfo: string | null; problem: string | null;
  features: string | null; antiFeatures: string | null; successCriteria: string | null;
  status: string; buyerId: string; developerId: string | null;
  createdAt: string; updatedAt: string;
}): OrderResponse {
  return {
    id: o.id, title: o.title, description: o.description,
    userInfo: o.userInfo, problem: o.problem,
    features: o.features, antiFeatures: o.antiFeatures, successCriteria: o.successCriteria,
    status: o.status as OrderStatus,
    buyerId: o.buyerId, developerId: o.developerId,
    createdAt: o.createdAt, updatedAt: o.updatedAt,
  };
}

export const orderRoutes = Router();

// ─── 所有订单路由都需要登录 ────────────────────────────
orderRoutes.use(requireAuth);

// ─── POST /api/orders ── 创建订单 ─────────────────────

orderRoutes.post('/', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;
  if (user.role !== 'buyer') {
    res.status(403).json({ success: false, error: '只有买家可以创建订单' } as ApiResponse);
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
      data: fmtOrder(order),
    };

    res.status(201).json(response);
  } catch (err: any) {
    console.error('[Orders] Create error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/hall ── 抢单大厅 ──────────────────

orderRoutes.get('/hall', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const orders = db.listHallOrders();
    const data: OrderResponse[] = orders.map(fmtOrder);

    res.json({ success: true, data } as ApiResponse<OrderResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Hall error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/mine ── 我的订单 ──────────────────

orderRoutes.get('/mine', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const orders = db.listMyOrders(user.id);
    const data: OrderResponse[] = orders.map(fmtOrder);

    res.json({ success: true, data } as ApiResponse<OrderResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Mine error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/developer ── 我接的单 ──────────────

orderRoutes.get('/developer', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const orders = db.listDeveloperOrders(user.id);
    const data: OrderResponse[] = orders.map(fmtOrder);

    res.json({ success: true, data } as ApiResponse<OrderResponse[]>);
  } catch (err: any) {
    console.error('[Orders] Developer error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/orders/:id ── 订单详情 + 进度 ────────────

orderRoutes.get('/:id', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    // 权限：待接单的订单任何人可看（大厅浏览），已接单的只有买家/开发者可看
    if (order.status !== 'pending' && user.id !== order.buyerId && user.id !== order.developerId) {
      res.status(403).json({ success: false, error: '无权查看该订单详情' } as ApiResponse);
      return;
    }

    const progress = db.getOrderProgress(order.id);

    // Enrich with developer name
    let developerName: string | null = null;
    if (order.developerId) {
      const dev = db.getUserById(order.developerId);
      if (dev) developerName = dev.name;
    }

    res.json({
      success: true,
      data: {
        order: { ...fmtOrder(order), developerName },
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
  const user = (req as AuthenticatedRequest).currentUser;
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
    db.initStages(order.id);

    res.json({ success: true, data: { status: 'claimed' } } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Claim error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/orders/:id/progress ── 添加进度 ─────────

orderRoutes.post('/:id/progress', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

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
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    // 只有买家或接单开发者可以查看进度
    if (user.id !== order.buyerId && user.id !== order.developerId) {
      res.status(403).json({ success: false, error: '无权查看该订单的进度' } as ApiResponse);
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
  const user = (req as AuthenticatedRequest).currentUser;

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

// ─── GET /api/orders/:id/stages ── 获取阶段列表 ───────

orderRoutes.get('/:id/stages', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }

    // 只有买家或接单开发者可以查看阶段内容
    if (user.id !== order.buyerId && user.id !== order.developerId) {
      res.status(403).json({ success: false, error: '无权查看该订单的开发阶段' } as ApiResponse);
      return;
    }

    let stages = db.getStages(order.id);
    if (stages.length === 0 && order.developerId) {
      db.initStages(order.id);
      stages = db.getStages(order.id);
    }

    res.json({ success: true, data: stages } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Stages error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── PUT /api/orders/:id/stages/:stage ── 更新阶段内容 ──

orderRoutes.put('/:id/stages/:stage', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有接单的开发者可以操作' } as ApiResponse);
      return;
    }

    const stageName = Array.isArray(req.params.stage) ? req.params.stage[0] : req.params.stage;
    const { content } = req.body as { content?: string };
    if (!content) {
      res.status(400).json({ success: false, error: '请填写内容' } as ApiResponse);
      return;
    }

    const stage = db.getStage(order.id, stageName);
    if (!stage) {
      res.status(404).json({ success: false, error: '阶段不存在' } as ApiResponse);
      return;
    }

    // 如果已完成则保留完成状态，否则标记为进行中
    const updateData: any = { content };
    if (stage.status !== 'completed') {
      updateData.status = 'in_progress';
    }
    db.updateStage(order.id, stageName, updateData);

    res.json({ success: true } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Stage update error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/orders/:id/stages/:stage/complete ── 完成阶段

orderRoutes.post('/:id/stages/:stage/complete', (req: Request, res: Response) => {
  const user = (req as AuthenticatedRequest).currentUser;

  try {
    const order = db.getOrderById(paramId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有接单的开发者可以操作' } as ApiResponse);
      return;
    }

    const stageName = Array.isArray(req.params.stage) ? req.params.stage[0] : req.params.stage;
    const stage = db.getStage(order.id, stageName);
    if (!stage) {
      res.status(404).json({ success: false, error: '阶段不存在' } as ApiResponse);
      return;
    }
    if (stage.status === 'completed') {
      res.status(400).json({ success: false, error: '该阶段已完成' } as ApiResponse);
      return;
    }
    if (!stage.content) {
      res.status(400).json({ success: false, error: '请先填写阶段内容' } as ApiResponse);
      return;
    }

    // Check previous stage is completed
    if (stage.stageOrder > 1) {
      const prevStage = db.getStages(order.id).find(s => s.stageOrder === stage.stageOrder - 1);
      if (prevStage && prevStage.status !== 'completed') {
        res.status(400).json({ success: false, error: '请先完成上一阶段' } as ApiResponse);
        return;
      }
    }

    db.updateStage(order.id, stageName, { status: 'completed' });

    // Check if all stages completed
    const allStages = db.getStages(order.id);
    const allCompleted = allStages.every(s => s.status === 'completed');
    if (allCompleted) {
      db.updateOrder(order.id, { status: 'reviewing' });
    }

    res.json({ success: true, data: { allCompleted } } as ApiResponse);
  } catch (err: any) {
    console.error('[Orders] Stage complete error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});
