import type {
  BulkAction,
  BulkItem,
  CodecksRefsResult,
  CodecksSummary,
  Kind,
  Step,
  Stub,
  Undoable,
} from '@shared/api.js';
import type { LogEntry } from '@shared/burnup.js';
import { CLIENT_HEADER } from '@shared/events.js';
import type { Data, Milestone, Task } from '@shared/model.js';
import type { RefStub } from '@shared/refs.js';

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
  /** Genau eins von beiden ist gesetzt. */
  taskId: string | null;
  milestoneId: string | null;
  name: string;
  order: number;
  updatedAt: string;
};

export type Drawing = DrawingMeta & { scene: Scene };

/** Wem eine Zeichnung gehört – einer Aufgabe oder einem Milestone. */
export type DrawingOwner = { kind: 'task' | 'milestone'; id: string };

const OWNER_KEY = { task: 'taskId', milestone: 'milestoneId' } as const;

/** Die Zeichnungen eines Besitzers aus den Namen im Startpaket. */
export const drawingsOf = (metas: DrawingMeta[] | undefined, ownerId: string): DrawingMeta[] =>
  (metas ?? []).filter((d) => (d.taskId ?? d.milestoneId) === ownerId);

export type Bootstrap = Data & {
  stubs: Stub[];
  refStubs: RefStub[];
  archiveCounts: Record<string, number>;
  /** Nur die Namen – die Szenen holt der Editor einzeln. */
  drawings: DrawingMeta[];
  /** Burnup-Protokoll je aktivem Milestone; den heutigen Stand rechnet der Client selbst. */
  milestoneLog: Record<string, LogEntry[]>;
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
  // Bei FormData setzt der Browser den Inhaltstyp selbst – samt Grenze zwischen
  // den Teilen. Schreibt man ihn hier hin, fehlt sie und der Server versteht nichts.
  const form = init?.body instanceof FormData;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(form ? {} : { 'content-type': 'application/json' }),
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
  /** Nur bei einem Bild: darüber holt die Ansicht die Vorschau. */
  imageId: string | null;
};

export type TrashList = { days: number; entries: TrashEntry[] };

/** Das Ergebnis eines endgültigen Löschens; `images` fällt nicht unter „Rückgängig“. */
export type Purged = Undoable & { images: number };

export type ImageMeta = {
  id: string;
  projectId: string | null;
  /** Der Ordner der Galerie; `null` heißt: ganz oben. */
  folderId: string | null;
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
  deletedAt: string | null;
};

/** Wo ein Bild steckt, getrennt nach dem Zustand des Umgebenden. */
export type ImageUse = { kind: 'task' | 'milestone'; id: string; title: string };
export type ImageUsage = { live: ImageUse[]; archived: ImageUse[]; trashed: ImageUse[] };

/** Ein Bild in der Galerie: Angaben plus Verwendungen, nie die Bytes. */
export type ImageEntry = ImageMeta & { usage: ImageUsage | null };

/** Ein Ordner der Galerie – sie liegen ineinander und gehören einem Projekt. */
export type ImageFolder = {
  id: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  createdAt: string;
};

/** Was hochgeladen wird – im Browser bereits verkleinert und als WebP. */
export type ImageUpload = {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  name: string;
  projectId: string | null;
  /** Der Ordner, in dem die Galerie gerade steht. */
  folderId?: string | null;
};

/** Die Adresse eines Bildes. Der Hash im Pfad macht sie für immer gültig. */
export const imageUrl = (id: string, size: 'gross' | 'klein' = 'gross'): string =>
  `/api/bilder/${id}${size === 'klein' ? '?v=klein' : ''}`;

