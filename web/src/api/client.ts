import type {
  Agent,
  AgentStatus,
  CallDetail,
  CallFilters,
  CallListItem,
  Campaign,
  CampaignStats,
  Paged,
  PageMeta,
  UploadResult,
} from './types';

export const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
export const API_KEY = import.meta.env.VITE_API_KEY ?? '';

/** Error carrying the backend's `{ code, message, details }` envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown[],
  ) {
    super(message);
  }
}

interface Envelope<T> {
  success: boolean;
  data: T;
  meta?: PageMeta;
  error?: { code: string; message: string; details?: unknown[] };
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ data: T; meta?: PageMeta }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-API-Key': API_KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the API. Is the backend running?');
  }
  if (res.status === 204) return { data: undefined as T };
  const json = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (!res.ok || !json?.success) {
    throw new ApiError(
      res.status,
      json?.error?.code ?? 'HTTP_ERROR',
      json?.error?.message ?? `Request failed (${res.status})`,
      json?.error?.details,
    );
  }
  return { data: json.data, meta: json.meta };
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

async function paged<T>(path: string): Promise<Paged<T>> {
  const { data, meta } = await request<T[]>('GET', path);
  return { items: data, meta: meta ?? { page: 1, limit: data.length, total: data.length } };
}

export const api = {
  agents: {
    list: (params: { status?: AgentStatus; page?: number; limit?: number } = {}) =>
      paged<Agent>(`/api/agents${qs({ limit: 100, ...params })}`),
    create: (body: { name: string; email: string }) =>
      request<Agent>('POST', '/api/agents', body).then((r) => r.data),
    setStatus: (id: string, status: 'available' | 'offline') =>
      request<Agent>('PATCH', `/api/agents/${id}/status`, { status }).then((r) => r.data),
  },
  campaigns: {
    list: (params: { page?: number; limit?: number } = {}) =>
      paged<Campaign>(`/api/campaigns${qs({ limit: 50, ...params })}`),
    create: (body: { name: string; maxCps: number; maxAttempts: number }) =>
      request<Campaign>('POST', '/api/campaigns', body).then((r) => r.data),
    start: (id: string) =>
      request<Campaign>('POST', `/api/campaigns/${id}/start`).then((r) => r.data),
    pause: (id: string) =>
      request<Campaign>('POST', `/api/campaigns/${id}/pause`).then((r) => r.data),
    stats: (id: string) =>
      request<CampaignStats>('GET', `/api/campaigns/${id}/stats`).then((r) => r.data),
    uploadLeads: (id: string, leads: { phone: string; name?: string }[]) =>
      request<UploadResult>('POST', `/api/campaigns/${id}/leads`, leads).then((r) => r.data),
  },
  calls: {
    list: (filters: CallFilters) =>
      paged<CallListItem>(
        `/api/calls${qs({
          ...filters,
          from: filters.from ? new Date(filters.from).toISOString() : undefined,
          to: filters.to ? new Date(filters.to).toISOString() : undefined,
        })}`,
      ),
    listByStatuses: (statuses: string[], limit = 100) =>
      paged<CallListItem>(`/api/calls${qs({ status: statuses.join(','), limit })}`),
    get: (id: string) => request<CallDetail>('GET', `/api/calls/${id}`).then((r) => r.data),
  },
};
