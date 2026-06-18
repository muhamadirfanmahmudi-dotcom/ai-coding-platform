// ─── 类型定义 ─────────────────────────────────────────────

export type OrderStatus = 'pending' | 'claimed' | 'in_progress' | 'reviewing' | 'completed' | 'cancelled';

// ─── API 请求/响应类型 ────────────────────────────────────

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
  role?: 'buyer' | 'developer';
}

export interface LoginRequest {
  email: string;
  password: string;
  role?: 'buyer' | 'developer';
}

export interface CreateOrderRequest {
  title: string;
  description: string;
  userInfo?: string;
  problem?: string;
  features?: string;
  antiFeatures?: string;
  successCriteria?: string;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: string;
  sid: string;
}

export interface OrderResponse {
  id: string;
  title: string;
  description: string;
  userInfo: string | null;
  problem: string | null;
  features: string | null;
  antiFeatures: string | null;
  successCriteria: string | null;
  status: OrderStatus;
  buyerId: string;
  developerId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrderProgressResponse {
  id: string;
  orderId: string;
  title: string | null;
  content: string;
  createdAt: string;
}

// ═══════════════════════════════════════════════════════════
//  Code Repository Types  (内置代码版本管理)
// ═══════════════════════════════════════════════════════════

/** 文件操作类型 */
export type FileAction = 'add' | 'modify' | 'delete';

/** 仓库信息 */
export interface RepoResponse {
  id: string;
  orderId: string;
  defaultBranch: string;
  currentBranch: string;
  currentRef: string | null;
  totalCommits: number;
  totalBranches: number;
  createdAt: string;
  updatedAt: string;
}

/** 初始化仓库请求 */
export interface InitRepoRequest {
  defaultBranch?: string;
}

/** 提交请求 */
export interface CommitRequest {
  message: string;
  files: CommitFileEntry[];
}

/** 单次提交中的文件条目 */
export interface CommitFileEntry {
  path: string;
  content: string;
  action?: FileAction;
}

/** 提交记录 */
export interface CommitResponse {
  ref: string;
  id: string;
  message: string;
  branch: string;
  parentRef: string | null;
  authorId: string;
  authorName: string;
  fileCount: number;
  createdAt: string;
}

/** 提交历史列表 */
export interface CommitsResponse {
  commits: CommitResponse[];
  total: number;
}

/** 文件树条目 */
export interface TreeEntry {
  path: string;
  size: number | null;
  action: FileAction;
}

/** 文件树响应 */
export interface TreeResponse {
  ref: string;
  commitId: string;
  message: string;
  files: TreeEntry[];
}

/** 文件内容响应 */
export interface FileResponse {
  ref: string;
  path: string;
  content: string;
  size: number;
}

/** 分支信息 */
export interface BranchResponse {
  name: string;
  headRef: string | null;
  createdAt: string;
}

/** 创建分支请求 */
export interface CreateBranchRequest {
  name: string;
  ref?: string;
}

/** 切换分支请求 */
export interface CheckoutRequest {
  branch: string;
}

/** 回退请求 */
export interface RollbackRequest {
  ref: string;
}

/** 回退响应（返回目标版本所有文件，便于 AI 直接写入本地） */
export interface RollbackResponse {
  newRef: string;
  message: string;
  targetRef: string;
  files: { path: string; content: string }[];
}

/** 差异条目 */
export interface DiffEntry {
  path: string;
  action: FileAction;
  beforeRef: string | null;
  afterRef: string | null;
}

/** 差异响应 */
export interface DiffResponse {
  fromRef: string;
  toRef: string;
  changes: DiffEntry[];
}

/** LLM API 规范响应 */
export interface ApiSpecResponse {
  spec: string;
}