/** So steht ein Bild in einer Beschreibung – gewöhnliches Markdown. */
export const imageMarkdown = (m: { id: string; name: string }): string =>
  `![${m.name.replace(/[[\]]/g, '')}](${imageUrl(m.id)})`;

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

  /** „In Milestone umwandeln“ – gibt den neuen Milestone und die Rücknahme zurück. */
  convert: (id: string, version: number) =>
    post<{ id: string; count: number; undo: Step[] }>('/api/convert', { id, version }),

  bulk: (items: BulkItem[], action: BulkAction) => post<Undoable>('/api/bulk', { items, action }),

  steps: (steps: Step[]) => post<Undoable>('/api/steps', { steps }),

  importCodecks: (csv: string, dryRun: boolean) =>
    post<CodecksSummary>('/api/import/codecks', { csv, dryRun }),

  convertCodecksRefs: (csvs: string[], dryRun: boolean) =>
    post<CodecksRefsResult>('/api/import/codecks-refs', { csvs, dryRun }),

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

  /** `images` zählt, wie viele Bilder dabei endgültig fielen – die kommen nicht zurück. */
  purgeTrash: (id: string) => request<Purged>(`/api/trash/${id}`, { method: 'DELETE' }),

  /** „Papierkorb leeren“ – nur was die Ansicht gerade zeigt. */
  emptyTrash: (ids: string[]) => post<Purged>('/api/trash/purge', { ids }),

  drawings: (owner: DrawingOwner) =>
    request<{ drawings: Drawing[] }>(`/api/drawings?${OWNER_KEY[owner.kind]}=${encodeURIComponent(owner.id)}`),

  addDrawing: (owner: DrawingOwner, name?: string) =>
    post<Drawing>('/api/drawings', { [OWNER_KEY[owner.kind]]: owner.id, ...(name ? { name } : {}) }),

  saveDrawing: (id: string, version: number, changes: { name?: string; scene?: Scene }) =>
    request<Drawing>(`/api/drawings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ version, changes }),
    }),

  deleteDrawing: (id: string) => request<Undoable>(`/api/drawings/${id}`, { method: 'DELETE' }),

  images: () => request<{ images: ImageEntry[]; folders: ImageFolder[] }>('/api/bilder'),

  /**
   * Das Bild ist beim Hochladen schon fertig – verkleinert und als WebP. Hier
   * geht deshalb `FormData` raus und kein JSON; den Inhaltstyp setzt der
   * Browser selbst, samt Grenze zwischen den Teilen.
   */
  addImage: (p: ImageUpload) => {
    const form = new FormData();
    form.append('bild', p.blob, p.name);
    form.append('vorschau', p.thumb, 'vorschau.webp');
    form.append('name', p.name);
    form.append('breite', String(p.width));
    form.append('hoehe', String(p.height));
    if (p.projectId) form.append('projekt', p.projectId);
    if (p.folderId) form.append('ordner', p.folderId);
    return request<ImageMeta>('/api/bilder', { method: 'POST', body: form });
  },

  /** Löschen heißt Papierkorb – der Platz wird erst beim Leeren frei. */
  trashImage: (id: string) => post<ImageMeta>(`/api/bilder/${id}/loeschen`),

  restoreImage: (id: string) => post<ImageMeta>(`/api/bilder/${id}/zurueck`),

  /* --------------------------------------------- Ordner der Galerie */

  addFolder: (p: { projectId: string | null; parentId: string | null; name: string }) =>
    post<ImageFolder>('/api/bildordner', p),

  patchFolder: (id: string, changes: { name?: string; parentId?: string | null }) =>
    request<ImageFolder>(`/api/bildordner/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  /** Der Inhalt geht dabei nicht verloren, er rückt eine Ebene höher. */
  deleteFolder: (id: string) => request<{ ok: true }>(`/api/bildordner/${id}`, { method: 'DELETE' }),

  sortIntoFolder: (ids: string[], folderId: string | null) =>
    post<{ moved: number }>('/api/bildordner/einsortieren', { ids, folderId }),

  settings: () => request<Settings>('/api/settings'),

  putSettings: (patch: Partial<Settings>) =>
    request<Settings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
};
