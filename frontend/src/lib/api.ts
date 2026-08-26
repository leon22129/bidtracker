'use client';

import type {
  AnalyticsOverview, ApplicationFilters, ImportPreview, ImportResult, JobApplication, Paginated,
  PermissionType, PaymentReport, PaymentReportResult, Role, UrlPreviewResult, User, Workspace,
  WorkspaceSummary,
} from './types';

/**
 * Single HTTP client for the whole app.
 *
 * Base URL is '' by default, so requests go to `/api/*` on the app's own origin and Next's rewrite
 * forwards them to the backend container. That keeps production same-origin (no CORS, tighter CSP,
 * one tunnel hostname) while `NEXT_PUBLIC_API_BASE_URL` still allows a split-origin setup.
 */
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const TOKEN_KEY = 'bidtracker_token';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const tokenStore = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(TOKEN_KEY);
  },
  set(token: string) {
    window.localStorage.setItem(TOKEN_KEY, token);
  },
  clear() {
    window.localStorage.removeItem(TOKEN_KEY);
  },
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = tokenStore.get();
  const isFormData = init.body instanceof FormData;

  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (res.status === 401) {
    // The token is gone or the account was deactivated: drop it and bounce to login. Doing this
    // centrally means no page has to handle expiry itself.
    tokenStore.clear();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!res.ok) {
    let body: any = null;
    let message = `Request failed (${res.status})`;
    try {
      body = await res.json();
      // Nest's ValidationPipe returns `message` as an array of field errors.
      message = Array.isArray(body?.message) ? body.message.join(', ') : (body?.message ?? message);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length) sp.set(key, value.join(','));
    } else {
      sp.set(key, String(value));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const api = {
  // ---- auth ----
  login: (email: string, password: string) =>
    request<{ access_token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<User>('/auth/me'),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  // ---- users (admin) ----
  listUsers: () => request<User[]>('/users'),
  createUser: (data: { username: string; email: string; password: string; role: Role }) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (
    id: string,
    data: Partial<{ username: string; email: string; role: Role; is_active: boolean }>,
  ) => request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  resetUserPassword: (id: string, newPassword: string) =>
    request<{ success: boolean }>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ new_password: newPassword }),
    }),
  deleteUser: (id: string) => request<{ success: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  // ---- workspaces ----
  listWorkspaces: (includeArchived = false) =>
    request<Workspace[]>(`/workspaces${qs({ includeArchived: includeArchived || undefined })}`),
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  createWorkspace: (data: { name: string; owner_user_id: string }) =>
    request<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify(data) }),
  updateWorkspace: (
    id: string,
    data: Partial<{ name: string; owner_user_id: string; is_archived: boolean }>,
  ) => request<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteWorkspace: (id: string) =>
    request<{ success: boolean; deleted_applications: number }>(`/workspaces/${id}`, {
      method: 'DELETE',
    }),
  grantPermission: (workspaceId: string, userId: string, permission: PermissionType) =>
    request<unknown>(`/workspaces/${workspaceId}/permissions`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, permission_type: permission }),
    }),
  revokePermission: (workspaceId: string, userId: string) =>
    request<{ success: boolean }>(`/workspaces/${workspaceId}/permissions/${userId}`, {
      method: 'DELETE',
    }),

  // ---- applications ----
  listApplications: (
    workspaceId: string,
    page: number,
    pageSize: number,
    filters: ApplicationFilters = {},
  ) =>
    request<Paginated<JobApplication>>(
      `/applications${qs({
        workspace_id: workspaceId,
        page,
        page_size: pageSize,
        search: filters.search,
        application_status: filters.application_status,
        pipeline_status: filters.pipeline_status,
        job_source: filters.job_source,
        paid: filters.paid,
        date_from: filters.date_from,
        date_to: filters.date_to,
        sort_by: filters.sort_by,
        sort_dir: filters.sort_dir,
      })}`,
    ),
  workspaceSummary: (workspaceId: string) =>
    request<WorkspaceSummary>(`/applications/summary${qs({ workspace_id: workspaceId })}`),
  updateApplication: (id: string, patch: Partial<JobApplication>) =>
    request<JobApplication>(`/applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  updatePipeline: (
    id: string,
    patch: { pipeline_status?: string },
  ) =>
    request<JobApplication>(`/applications/${id}/pipeline`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  bulkUpdate: (ids: string[], patch: Partial<JobApplication>) =>
    request<{ updated: number; failed: Array<{ id: string; reason: string }> }>(
      '/applications/bulk',
      { method: 'PATCH', body: JSON.stringify({ ids, patch }) },
    ),
  bulkDelete: (ids: string[]) =>
    request<{ deleted: number }>('/applications/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  createFromUrls: (data: {
    workspace_id: string;
    date: string;
    urls: string;
    enrich?: boolean;
  }) =>
    request<{
      created: number;
      duplicates: number;
      invalid_lines: string[];
      duplicate_details: Array<{ url: string; reason: string; existing_in: string }>;
    }>('/applications/urls', { method: 'POST', body: JSON.stringify(data) }),
  previewUrls: (workspaceId: string, urls: string) =>
    request<UrlPreviewResult>('/applications/urls/preview', {
      method: 'POST',
      body: JSON.stringify({ workspace_id: workspaceId, urls }),
    }),

  // ---- import ----
  importPreview: (workspaceId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return request<ImportPreview>(`/import/${workspaceId}/preview`, { method: 'POST', body: form });
  },
  importRun: (workspaceId: string, file: File, opts: { enrich: boolean; default_date?: string }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('enrich', String(opts.enrich));
    if (opts.default_date) form.append('default_date', opts.default_date);
    return request<ImportResult>(`/import/${workspaceId}`, { method: 'POST', body: form });
  },

  // ---- payment reports ----
  paymentReport: (start_date?: string, end_date?: string) =>
    request<PaymentReportResult>(`/payments/report${qs({ start_date, end_date })}`),
  paymentHistory: () => request<PaymentReport[]>('/payments/history'),
  processPayment: (data: { bidder_id: string; start_date: string; end_date: string }) =>
    request<PaymentReport>('/payments/process', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ---- analytics (admin) ----
  analyticsOverview: (params: { from?: string; to?: string; workspace_id?: string } = {}) =>
    request<AnalyticsOverview>(`/analytics/overview${qs(params)}`),
};
