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

export type ArchivePage = {
  total: number;
  entries: { kind: 'task' | 'milestone'; id: string; projectId: string; title: string; archivedAt: string; hiddenCount: number }[];
};

export type TrashList = {
  days: number;
  entries: { id: string; kind: string; title: string; projectId: string | null; deletedAt: string; taskCount: number }[];
};

export type Settings = { velocity: number; theme: 'system' | 'light' | 'dark' };

export const api = {
  me: () => request<{ account: Account | null }>('/api/me'),

  login: (email: string, password: string, keepSignedIn: boolean) =>
    post<{ account: Account }>('/api/login', { email, password, keepSignedIn }),

  logout: () => post<{ ok: true }>('/api/logout'),

  status: () => request<{ database: string; boots: number; firstBootAt: string }>('/api/status'),

  bootstrap: () => request<Bootstrap>('/api/bootstrap'),

  create: <T>(kind: Kind, input: Record<string, unknown>) => post<T>(`/api/kind/${kind}`, input),

  patch: <T>(kind: Kind, id: string, version: number, changes: Record<string, unknown>) =>
    request<T>(`/api/kind/${kind}/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, changes }),
    }),

  remove: (kind: Kind, id: string) =>
    request<{ trashId: string }>(`/api/kind/${kind}/${id}`, { method: 'DELETE' }),

  archive: <T>(kind: 'task' | 'milestone', id: string) => post<T>(`/api/kind/${kind}/${id}/archive`),

  restore: <T>(kind: 'task' | 'milestone', id: string) => post<T>(`/api/kind/${kind}/${id}/restore`),

  move: <T>(id: string, version: number, target: Record<string, unknown>) =>
    post<T>('/api/move', { id, version, ...target }),

  archivePage: (params: { q?: string; projectId?: string }) => {
    const q = new URLSearchParams();
    if (params.q) q.set('q', params.q);
    if (params.projectId) q.set('projectId', params.projectId);
    return request<ArchivePage>(`/api/archive?${q}`);
  },

  trash: () => request<TrashList>('/api/trash'),

  restoreTrash: (id: string) => post<{ restored: number }>(`/api/trash/${id}/restore`),

  purgeTrash: (id: string) => request<{ ok: true }>(`/api/trash/${id}`, { method: 'DELETE' }),

  settings: () => request<Settings>('/api/settings'),

  putSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
};
