/**
 * API client for the Token Rate Limiter backend.
 */

const BASE = "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------
export interface User {
  id: string;
  displayName: string;
  email: string;
  userName: string;
}
export interface ServicePrincipal {
  id: string;
  displayName: string;
  applicationId: string;
}
export interface Group {
  id: string;
  displayName: string;
}

export const fetchUsers = (search = "") =>
  request<User[]>(`/users?search=${encodeURIComponent(search)}`);

export const fetchServicePrincipals = (search = "") =>
  request<ServicePrincipal[]>(`/service-principals?search=${encodeURIComponent(search)}`);

export const fetchGroups = (search = "") =>
  request<Group[]>(`/groups?search=${encodeURIComponent(search)}`);

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
export interface TokenLimit {
  id: number;
  entity_type: string;
  entity_name: string;
  model_name: string | null;
  limit_type: string;
  limit_value: number;
  window_type: string;
  window_units: number;
  override: boolean;
  created_at: string;
  updated_at: string;
}

export const fetchLimits = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<TokenLimit[]>(`/limits${qs}`);
};

export const createLimit = (data: Omit<TokenLimit, "id" | "created_at" | "updated_at">) =>
  request<TokenLimit>("/limits", { method: "POST", body: JSON.stringify(data) });

export const updateLimit = (id: number, data: Partial<TokenLimit>) =>
  request<TokenLimit>(`/limits/${id}`, { method: "PUT", body: JSON.stringify(data) });

export const deleteLimit = (id: number) =>
  request<{ deleted: boolean }>(`/limits/${id}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Models & Pricing
// ---------------------------------------------------------------------------
export interface ModelPricing {
  id: number;
  model_name: string;
  input_price_per_token: number;
  output_price_per_token: number;
  updated_at: string;
}

export const fetchModels = () => request<string[]>("/models");

export const fetchPricing = () => request<ModelPricing[]>("/pricing");

export const updatePricing = (
  modelName: string,
  data: { input_price_per_token?: number; output_price_per_token?: number }
) =>
  request<ModelPricing>(`/pricing/${encodeURIComponent(modelName)}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

// ---------------------------------------------------------------------------
// Usage / Monitoring
// ---------------------------------------------------------------------------
export interface UsageRecord {
  id: number;
  user_name: string;
  model_name: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  input_token_usd: number;
  output_token_usd: number;
  total_cost_usd: number;
  request_timestamp: string;
  request_id: string | null;
}

export interface TimeseriesPoint {
  time_bucket: string;
  model_name: string;
  value: number;
}

export interface TopConsumer {
  user_name: string;
  value: number;
  request_count: number;
}

export interface NearLimitEntry {
  entity_name: string;
  entity_type: string;
  model_name: string;
  limit_type: string;
  limit_value: number;
  used: number;
  percentage: number;
  window_type: string;
  window_units: number;
  status: string;
}

export interface GaugeEntry {
  id: number;
  entity_name: string;
  entity_type: string;
  model_name: string;
  limit_type: string;
  limit_value: number;
  used: number;
  percentage: number;
  window_type: string;
  window_units: number;
}

export const fetchUsage = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<UsageRecord[]>(`/usage${qs}`);
};

export const fetchTimeseries = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<TimeseriesPoint[]>(`/usage/timeseries${qs}`);
};

export const fetchTopConsumers = (params?: Record<string, string>) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return request<TopConsumer[]>(`/usage/top-consumers${qs}`);
};

export const fetchNearLimit = (threshold = 0.9) =>
  request<NearLimitEntry[]>(`/usage/near-limit?threshold=${threshold}`);

export const fetchGauges = () => request<GaugeEntry[]>("/usage/gauge");
