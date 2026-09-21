import type { BulkAction, BulkItem, Kind, Step, Stub, Undoable } from '@shared/api.js';
import { CLIENT_HEADER } from '@shared/events.js';
import type { Data, Milestone, Task } from '@shared/model.js';

/**
 * Jeder Tab bekommt eine eigene Kennung und schickt sie bei jeder Anfrage mit.
 * Der Änderungs-Strom trägt sie zurück, sodass ein Tab seinen eigenen Hall
 * erkennt und übergeht.
 */
export const CLIENT_ID = Math.random().toString(36).slice(2, 10);

export type Account = { email: string; name: string; avatar: string };

export type Scene = { elements: unknown[]; files?: Record<string, unknown> };

export type DrawingMeta = {
  id: string;
  version: number;
  taskId: string;
  name: string;
  order: number;
  updatedAt: string;
};

export type Drawing = DrawingMeta & { scene: Scene };

export type Bootstrap = Data & {
  stubs: Stub[];
  archiveCounts: Record<string, number>;
  /** Nur die Namen – die Szenen holt der Editor einzeln. */
  drawings: DrawingMeta[];
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
    headers: {
      'content-type': 'application/json',
      [CLIENT_HEADER]: CLIENT_ID,
      ...init?.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as
    | { error?: string; current?: unknown }
    | null;
  if (!res.ok) throw new ApiError(body?.error ?? `HTTP ${res.status}`, res.status, body?.current);
  return body as T;
}

const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export type ArchiveEntry = {
  kind: 'task' | 'milestone';
  id: string;
  projectId: string;
  title: string;
  archivedAt: string;
  parentTitle: string | null;
  milestoneTitle: string | null;
};

/** Eine Seite des Archivs samt Unterbaum – für Aufklappen und Inspektor. */
export type ArchivePage = {
  total: number;
  entries: ArchiveEntry[];
  tasks: Task[];
  milestones: Milestone[];
};

export type TrashEntry = {
  id: string;
  kind: string;
  title: string;
  projectId: string | null;
  deletedAt: string;
  taskCount: number;
  where: string;
  drawingCount: number;
  milestoneCount: number;
  color: string | null;
};

export type TrashList = { days: number; entries: TrashEntry[] };

export type { Settings } from '@shared/model.js';
import type { Settings } from '@shared/model.js';

export const api = {
  me: () => request<{ account: Account | null }>('/api/me'),

  login: (email: string, password: string, keepSignedIn: boolean) =>
    post<{ account: Account }>('/api/login', { email, password, keepSignedIn }),

  logout: () => post<{ ok: true }>('/api/logout'),

  updateAccount: (patch: { name?: string; avatar?: string }) =>
    request<{ account: Account }>('/api/account', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  changePassword: (current: string, next: string) =>
    post<{ ok: true }>('/api/password', { current, next }),

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

  restore: <T>(kind: 'task' | 'milestone', id: string) =>
    post<T & { moved?: true }>(`/api/kind/${kind}/${id}/restore`),

  move: <T>(id: string, version: number, target: Record<string, unknown>) =>
    post<T>('/api/move', { id, version, ...target }),

  duplicate: (id: string) => post<{ id: string }>('/api/duplicate', { id }),

  bulk: (items: BulkItem[], action: BulkAction) => post<Undoable>('/api/bulk', { items, action }),

  steps: (steps: Step[]) => post<Undoable>('/api/steps', { steps }),

  archivePage: (params: { q?: string; projectId?: string; offset?: number }) => {
    const q = new URLSearchParams();
    if (params.offset) q.set('offset', String(params.offset));
    if (params.q) q.set('q', params.q);
    if (params.projectId) q.set('projectId', params.projectId);
    return request<ArchivePage>(`/api/archive?${q}`);
  },

  trash: () => request<TrashList>('/api/trash'),

  restoreTrash: (id: string) =>
    post<{ restored: number; kind: string; id: string; label: string }>(`/api/trash/${id}/restore`),

  purgeTrash: (id: string) => request<Undoable>(`/api/trash/${id}`, { method: 'DELETE' }),

  /** „Papierkorb leeren“ – nur was die Ansicht gerade zeigt. */
  emptyTrash: (ids: string[]) => post<Undoable>('/api/trash/purge', { ids }),

  drawings: (taskId: string) =>
    request<{ drawings: Drawing[] }>(`/api/drawings?taskId=${encodeURIComponent(taskId)}`),

  addDrawing: (taskId: string, name?: string) =>
    post<Drawing>('/api/drawings', { taskId, ...(name ? { name } : {}) }),

  saveDrawing: (id: string, version: number, changes: { name?: string; scene?: Scene }) =>
    request<Drawing>(`/api/drawings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, changes }),
    }),

  deleteDrawing: (id: string) => request<Undoable>(`/api/drawings/${id}`, { method: 'DELETE' }),

  settings: () => request<Settings>('/api/settings'),

  putSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
};
