import { Router, Request, Response } from 'express';
import { db } from '../services/database';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { v4 as uuid } from 'uuid';
import crypto from 'crypto';
import type {
  ApiResponse,
  RepoResponse,
  InitRepoRequest,
  CommitRequest,
  CommitResponse,
  CommitsResponse,
  TreeResponse,
  FileResponse,
  BranchResponse,
  CreateBranchRequest,
  CheckoutRequest,
  ApiSpecResponse,
} from '../models';

function paramId(req: Request): string {
  const id = req.params.id;
  return Array.isArray(id) ? id[0] : id;
}

function paramOrderId(req: Request): string {
  const id = req.params.orderId;
  return Array.isArray(id) ? id[0] : id;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

function decodeContent(content: string): Buffer {
  if (content.startsWith('base64:')) {
    return Buffer.from(content.slice(7), 'base64');
  }
  return Buffer.from(content, 'utf-8');
}

function encodeContent(buf: Buffer | Uint8Array): string {
  // Normalize to Buffer (sql.js returns Uint8Array)
  const b = buf instanceof Buffer ? buf : Buffer.from(buf);
  try {
    const text = b.toString('utf-8');
    return text;
  } catch {}
  return 'base64:' + b.toString('base64');
}

export const repoRoutes = Router();

// ─── GET /api/repos/spec ── LLM API 规范（无需登录） ───
repoRoutes.get('/spec', (_req: Request, res: Response) => {
  const spec = `# AI Coding Platform — 内置代码仓库 API 使用说明

本 API 为 AI 编程工具提供内置版本管理功能，无需安装 Git 或注册 GitHub。

## 基本概念
- 每个订单（order）对应一个代码仓库（repo）
- 提交（commit）创建版本快照，自动编号 v1, v2, v3...
- 分支（branch）指向某个提交，用于并行开发
- 回退（rollback）创建新提交恢复目标版本，历史不丢失

## 认证
所有请求需在 Header 中携带: Authorization: Bearer <sid>

## API 列表

### 1. 获取仓库信息
GET /api/repos/:orderId
响应: { success, data: { id, orderId, defaultBranch, currentBranch, currentRef, totalCommits, totalBranches } }

### 2. 初始化仓库
POST /api/repos/:orderId/init
请求体: { defaultBranch?: "main" }
注意：每个订单只需初始化一次

### 3. 查看文件树
GET /api/repos/:orderId/tree?ref=v3
不传 ref 则取当前分支最新版本
响应: { success, data: { ref, commitId, message, files: [{ path, size, action }] } }

### 4. 查看文件内容
GET /api/repos/:orderId/file?path=src/index.ts&ref=v3
不传 ref 则取当前分支最新版本
响应: { success, data: { ref, path, content, size } }

### 5. 提交代码（创建版本快照）
POST /api/repos/:orderId/commit
请求体: {
  message: "代码版本名称",
  description: "版本描述（选填）",
  files: [
    { path: "src/index.ts", content: "文件内容" },
    { path: "logo.png", content: "base64:base64编码的内容" }
  ]
}
说明：
- 文件内容纯文本直接传 UTF-8 字符串
- 二进制文件用 base64: 前缀标记
- 覆盖上传已有路径 = 修改，新增路径 = 添加
- 不存在的文件会被自动视为删除

### 6. 提交历史
GET /api/repos/:orderId/commits?branch=main
不传 branch 则显示所有提交
响应: { success, data: { commits: [{ ref, id, message, branch, parentRef, authorName, fileCount, createdAt }], total } }

### 7. 创建分支
POST /api/repos/:orderId/branches
请求体: { name: "feature-login", ref: "v2" }
不传 ref 则基于当前分支最新版本创建

### 8. 分支列表
GET /api/repos/:orderId/branches
响应: { success, data: [{ name, headRef, createdAt }] }

### 9. 切换当前分支
POST /api/repos/:orderId/checkout
请求体: { branch: "feature-login" }
响应: { success, data: { branch, ref } }

### 10. 版本差异对比
GET /api/repos/:orderId/diff?from=v1&to=v2
响应: { success, data: { fromRef, toRef, changes: [{ path, action, beforeRef, afterRef }] } }

### 11. 回退到指定版本
POST /api/repos/:orderId/rollback
请求体: { ref: "v2" }
行为：创建一个新提交，把所有文件恢复到目标版本状态
响应: { success, data: { newRef: "v5", message: "rollback to v2", targetRef: "v2", files: [{ path, content }] } }
注意：返回的 files 数组包含目标版本的所有文件内容，AI 应将它们写入本地磁盘
`;

  res.json({ success: true, data: { spec } } as ApiResponse<ApiSpecResponse>);
});

// ─── 所有仓库路由都需要登录 ────────────────────────────
repoRoutes.use(requireAuth);

// ─── GET /api/repos/:orderId ── 仓库信息 ──────────────
repoRoutes.get('/:orderId', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.buyerId !== user.id && order.developerId !== user.id && order.developerId !== null) {
      res.status(403).json({ success: false, error: '无权访问' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.json({ success: true, data: null } as ApiResponse<null>);
      return;
    }

    const branches = db.listBranches(repo.id);
    const branchNames = branches.map(b => b.name);
    // Determine "current" branch — first try to infer from request or use default
    const defaultBranch = repo.defaultBranch;
    const branch = db.getBranch(repo.id, defaultBranch);
    const totalCommits = db.getCommitCount(repo.id);

    const data: RepoResponse = {
      id: repo.id,
      orderId: repo.orderId,
      defaultBranch: repo.defaultBranch,
      currentBranch: defaultBranch,
      currentRef: branch?.headCommitId
        ? db.getCommit(branch.headCommitId)?.ref || null
        : null,
      totalCommits,
      totalBranches: branches.length,
      branches: branches.map(b => ({
        name: b.name,
        headRef: b.headCommitId ? db.getCommit(b.headCommitId)?.ref || null : null,
        createdAt: b.createdAt,
      })),
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    };

    res.json({ success: true, data } as ApiResponse<RepoResponse>);
  } catch (err: any) {
    console.error('[Repos] Info error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/repos/:orderId/init ── 初始化仓库 ──────
repoRoutes.post('/:orderId/init', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有接单的开发者可以管理代码' } as ApiResponse);
      return;
    }

    const existing = db.getRepoByOrderId(paramOrderId(req));
    if (existing) {
      res.status(409).json({ success: false, error: '仓库已初始化' } as ApiResponse);
      return;
    }

    const body = req.body as InitRepoRequest;
    const repoId = uuid();
    db.initRepo({
      id: repoId,
      orderId: paramOrderId(req),
      defaultBranch: body.defaultBranch,
    });

    const repo = db.getRepo(repoId)!;
    const branches = db.listBranches(repo.id);

    const data: RepoResponse = {
      id: repo.id,
      orderId: repo.orderId,
      defaultBranch: repo.defaultBranch,
      currentBranch: repo.defaultBranch,
      currentRef: null,
      totalCommits: 0,
      totalBranches: branches.length,
      branches: branches.map(b => ({
        name: b.name,
        headRef: null,
        createdAt: b.createdAt,
      })),
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt,
    };

    res.status(201).json({ success: true, data } as ApiResponse<RepoResponse>);
  } catch (err: any) {
    console.error('[Repos] Init error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/repos/:orderId/commit ── 提交代码 ──────
repoRoutes.post('/:orderId/commit', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有接单的开发者可以提交代码' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.status(400).json({ success: false, error: '请先初始化仓库' } as ApiResponse);
      return;
    }

    const { message, description, files } = req.body as CommitRequest;
    if (!message || !files || !files.length) {
      res.status(400).json({ success: false, error: '请填写提交说明并至少上传一个文件' } as ApiResponse);
      return;
    }

    // ── 确定目标分支（优先 ?branch= 查询参数，否则用默认分支） ──
    const targetBranchName = (req.query.branch as string) || repo.defaultBranch;
    const branch = db.getBranch(repo.id, targetBranchName);
    if (!branch) {
      res.status(400).json({ success: false, error: `分支 ${targetBranchName} 不存在` } as ApiResponse);
      return;
    }
    const parentId = branch.headCommitId || undefined;

    // Create the commit
    const commitId = uuid();
    const commit = db.createCommit({
      id: commitId,
      repoId: repo.id,
      message,
      description,
      parentId,
    });

    // Store files
    for (const file of files) {
      const content = file.content || '';
      const buf = decodeContent(content);
      const h = hashContent(buf.toString('utf-8'));
      db.storeBlob(h, buf, buf.length);
      db.addCommitFile({
        commitId: commit.id,
        filePath: file.path,
        fileHash: h,
        fileSize: buf.length,
        action: file.action || (content === '' ? 'delete' : 'add'),
      });
    }

    // Update branch head
    db.updateBranchHead(repo.id, targetBranchName, commit.id);

    // Build response
    const commitData: CommitResponse = {
      ref: commit.ref,
      id: commit.id,
      message: commit.message,
      description: commit.description,
      branch: targetBranchName,
      parentRef: commit.parentId ? db.getCommit(commit.parentId)?.ref || null : null,
      authorId: user.id,
      authorName: user.name,
      fileCount: files.length,
      createdAt: commit.createdAt,
    };

    res.status(201).json({ success: true, data: commitData } as ApiResponse<CommitResponse>);
  } catch (err: any) {
    console.error('[Repos] Commit error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/repos/:orderId/commits ── 提交历史 ──────
repoRoutes.get('/:orderId/commits', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.buyerId !== user.id && order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '无权访问' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.json({ success: true, data: { commits: [], total: 0 } } as ApiResponse<CommitsResponse>);
      return;
    }

    const branchName = (req.query.branch as string) || undefined;
    const commits = db.listCommits(repo.id, branchName);

    const data: CommitsResponse = {
      commits: commits.map(c => {
        const files = db.getCommitFiles(c.id);
        return {
          ref: c.ref,
          id: c.id,
          message: c.message,
          description: c.description,
          branch: branchName || repo.defaultBranch,
          parentRef: c.parentId ? db.getCommit(c.parentId)?.ref || null : null,
          authorId: user.id,
          authorName: user.name,
          fileCount: files.length,
          createdAt: c.createdAt,
        } as CommitResponse;
      }),
      total: commits.length,
    };

    res.json({ success: true, data } as ApiResponse<CommitsResponse>);
  } catch (err: any) {
    console.error('[Repos] Commits error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/repos/:orderId/tree ── 文件树 ───────────
repoRoutes.get('/:orderId/tree', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.buyerId !== user.id && order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '无权访问' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.status(400).json({ success: false, error: '仓库不存在' } as ApiResponse);
      return;
    }

    const ref = req.query.ref as string;
    const branchName = req.query.branch as string;
    let commitId: string;

    if (ref) {
      const commit = db.getCommitByRef(repo.id, ref);
      if (!commit) {
        res.status(404).json({ success: false, error: `版本 ${ref} 不存在` } as ApiResponse);
        return;
      }
      commitId = commit.id;
    } else {
      const targetBranch = branchName || repo.defaultBranch;
      const branch = db.getBranch(repo.id, targetBranch);
      if (!branch || !branch.headCommitId) {
        res.json({ success: true, data: { ref: null, commitId: null, message: '暂无提交', files: [] } } as unknown as ApiResponse<TreeResponse>);
        return;
      }
      commitId = branch.headCommitId;
    }

    const commit = db.getCommit(commitId)!;
    const files = db.getTreeAtCommit(commitId);

    const data: TreeResponse = {
      ref: commit.ref,
      commitId: commit.id,
      message: commit.message,
      files: files.map(f => ({
        path: f.filePath,
        size: f.fileSize,
        action: f.action as any,
      })),
    };

    res.json({ success: true, data } as ApiResponse<TreeResponse>);
  } catch (err: any) {
    console.error('[Repos] Tree error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/repos/:orderId/file ── 文件内容 ─────────
repoRoutes.get('/:orderId/file', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.buyerId !== user.id && order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '无权访问' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.status(400).json({ success: false, error: '仓库不存在' } as ApiResponse);
      return;
    }

    const filePath = req.query.path as string;
    if (!filePath) {
      res.status(400).json({ success: false, error: '请指定文件路径 (?path=...)' } as ApiResponse);
      return;
    }

    const ref = req.query.ref as string;
    const branchName = req.query.branch as string;
    let commitId: string;

    if (ref) {
      const commit = db.getCommitByRef(repo.id, ref);
      if (!commit) {
        res.status(404).json({ success: false, error: `版本 ${ref} 不存在` } as ApiResponse);
        return;
      }
      commitId = commit.id;
    } else {
      const targetBranch = branchName || repo.defaultBranch;
      const branch = db.getBranch(repo.id, targetBranch);
      if (!branch || !branch.headCommitId) {
        res.status(404).json({ success: false, error: '暂无提交' } as ApiResponse);
        return;
      }
      commitId = branch.headCommitId;
    }

    const tree = db.getTreeAtCommit(commitId);
    const entry = tree.find(f => f.filePath === filePath);
    if (!entry) {
      res.status(404).json({ success: false, error: '文件不存在' } as ApiResponse);
      return;
    }

    const blob = db.getBlob(entry.fileHash);
    if (!blob) {
      res.status(500).json({ success: false, error: '文件内容丢失' } as ApiResponse);
      return;
    }

    const commit = db.getCommit(commitId)!;
    const data: FileResponse = {
      ref: commit.ref,
      path: filePath,
      content: encodeContent(blob),
      size: blob.length,
    };

    res.json({ success: true, data } as ApiResponse<FileResponse>);
  } catch (err: any) {
    console.error('[Repos] File error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── PUT /api/repos/:orderId/commits/:ref ── 修改版本名称 ─
repoRoutes.put('/:orderId/commits/:ref', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    if (user.role !== 'developer') {
      res.status(403).json({ success: false, error: '只有开发者可以操作' } as ApiResponse);
      return;
    }
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '无权操作' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.status(400).json({ success: false, error: '仓库不存在' } as ApiResponse);
      return;
    }

    const ref = Array.isArray(req.params.ref) ? req.params.ref[0] : req.params.ref;
    const commit = db.getCommitByRef(repo.id, ref);
    if (!commit) {
      res.status(404).json({ success: false, error: '版本不存在' } as ApiResponse);
      return;
    }

    const { message, description } = req.body as { message?: string; description?: string };
    if (!message || !message.trim()) {
      res.status(400).json({ success: false, error: '版本名称不能为空' } as ApiResponse);
      return;
    }

    db.updateCommitMessage(commit.id, message.trim(), description !== undefined ? description : commit.description);

    res.json({ success: true, data: { ref, message: message.trim() } } as ApiResponse);
  } catch (err: any) {
    console.error('[Repos] Rename commit error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── GET /api/repos/:orderId/branches ── 分支列表 ─────
repoRoutes.get('/:orderId/branches', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.buyerId !== user.id && order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '无权访问' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.json({ success: true, data: [] } as ApiResponse<BranchResponse[]>);
      return;
    }

    const branches = db.listBranches(repo.id);
    const data: BranchResponse[] = branches.map(b => ({
      name: b.name,
      headRef: b.headCommitId ? db.getCommit(b.headCommitId)?.ref || null : null,
      createdAt: b.createdAt,
    }));

    res.json({ success: true, data } as ApiResponse<BranchResponse[]>);
  } catch (err: any) {
    console.error('[Repos] Branches error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/repos/:orderId/branches ── 创建分支 ────
repoRoutes.post('/:orderId/branches', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有开发者可以管理分支' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.status(400).json({ success: false, error: '请先初始化仓库' } as ApiResponse);
      return;
    }

    const { name, ref } = req.body as CreateBranchRequest;
    if (!name) {
      res.status(400).json({ success: false, error: '请指定分支名称' } as ApiResponse);
      return;
    }

    // Check if branch already exists
    const existing = db.getBranch(repo.id, name);
    if (existing) {
      res.status(409).json({ success: false, error: `分支 ${name} 已存在` } as ApiResponse);
      return;
    }

    let headCommitId: string | undefined;
    if (ref) {
      const commit = db.getCommitByRef(repo.id, ref);
      if (!commit) {
        res.status(404).json({ success: false, error: `版本 ${ref} 不存在` } as ApiResponse);
        return;
      }
      headCommitId = commit.id;
    } else {
      const branch = db.getBranch(repo.id, repo.defaultBranch);
      headCommitId = branch?.headCommitId || undefined;
    }

    db.createBranch(repo.id, name, headCommitId);
    const branch = db.getBranch(repo.id, name)!;

    const data: BranchResponse = {
      name: branch.name,
      headRef: branch.headCommitId ? db.getCommit(branch.headCommitId)?.ref || null : null,
      createdAt: branch.createdAt,
    };

    res.status(201).json({ success: true, data } as ApiResponse<BranchResponse>);
  } catch (err: any) {
    console.error('[Repos] Create branch error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});

// ─── POST /api/repos/:orderId/checkout ── 切换分支 ────
repoRoutes.post('/:orderId/checkout', (req: Request, res: Response) => {
  try {
    const user = (req as AuthenticatedRequest).currentUser;
    const order = db.getOrderById(paramOrderId(req));
    if (!order) {
      res.status(404).json({ success: false, error: '订单不存在' } as ApiResponse);
      return;
    }
    if (order.developerId !== user.id) {
      res.status(403).json({ success: false, error: '只有开发者可以切换分支' } as ApiResponse);
      return;
    }

    const repo = db.getRepoByOrderId(paramOrderId(req));
    if (!repo) {
      res.status(400).json({ success: false, error: '请先初始化仓库' } as ApiResponse);
      return;
    }

    const { branch: branchName } = req.body as CheckoutRequest;
    if (!branchName) {
      res.status(400).json({ success: false, error: '请指定分支名称' } as ApiResponse);
      return;
    }

    // In this simplified model, "checkout" means we just track which branch
    // is active and return its HEAD ref. For per-branch checkout tracking,
    // we'd need a session-level state — for now, we just validate the branch exists.
    const branch = db.getBranch(repo.id, branchName);
    if (!branch) {
      res.status(404).json({ success: false, error: `分支 ${branchName} 不存在` } as ApiResponse);
      return;
    }

    res.json({
      success: true,
      data: {
        branch: branchName,
        ref: branch.headCommitId ? db.getCommit(branch.headCommitId)?.ref || null : null,
      },
    } as ApiResponse);
  } catch (err: any) {
    console.error('[Repos] Checkout error:', err.message);
    res.status(500).json({ success: false, error: '服务器错误' } as ApiResponse);
  }
});


