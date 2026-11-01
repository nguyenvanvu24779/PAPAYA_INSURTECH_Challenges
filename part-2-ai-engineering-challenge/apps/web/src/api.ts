import type { Actor, ApiError, AuditEntry, AvailableTransition, Claim, FieldKind, Workflow } from './types';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiError };

async function call<T>(path: string, init?: { method: string; body: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`/api${path}`, {
      method: init?.method ?? 'GET',
      headers: init ? { 'Content-Type': 'application/json' } : undefined,
      body: init ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: json as T };
    const error = json?.error as ApiError | undefined;
    return { ok: false, error: error ?? { code: 'HTTP_' + res.status, message: `Request failed (${res.status})`, details: [] } };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'Cannot reach the server. Is the API running?', details: [] } };
  }
}

export const api = {
  workflow: () => call<{ workflow: Workflow; fields: Record<string, FieldKind> }>('/workflow'),
  claims: () => call<{ claims: Claim[] }>('/claims'),
  claim: (id: string) => call<{ claim: Claim }>(`/claims/${id}`),
  transitions: (id: string) => call<{ state: string; transitions: AvailableTransition[] }>(`/claims/${id}/transitions`),
  audit: (id: string) => call<{ entries: AuditEntry[] }>(`/claims/${id}/audit`),
  createClaim: (actor: Actor, data: Record<string, unknown>, reason: string) =>
    call<{ claim: Claim }>('/claims', { method: 'POST', body: { actor, data, reason } }),
  updateData: (id: string, actor: Actor, data: Record<string, unknown>, reason: string) =>
    call<{ claim: Claim }>(`/claims/${id}/data`, { method: 'PATCH', body: { actor, data, reason } }),
  transition: (id: string, actor: Actor, to: string, reason: string) =>
    call<{ claim: Claim }>(`/claims/${id}/transition`, { method: 'POST', body: { actor, to, reason } }),
};
