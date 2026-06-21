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
  avatar?: string | null;
}

export interface ProfileUpdateRequest {
  name?: string;
  avatar?: string | null;
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
export interface RepoBranchInfo {
  name: string;
  headRef: string | null;
  createdAt: string;
}

export interface RepoResponse {
  id: string;
  orderId: string;
  defaultBranch: string;
  currentBranch: string;
  currentRef: string | null;
  totalCommits: number;
  totalBranches: number;
  branches: RepoBranchInfo[];
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
  description?: string;
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
  description?: string;
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

/** LLM API 规范响应 */
export interface ApiSpecResponse {
  spec: string;
}

// ═══════════════════════════════════════════════════════════
//  Chat Types
// ═══════════════════════════════════════════════════════════

export interface ChatMessageResponse {
  id: string;
  orderId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string | null;
  content: string;
  createdAt: string;
}

export interface SendChatRequest {
  content: string;
}
