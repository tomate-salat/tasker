import type { Kind, Stub } from '@shared/api.js';
import type { Data } from '@shared/model.js';

export type Account = { email: string; name: string; avatar: string };

export type Bootstrap = Data & {
  stubs: Stub[];
  archiveCounts: Record<string, number>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Bei 409: der Stand, den der Server inzwischen hat. */
    readonly current?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  const body = (await res.json().catch(() => null)) as
    | { error?: string; current?: unknown }
    | null;
  if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status, body?.current);
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export const api = {
  me: () => request<{ account: Account | null }>('/api/me'),

  login: (email: string, password: string, keepSignedIn: boolean) =>
    post<{ account: Account }>('/api/login', { email, password, keepSignedIn }),

  logout: () => post<{ ok: true }>('/api/logout'),

  status: () => request<{ database: string; boots: number; firstBootAt: string }>('/api/status'),

  bootstrap: () => request<Bootstrap>('/api/bootstrap'),

  create: <T>(kind: Kind, input: Record<string, unknown>) => post<T>(`/api/${kind}`, input),

  patch: <T>(kind: Kind, id: string, version: number, changes: Record<string, unknown>) =>
    request<T>(`/api/${kind}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, changes }),
    }),

  remove: (kind: Kind, id: string) =>
    request<{ trashId: string }>(`/api/${kind}/${id}`, { method: 'DELETE' }),

  archive: <T>(kind: 'task' | 'milestone', id: string) => post<T>(`/api/${kind}/${id}/archive`),

  restore: <T>(kind: 'task' | 'milestone', id: string) => post<T>(`/api/${kind}/${id}/restore`),

  move: <T>(id: string, version: number, target: Record<string, unknown>) =>
    post<T>('/api/move', { id, version, ...target }),
};
