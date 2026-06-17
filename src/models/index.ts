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
