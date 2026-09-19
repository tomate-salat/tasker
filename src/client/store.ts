import { create } from 'zustand';
import type { Kind } from '@shared/api.js';
import type { Milestone, Task } from '@shared/model.js';
import { Workspace } from '@shared/workspace.js';
import { ApiError, api, type Bootstrap } from './api.js';

/**
 * Der gesamte aktive Datenbestand liegt im Speicher – wie `S` im Prototyp.
 * Nach jeder Änderung wird der Index neu gebaut; das ist billiger als ihn
 * fortzuschreiben und kann nicht auseinanderlaufen.
 *
 * Geschrieben wird vorerst ohne Vorgriff: erst die Antwort des Servers, dann
 * der neue Zustand. Optimistische Änderungen kommen zusammen mit dem
 * Änderungs-Push in Schritt 9.
 */
type State = {
  boot: Bootstrap | null;
  ws: Workspace | null;
  loading: boolean;
  error: string | null;
  /** Kurze Rückmeldung am unteren Rand. */
  toast: string | null;

  projectId: string | null;
  selected: string | null;
  /** Zugeklappte Zeilen – bleibt pro Gerät, nicht auf dem Server. */
  collapsed: Record<string, boolean>;

  load: () => Promise<void>;
  setProject: (id: string) => void;
  select: (id: string | null) => void;
  toggle: (id: string) => void;
  say: (message: string | null) => void;

  patch: (kind: Kind, id: string, changes: Record<string, unknown>) => Promise<void>;
  addTask: (input: Record<string, unknown>) => Promise<void>;
  archive: (kind: 'task' | 'milestone', id: string) => Promise<void>;
};

const COLLAPSED_KEY = 'tasker.collapsed';
const PROJECT_KEY = 'tasker.project';

const readLocal = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const writeLocal = (key: string, value: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Privates Fenster oder gesperrter Speicher – nicht weiter schlimm.
  }
};

export const useStore = create<State>((set, get) => ({
  boot: null,
  ws: null,
  loading: true,
  error: null,
  toast: null,
  projectId: readLocal<string | null>(PROJECT_KEY, null),
  selected: null,
  collapsed: readLocal<Record<string, boolean>>(COLLAPSED_KEY, {}),

  load: async () => {
    set({ loading: true, error: null });
    try {
      const boot = await api.bootstrap();
      const projectId =
        get().projectId && boot.projects.some((p) => p.id === get().projectId)
          ? get().projectId
          : (boot.projects[0]?.id ?? null);
      set({ boot, ws: new Workspace(boot), projectId, loading: false });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Laden fehlgeschlagen', loading: false });
    }
  },

  setProject: (id) => {
    writeLocal(PROJECT_KEY, id);
    set({ projectId: id, selected: null });
  },

  // Den Inspektor zu schließen hebt auch die Auswahl auf (so wie im Prototyp).
  select: (id) => set({ selected: id }),

  toggle: (id) => {
    const collapsed = { ...get().collapsed, [id]: !get().collapsed[id] };
    writeLocal(COLLAPSED_KEY, collapsed);
    set({ collapsed });
  },

  say: (toast) => set({ toast }),

  patch: async (kind, id, changes) => {
    const boot = get().boot;
    if (!boot) return;
    const current = find(boot, kind, id);
    if (!current) return;

    try {
      const updated = await api.patch<Task | Milestone>(kind, id, current.version, changes);
      set(replace(boot, kind, updated));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.current) {
        // Woanders geändert: den neuen Stand übernehmen und sagen, was los war.
        set(replace(boot, kind, e.current as Task | Milestone));
        set({ toast: 'Inzwischen woanders geändert – neuer Stand übernommen.' });
        return;
      }
      set({ toast: e instanceof Error ? e.message : 'Änderung fehlgeschlagen' });
    }
  },

  addTask: async (input) => {
    try {
      await api.create<Task>('task', input);
      await get().load();
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Anlegen fehlgeschlagen' });
    }
  },

  archive: async (kind, id) => {
    try {
      await api.archive(kind, id);
      if (get().selected === id) set({ selected: null });
      await get().load();
      set({ toast: 'Archiviert' });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Archivieren fehlgeschlagen' });
    }
  },
}));

/* ------------------------------------------------------------------ Intern */

type Entity = { id: string; version: number };

const listOf = (boot: Bootstrap, kind: Kind): Entity[] =>
  kind === 'task'
    ? boot.tasks
    : kind === 'milestone'
      ? boot.milestones
      : kind === 'project'
        ? boot.projects
        : kind === 'group'
          ? boot.groups
          : kind === 'category'
            ? boot.categories
            : boot.marks;

const find = (boot: Bootstrap, kind: Kind, id: string): Entity | undefined =>
  listOf(boot, kind).find((x) => x.id === id);

/** Ersetzt ein Objekt und baut den Index neu. */
function replace(boot: Bootstrap, kind: Kind, updated: Entity): { boot: Bootstrap; ws: Workspace } {
  const key = (
    {
      task: 'tasks',
      milestone: 'milestones',
      project: 'projects',
      group: 'groups',
      category: 'categories',
      mark: 'marks',
    } as const
  )[kind];

  const next: Bootstrap = {
    ...boot,
    [key]: (boot[key] as Entity[]).map((x) => (x.id === updated.id ? updated : x)),
  };
  return { boot: next, ws: new Workspace(next) };
}
