import { create } from 'zustand';
import type { BulkAction, Kind, Step } from '@shared/api.js';
import type { ChangeEvent } from '@shared/events.js';
import type { Milestone, Task } from '@shared/model.js';
import { doneCandidates, placeLabel, type OutlineFilter } from '@shared/outline.js';
import { Workspace } from '@shared/workspace.js';
import {
  ApiError,
  api,
  type ArchivePage,
  type Bootstrap,
  type Settings,
  type TrashList,
} from './api.js';

export const VIEWS = ['plan', 'backlog', 'docs', 'timeline', 'archive', 'trash'] as const;
export type View = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<View, string> = {
  plan: 'Plan',
  backlog: 'Backlog',
  docs: 'Doku',
  timeline: 'Zeitplan',
  archive: 'Archiv',
  trash: 'Papierkorb',
};

/** Die Reiter im Kopf. Der Papierkorb hängt wie im Prototyp unten in der Seitenleiste. */
export const TABS: View[] = ['plan', 'backlog', 'docs', 'timeline', 'archive'];

export type Dialog = 'none' | 'categories' | 'marks' | 'profile' | 'help';

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

  /** Welcher Dialog offen ist – immer höchstens einer. Menüs öffnen ihn von überall. */
  dialog: Dialog;
  setDialog: (dialog: Dialog) => void;

  /** `'all'` für „Alle Projekte“, sonst eine Projekt-ID. */
  scope: string;
  /** Zuletzt gewähltes echtes Projekt – dorthin wird angelegt, wenn „alle“ gilt. */
  lastProject: string | null;
  /** Filter aus der Seitenleiste: Label, Kategorie, Markierung. */
  filter: OutlineFilter;
  /** Seitenleiste eingeklappt – pro Gerät. */
  sideCollapsed: boolean;
  /** Auf schmalen Bildschirmen liegt die Seitenleiste als Overlay über allem. */
  sideOpen: boolean;
  view: View;
  selected: string | null;
  /** Zeile, deren Titel gerade im Baum bearbeitet wird. */
  editing: string | null;
  /** Zugeklappte Zeilen – bleibt pro Gerät, nicht auf dem Server. */
  collapsed: Record<string, boolean>;
  settings: Settings;

  /** Archiv und Papierkorb werden erst beim Öffnen geholt. */
  archive: ArchivePage | null;
  archiveQuery: string;
  trash: TrashList['entries'] | null;
  trashDays: number;

  load: () => Promise<void>;
  setScope: (scope: string) => void;
  setFilter: (patch: OutlineFilter) => void;
  toggleSide: () => void;
  cycleTheme: () => Promise<void>;
  setTheme: (theme: Settings['theme']) => Promise<void>;
  setView: (view: View) => void;
  select: (id: string | null) => void;
  /**
   * Titel in der Zeile bearbeiten. `isNew` heißt: gerade angelegt – bleibt der
   * Titel leer oder wird abgebrochen, verschwindet die Zeile wieder (Prototyp).
   */
  edit: (id: string | null, isNew?: boolean) => void;
  editingNew: boolean;
  /** Eine eben angelegte, leer gebliebene Zeile spurlos entfernen. */
  discard: (kind: Kind, id: string) => Promise<void>;

  /**
   * Mehrfachauswahl. Nur Aufgaben, wie im Prototyp – Milestones und Gruppen
   * bleiben draußen, weil die Stapel-Aktionen für sie nichts bedeuten.
   */
  multi: Set<string>;
  /** Die sichtbare Zeilenfolge; die Liste meldet sie, Auswahl und Tastatur lesen sie. */
  visible: string[];
  /** Ankerzeile für die Bereichsauswahl mit der Umschalttaste. */
  anchor: string | null;
  setVisible: (ids: string[]) => void;
  toggleMulti: (id: string) => void;
  rangeMulti: (id: string) => void;
  extendMulti: (delta: 1 | -1) => void;
  selectAllVisible: () => void;
  clearMulti: () => void;
  /** Eine Handlung auf der ganzen Auswahl – ein Aufruf, eine Transaktion. */
  bulk: (action: BulkAction, message: (count: number) => string) => Promise<void>;

  /**
   * Der Rücknahme-Stapel. Er lebt im Tab, nicht auf dem Server: jede
   * schreibende Handlung legt hier die Gegen-Schritte ab, die sie zurücknehmen
   * würden. Beim Zurücknehmen prüft der Server die `version` mit – eine
   * Rücknahme auf einem überholten Stand wird abgelehnt statt blind ausgeführt.
   */
  undoStack: { label: string; steps: Step[] }[];
  /** Zeigt die Kurzmeldung gerade ein „Rückgängig“ an? */
  toastUndo: boolean;
  undo: () => Promise<void>;
  /** Mehrere Schritte in einer Transaktion, mit Meldung und Rücknahme. */
  runSteps: (steps: Step[], message: (count: number) => string) => Promise<void>;
  /** Archiviert alles Erledigte der aktuellen Ansicht – Milestones und Aufgaben. */
  archiveDone: () => Promise<void>;
  toggle: (id: string) => void;
  setCollapsed: (id: string, value: boolean) => void;
  say: (message: string | null) => void;
  setVelocity: (velocity: number) => Promise<void>;

  patch: (kind: Kind, id: string, changes: Record<string, unknown>) => Promise<void>;
  /** Legt eine Aufgabe an und gibt ihre ID zurück – für „danach gleich umbenennen“. */
  addTask: (input: Record<string, unknown>) => Promise<string | null>;
  addProject: (name: string) => Promise<void>;
  /** Projekt, dessen Name gerade in der Seitenleiste bearbeitet wird. */
  editProject: string | null;
  setEditProject: (id: string | null) => void;
  renameProject: (id: string, name: string) => Promise<void>;
  /** Wie im Prototyp: das letzte Projekt bleibt. */
  trashProject: (id: string) => Promise<void>;
  /** Für welches Projekt der Kategorien-Dialog gilt; ohne Angabe das aktuelle. */
  catProject: string | null;
  openCategories: (projectId?: string) => void;
  /** Ohne Angabe ein eingeplanter Milestone im aktuellen Projekt. Gibt die ID zurück. */
  addMilestone: (
    title: string,
    o?: { planned?: boolean; projectId?: string },
  ) => Promise<string | null>;
  /** Gibt die ID zurück – „Neue Gruppe“ im Menü benennt sie gleich um. */
  addGroup: (title: string, projectId?: string) => Promise<string | null>;
  /** Kopiert eine Aufgabe samt Unterbaum und wählt die Kopie aus. */
  duplicateTask: (id: string) => Promise<void>;
  moveTask: (id: string, target: Record<string, unknown>) => Promise<void>;
  archiveItem: (kind: 'task' | 'milestone', id: string) => Promise<void>;
  /** `message` ersetzt die übliche Meldung – etwa „In den Papierkorb verschoben“ im Archiv. */
  remove: (kind: Kind, id: string, message?: string) => Promise<void>;
  /** Nimmt auch die Einbettung aus der Beschreibung, mit „Rückgängig“. */
  removeDrawing: (id: string, name: string) => Promise<void>;

  /** Eine Änderung aus einem anderen Tab oder Gerät einspielen. */
  applyEvent: (event: ChangeEvent) => void;
  /** Steht die Verbindung zum Änderungs-Strom? */
  live: boolean;
  setLive: (live: boolean) => void;

  /** `more`: die nächste Seite anhängen statt neu zu laden. */
  loadArchive: (more?: boolean) => Promise<void>;
  /** Für welche Auswahl und Suche die geladene Archivseite gilt. */
  archiveFor: string;
  setArchiveQuery: (q: string) => void;
  /** Aufgeklappte Einträge im Archiv – pro Gerät, wie `archOpen` im Prototyp. */
  archOpen: Record<string, boolean>;
  setArchOpen: (id: string, open: boolean) => void;
  unarchive: (kind: 'task' | 'milestone', id: string) => Promise<void>;
  loadTrash: () => Promise<void>;
  restoreTrash: (id: string) => Promise<void>;
  purgeTrash: (id: string) => Promise<void>;
  /** „Papierkorb leeren“ fragt erst nach – in der Kopfzeile, wie im Prototyp. */
  trashConfirm: boolean;
  setTrashConfirm: (value: boolean) => void;
  emptyTrash: (ids: string[]) => Promise<void>;
};

const COLLAPSED_KEY = 'tasker.collapsed';
const SCOPE_KEY = 'tasker.scope';
const SIDE_KEY = 'tasker.side';
const ARCH_OPEN_KEY = 'tasker.archOpen';

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
  dialog: 'none',
  setDialog: (dialog) => set({ dialog }),
  scope: readLocal<string>(SCOPE_KEY, 'all'),
  lastProject: null,
  filter: { tag: null, categoryId: null, markId: null },
  sideCollapsed: readLocal<boolean>(SIDE_KEY, false),
  sideOpen: false,
  view: 'plan',
  selected: null,
  editing: null,
  collapsed: readLocal<Record<string, boolean>>(COLLAPSED_KEY, {}),
  settings: { velocity: 8, theme: 'system' },
  archive: null,
  archiveQuery: '',
  trash: null,
  trashDays: 30,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const [boot, settings] = await Promise.all([api.bootstrap(), api.settings()]);
      const known = (id: string): boolean => boot.projects.some((p) => p.id === id);
      const scope = get().scope === 'all' || known(get().scope) ? get().scope : 'all';
      const lastProject =
        scope !== 'all' ? scope : (get().lastProject ?? boot.projects[0]?.id ?? null);

      applyTheme(settings.theme);
      const ws = new Workspace(boot);
      // Was inzwischen weg ist – archiviert, gelöscht, woanders hin – fällt aus der Auswahl.
      const multi = new Set([...get().multi].filter((id) => ws.task(id)));
      set({ boot, ws, settings, scope, lastProject, loading: false, multi });
      /**
       * Archiv und Papierkorb ziehen mit: offen neu geholt, sonst verworfen und
       * beim nächsten Öffnen geladen. So zeigt keine Ansicht einen alten Stand.
       */
      await Promise.all([
        get().view === 'archive' ? get().loadArchive() : set({ archive: null }),
        get().view === 'trash' || get().trash ? get().loadTrash() : null,
      ]);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Laden fehlgeschlagen', loading: false });
    }
  },

  setScope: (scope) => {
    writeLocal(SCOPE_KEY, scope);
    set({
      scope,
      ...(scope === 'all' ? {} : { lastProject: scope }),
      selected: null,
      editing: null,
      // Die Kategorie gehört zum Projekt und passt nach dem Wechsel nicht mehr.
      filter: { ...get().filter, categoryId: null },
      archive: null,
      sideOpen: false,
    });
  },

  setFilter: (patch) => set({ filter: { ...get().filter, ...patch }, sideOpen: false }),

  // Wie im Prototyp: mobil öffnet und schließt das Overlay, am Desktop wird
  // dauerhaft ein- oder ausgeklappt.
  toggleSide: () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      set({ sideOpen: !get().sideOpen });
      return;
    }
    const sideCollapsed = !get().sideCollapsed;
    writeLocal(SIDE_KEY, sideCollapsed);
    set({ sideCollapsed });
  },

  cycleTheme: async () => {
    const order: Settings['theme'][] = ['system', 'light', 'dark'];
    const theme = order[
      (order.indexOf(get().settings.theme) + 1) % order.length
    ] as Settings['theme'];
    await get().setTheme(theme);
  },

  setTheme: async (theme) => {
    // Erst umschalten, dann sichern: die Darstellung soll nicht auf das Netz warten.
    applyTheme(theme);
    set({ settings: { ...get().settings, theme } });
    try {
      set({ settings: await api.putSettings({ theme }) });
    } catch {
      // Beim nächsten Laden zählt wieder, was auf dem Server steht.
    }
  },

  setView: (view) => set({ view, selected: null, editing: null, sideOpen: false }),

  setVelocity: async (velocity) => {
    try {
      set({ settings: await api.putSettings({ velocity }) });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Tempo konnte nicht gesetzt werden' });
    }
  },

  // Den Inspektor zu schließen hebt auch die Auswahl auf (so wie im Prototyp).
  select: (id) => set({ selected: id, editing: null }),

  editingNew: false,
  edit: (editing, isNew = false) =>
    set({ editing, editingNew: !!editing && isNew, ...(editing ? { selected: editing } : {}) }),

  discard: async (kind, id) => {
    const parent = get().boot?.tasks.find((t) => t.id === id)?.parentId ?? null;
    try {
      // Papierkorb und gleich wieder hinaus: so bleibt keine Spur und kein Rückgängig.
      const { trashId } = await api.remove(kind, id);
      await api.purgeTrash(trashId);
      if (get().selected === id) set({ selected: parent });
      await get().load();
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Entfernen fehlgeschlagen' });
    }
  },

  /* ------------------------------------------------------ Mehrfachauswahl */

  multi: new Set<string>(),
  visible: [],
  anchor: null,

  setVisible: (ids) => {
    const cur = get().visible;
    if (cur.length === ids.length && cur.every((id, i) => id === ids[i])) return;
    set({ visible: ids });
  },

  /**
   * Strg-Klick. Ist noch nichts ausgewählt, kommt die gerade markierte Zeile
   * mit dazu – sonst verlöre man sie beim ersten Strg-Klick aus dem Blick.
   */
  toggleMulti: (id) => {
    const { multi, selected, ws } = get();
    if (!ws?.task(id)) return;
    const next = new Set(multi);
    if (!next.size && selected && selected !== id && ws.task(selected)) next.add(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ multi: next, anchor: id });
  },

  /** Umschalt-Klick: alles zwischen Anker und angeklickter Zeile. */
  rangeMulti: (id) => {
    const { multi, visible, anchor, selected, ws } = get();
    if (!ws) return;
    const from = visible.indexOf(anchor ?? selected ?? '');
    const to = visible.indexOf(id);
    if (from < 0 || to < 0) {
      get().toggleMulti(id);
      return;
    }
    const next = new Set(multi);
    if (!next.size && selected && ws.task(selected)) next.add(selected);
    for (const rid of visible.slice(Math.min(from, to), Math.max(from, to) + 1)) {
      if (ws.task(rid)) next.add(rid);
    }
    set({ multi: next });
  },

  /** Umschalt plus Pfeiltaste: die Auswahl wächst um die nächste Zeile. */
  extendMulti: (delta) => {
    const { multi, visible, anchor, selected, ws } = get();
    if (!ws) return;
    const at = visible.indexOf(anchor && multi.size ? anchor : (selected ?? ''));
    const next = visible[Math.max(0, Math.min(visible.length - 1, at + delta))];
    if (!next || !ws.task(next)) return;
    const set_ = new Set(multi);
    if (!set_.size && selected && ws.task(selected)) set_.add(selected);
    set_.add(next);
    set({ multi: set_, anchor: next });
    document.querySelector(`[data-row="${next}"]`)?.scrollIntoView({ block: 'nearest' });
  },

  selectAllVisible: () => {
    const { visible, ws } = get();
    if (!ws) return;
    const multi = new Set(visible.filter((id) => ws.task(id)));
    set({ multi, toast: `${multi.size} Aufgaben ausgewählt` });
  },

  clearMulti: () => {
    if (!get().multi.size) return;
    set({ multi: new Set(), anchor: null });
  },

  bulk: async (action, message) => {
    const { ws, multi, visible } = get();
    if (!ws || !multi.size) return;
    const order = (id: string): number => {
      const i = visible.indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    const items = [...multi]
      .sort((a, b) => order(a) - order(b))
      .map((id) => ws.task(id))
      .filter((t): t is Task => !!t)
      .map((t) => ({ id: t.id, version: t.version }));
    if (!items.length) return;

    try {
      const { count, undo } = await api.bulk(items, action);
      await get().load();
      // Archivieren und Löschen nehmen die Zeilen weg – danach ist nichts mehr ausgewählt.
      const gone = action.type === 'archive' || action.type === 'trash';
      remember(message(count), undo);
      set({
        ...(gone ? { multi: new Set<string>(), anchor: null, selected: null } : {}),
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        await get().load();
        set({ toast: 'Inzwischen woanders geändert – nichts geändert, bitte nochmal.' });
        return;
      }
      set({ toast: e instanceof Error ? e.message : 'Stapel-Änderung fehlgeschlagen' });
    }
  },

  /* ------------------------------------------------------------ Rücknahme */

  undoStack: [],
  toastUndo: false,

  undo: async () => {
    const stack = get().undoStack;
    const entry = stack[stack.length - 1];
    if (!entry) {
      set({ toast: 'Nichts zum Rückgängigmachen', toastUndo: false });
      return;
    }
    set({ undoStack: stack.slice(0, -1) });

    try {
      await api.steps(entry.steps);
      await get().load();
      set({ toast: 'Rückgängig gemacht', toastUndo: false });
    } catch (e) {
      await get().load();
      const stale = e instanceof ApiError && e.status === 409;
      set({
        toast: stale
          ? 'Inzwischen woanders geändert – Rückgängig nicht mehr möglich.'
          : e instanceof Error
            ? e.message
            : 'Rückgängig fehlgeschlagen',
        toastUndo: false,
      });
    }
  },

  runSteps: async (steps, message) => {
    if (!steps.length) return;
    try {
      const { count, undo } = await api.steps(steps);
      await get().load();
      remember(message(count), undo);
    } catch (e) {
      const stale = e instanceof ApiError && e.status === 409;
      if (stale) await get().load();
      set({
        toast: stale
          ? 'Inzwischen woanders geändert – nichts geändert, bitte nochmal.'
          : e instanceof Error
            ? e.message
            : 'Änderung fehlgeschlagen',
        toastUndo: false,
      });
    }
  },

  archiveDone: async () => {
    const state = get();
    const { ws, view } = state;
    if (!ws || (view !== 'plan' && view !== 'backlog')) return;

    const found = doneCandidates(ws, { view, projectIds: scopeProjectIds(state) });
    const steps: Step[] = [
      ...found.milestones.map((m) => ({ op: 'archive' as const, kind: 'milestone' as const, id: m.id })),
      ...found.tasks.map((t) => ({ op: 'archive' as const, kind: 'task' as const, id: t.id })),
    ];
    if (!steps.length) {
      set({ toast: 'Nichts Erledigtes zum Archivieren', toastUndo: false });
      return;
    }
    await get().runSteps(steps, (n) => `${n} ${n === 1 ? 'Eintrag' : 'Einträge'} archiviert`);
  },

  toggle: (id) => get().setCollapsed(id, !get().collapsed[id]),

  setCollapsed: (id, value) => {
    const collapsed = { ...get().collapsed, [id]: value };
    writeLocal(COLLAPSED_KEY, collapsed);
    set({ collapsed });
  },

  say: (toast) => set({ toast, toastUndo: false }),

  /**
   * Ändern mit Vorgriff: die Zeile ändert sich sofort, die Antwort des Servers
   * ersetzt sie gleich darauf. Geht etwas schief, gilt wieder der alte Stand –
   * so bleibt Tippen flüssig, ohne dass etwas Erfundenes stehen bleibt.
   */
  patch: async (kind, id, changes) => {
    const boot = get().boot;
    if (!boot) return;
    const current = find(boot, kind, id);
    if (!current) {
      // Nicht im aktiven Bestand: vielleicht im Archiv, das der Inspektor gerade zeigt.
      await patchArchived(kind, id, changes);
      return;
    }

    set(replace(boot, kind, { ...current, ...changes } as Entity));

    try {
      const updated = await api.patch<Task | Milestone>(kind, id, current.version, changes);
      set(replace(get().boot ?? boot, kind, updated));
      // Die Gegen-Schritte kennt hier der Client selbst: die alten Werte plus
      // die Version, die dabei herauskam.
      pushUndo([
        {
          op: 'patch',
          kind,
          id,
          version: updated.version,
          changes: Object.fromEntries(
            Object.keys(changes).map((k) => [k, (current as Record<string, unknown>)[k]]),
          ),
        },
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.current) {
        // Woanders geändert: den neuen Stand übernehmen und sagen, was los war.
        set(replace(get().boot ?? boot, kind, e.current as Task | Milestone));
        set({ toast: 'Inzwischen woanders geändert – neuer Stand übernommen.' });
        return;
      }
      set(replace(get().boot ?? boot, kind, current));
      set({ toast: e instanceof Error ? e.message : 'Änderung fehlgeschlagen' });
    }
  },

  addTask: async (input) => {
    try {
      const created = await api.create<Task>('task', input);
      await get().load();
      return created.id;
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Anlegen fehlgeschlagen' });
      return null;
    }
  },

  addProject: async (name) => {
    try {
      const p = await api.create<{ id: string }>('project', { name });
      await get().load();
      get().setScope(p.id);
      set({ view: 'backlog', toast: `Projekt „${name}“ angelegt` });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Anlegen fehlgeschlagen' });
    }
  },

  editProject: null,
  setEditProject: (editProject) => set({ editProject }),

  renameProject: async (id, name) => {
    set({ editProject: null });
    const before = get().ws?.project(id)?.name;
    const next = name.trim();
    if (!next || next === before) return;
    await get().patch('project', id, { name: next });
    // Nur melden, wenn es geklappt hat – sonst steht dort schon der Fehler.
    if (get().ws?.project(id)?.name === next) {
      set({ toast: `Projekt heißt jetzt „${next}“`, toastUndo: true });
    }
  },

  trashProject: async (id) => {
    const { ws } = get();
    const p = ws?.project(id);
    if (!ws || !p) return;
    if (ws.projects.length <= 1) {
      set({ toast: 'Das letzte Projekt kann nicht gelöscht werden', toastUndo: false });
      return;
    }
    try {
      const { trashId } = await api.remove('project', id);
      const entry = (await api.trash()).entries.find((e) => e.id === trashId);
      const rest = ws.projects.filter((x) => x.id !== id);
      const fallback = rest[0]?.id ?? 'all';
      if (get().scope === id) get().setScope(fallback);
      if (get().lastProject === id) set({ lastProject: fallback === 'all' ? null : fallback });
      await get().load();
      if (get().selected && !get().ws?.task(get().selected) && !get().ws?.milestone(get().selected)) {
        set({ selected: null });
      }
      const n = entry?.taskCount ?? 0;
      remember(`Projekt „${p.name}“ mit ${n} ${n === 1 ? 'Task' : 'Tasks'} im Papierkorb`, [
        { op: 'untrash', trashId },
      ]);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  catProject: null,
  openCategories: (projectId) => set({ catProject: projectId ?? null, dialog: 'categories' }),

  addMilestone: async (title, o) => {
    const projectId = o?.projectId ?? currentProjectId(get());
    if (!projectId) return null;
    try {
      // Aus der Planansicht heraus ist ein Milestone eingeplant, aus dem Backlog vorbereitet.
      const created = await api.create<{ id: string }>('milestone', {
        projectId,
        title,
        planned: o?.planned ?? true,
      });
      await get().load();
      return created.id;
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Anlegen fehlgeschlagen' });
      return null;
    }
  },

  addGroup: async (title, projectIdArg) => {
    const projectId = projectIdArg ?? currentProjectId(get());
    if (!projectId) return null;
    try {
      const created = await api.create<{ id: string }>('group', { projectId, title });
      await get().load();
      return created.id;
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Anlegen fehlgeschlagen' });
      return null;
    }
  },

  duplicateTask: async (id) => {
    try {
      const copy = await api.duplicate(id);
      await get().load();
      // Anlegen lässt sich nicht zurücknehmen – deshalb nur die Meldung.
      set({ selected: copy.id, toast: 'Dupliziert', toastUndo: false });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Duplizieren fehlgeschlagen' });
    }
  },

  moveTask: async (id, target) => {
    const boot = get().boot;
    const current = boot?.tasks.find((t) => t.id === id);
    if (!current) return;
    try {
      const moved = await api.move<Task>(id, current.version, target);
      await get().load();
      // Zurück an die alte Stelle – der alte Ordnungswert füllt die Lücke wieder.
      pushUndo([
        {
          op: 'move',
          id,
          version: moved.version,
          target: {
            parentId: current.parentId,
            milestoneId: current.milestoneId,
            groupId: current.groupId,
            markId: current.markId,
            projectId: current.projectId,
            doc: current.doc,
            order: current.order,
          },
        },
      ]);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        set({ toast: 'Inzwischen woanders geändert – bitte nochmal.' });
        await get().load();
        return;
      }
      set({ toast: e instanceof Error ? e.message : 'Verschieben fehlgeschlagen' });
    }
  },

  archiveItem: async (kind, id) => {
    try {
      await api.archive(kind, id);
      if (get().selected === id) set({ selected: null });
      await get().load();
      remember('Archiviert', [{ op: 'unarchive', kind, id }]);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Archivieren fehlgeschlagen' });
    }
  },

  remove: async (kind, id, message) => {
    try {
      const { trashId } = await api.remove(kind, id);
      if (get().selected === id) set({ selected: null });
      await get().load();
      remember(message ?? REMOVED[kind] ?? 'In den Papierkorb gelegt', [{ op: 'untrash', trashId }]);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  removeDrawing: async (id, name) => {
    try {
      const { undo } = await api.deleteDrawing(id);
      await get().load();
      remember(`Zeichnung „${name}“ gelöscht`, undo);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  /* ------------------------------------------------------ Änderungs-Strom */

  live: false,
  setLive: (live) => set({ live }),

  applyEvent: (event) => {
    const boot = get().boot;
    if (!boot) return;

    switch (event.type) {
      case 'upsert':
        set(upsert(boot, event.kind, event.object as Entity));
        return;
      case 'delete':
        set(drop(boot, event.kind, event.id));
        return;
      case 'settings':
        set({ settings: event.settings });
        return;
      case 'reload':
      case 'drawings':
        // Änderungen, die viele Zeilen betreffen: einmal sauber neu holen.
        scheduleReload(() => void get().load());
        return;
    }
  },

  /* -------------------------------------------------- Archiv & Papierkorb */

  loadArchive: async (more = false) => {
    const q = get().archiveQuery.trim();
    const scope = get().scope;
    const key = `${scope}|${q}`;
    const cur = get().archive;
    const offset = more && cur && get().archiveFor === key ? cur.entries.length : 0;
    try {
      const page = await api.archivePage({
        ...(scope === 'all' ? {} : { projectId: scope }),
        ...(q ? { q } : {}),
        offset,
      });
      // Kam inzwischen eine andere Suche dazwischen, gilt deren Antwort.
      if (`${get().scope}|${get().archiveQuery.trim()}` !== key) return;
      const prev = offset ? get().archive : null;
      set({
        archiveFor: key,
        archive: prev
          ? {
              total: page.total,
              entries: [...prev.entries, ...page.entries],
              tasks: [...prev.tasks, ...page.tasks],
              milestones: [...prev.milestones, ...page.milestones],
            }
          : page,
      });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Archiv konnte nicht geladen werden' });
    }
  },

  archiveFor: '',
  setArchiveQuery: (archiveQuery) => set({ archiveQuery }),

  archOpen: readLocal<Record<string, boolean>>(ARCH_OPEN_KEY, {}),
  setArchOpen: (id, open) => {
    const archOpen = { ...get().archOpen, [id]: open };
    writeLocal(ARCH_OPEN_KEY, archOpen);
    set({ archOpen });
  },

  unarchive: async (kind, id) => {
    try {
      const r = await api.restore<Task | Milestone>(kind, id);
      await get().load();
      // Die Meldung des Prototyps: wohin es zurückkam, und warum, wenn es woanders liegt.
      const ws = get().ws;
      const m = kind === 'milestone' ? ws?.milestone(id) : null;
      const t = kind === 'task' ? ws?.task(id) : null;
      const where = m ? (m.planned ? 'im Plan' : 'im Backlog') : ws && t ? whereLabel(ws, t) : '';
      set({
        toast: `Wiederhergestellt ${where}${r.moved ? ' (der ursprüngliche Ort ist archiviert)' : ''}`,
        toastUndo: false,
      });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Wiederherstellen fehlgeschlagen' });
    }
  },

  loadTrash: async () => {
    try {
      const t = await api.trash();
      set({ trash: t.entries, trashDays: t.days });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Papierkorb konnte nicht geladen werden' });
    }
  },

  restoreTrash: async (id) => {
    const entry = get().trash?.find((e) => e.id === id);
    try {
      const r = await api.restoreTrash(id);
      await get().load();
      const title = entry?.title ?? '';
      set({
        toast:
          r.kind === 'project'
            ? `Projekt „${title}“ ${r.label} wiederhergestellt`
            : `„${title || 'Ohne Titel'}“ wiederhergestellt ${r.label}`.trim(),
        toastUndo: false,
      });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Wiederherstellen fehlgeschlagen', toastUndo: false });
    }
  },

  purgeTrash: async (id) => {
    try {
      const { undo } = await api.purgeTrash(id);
      await get().loadTrash();
      remember('Endgültig gelöscht', undo);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  trashConfirm: false,
  setTrashConfirm: (trashConfirm) => set({ trashConfirm }),

  emptyTrash: async (ids) => {
    if (!ids.length) return;
    try {
      const { count, undo } = await api.emptyTrash(ids);
      set({ trashConfirm: false });
      await get().loadTrash();
      remember(`${count} ${count === 1 ? 'Eintrag' : 'Einträge'} endgültig gelöscht`, undo);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },
}));

/** Wo etwas liegt, in Worten – `whereLabel` aus dem Prototyp. */
export function whereLabel(ws: Workspace, t: Task): string {
  const project = ws.project(t.projectId)?.name ?? '';
  if (t.parentId) return `unter „${ws.task(t.parentId)?.title ?? ''}“`;
  const m = ws.milestone(t.milestoneId);
  if (m) return `in ◆ ${m.title}${m.planned ? '' : ' (Backlog)'}`;
  if (t.doc) return `in Dokumentation · ${project}`;
  return `im Backlog › ${placeLabel(ws, t)} · ${project}`;
}

/**
 * Der Arbeitsstand samt der geladenen Archivseite – für Archivansicht und
 * Inspektor, die auch Archiviertes zeigen. Einmal gebaut je Paar aus Stand
 * und Seite, nicht bei jedem Zeichnen.
 */
let archiveWsCache: { boot: Bootstrap; page: ArchivePage; ws: Workspace } | null = null;
export function archiveWorkspace(s: State): Workspace | null {
  if (!s.boot || !s.archive) return null;
  if (archiveWsCache?.boot === s.boot && archiveWsCache.page === s.archive) return archiveWsCache.ws;
  const known = new Set(s.boot.tasks.map((t) => t.id));
  const ws = new Workspace({
    ...s.boot,
    tasks: [...s.boot.tasks, ...s.archive.tasks.filter((t) => !known.has(t.id))],
    milestones: [...s.boot.milestones, ...s.archive.milestones],
  });
  archiveWsCache = { boot: s.boot, page: s.archive, ws };
  return ws;
}

/**
 * Milestone und Gruppe sind nur eine Ablage: gelöscht bleiben ihre Aufgaben
 * bestehen. Das sagt die Meldung ausdrücklich, sonst sucht man sie.
 */
const REMOVED: Partial<Record<Kind, string>> = {
  milestone: 'Milestone im Papierkorb – seine Tasks liegen unter „Unsortiert“',
  group: 'Gruppe gelöscht – ihre Tasks liegen unter „Unsortiert“',
};

/** Wie tief der Rücknahme-Stapel reicht. Mehr braucht niemand, weniger nervt. */
const UNDO_DEPTH = 25;

/**
 * Meldung zeigen und die Gegen-Schritte auf den Stapel legen. Ohne Schritte
 * bleibt es bei der Meldung – dann gibt es nichts zurückzunehmen.
 */
function remember(message: string, steps: Step[]): void {
  if (!steps.length) {
    useStore.setState({ toast: message, toastUndo: false });
    return;
  }
  pushUndo(steps, message);
  useStore.setState({ toast: message, toastUndo: true });
}

/** Nur den Stapel füllen, ohne Meldung – für Änderungen, die man ohnehin sieht. */
function pushUndo(steps: Step[], label = 'Änderung'): void {
  if (!steps.length) return;
  useStore.setState((s) => ({
    undoStack: [...s.undoStack, { label, steps }].slice(-UNDO_DEPTH),
  }));
}

/* ---------------------------------------------------------- Abgeleitetes */

/** Die Projekte, die die aktuelle Ansicht zeigt – eines oder alle, in Reihenfolge. */
export const scopeProjectIds = (s: State): string[] =>
  s.scope === 'all' ? (s.boot?.projects.map((p) => p.id) ?? []) : [s.scope];

/** Wohin Neues gehört: bei „Alle Projekte“ das zuletzt gewählte. */
export const currentProjectId = (s: State): string | null =>
  s.scope === 'all' ? (s.lastProject ?? s.boot?.projects[0]?.id ?? null) : s.scope;

/** Setzt die Darstellung am Dokument; `system` überlässt sie dem Betriebssystem. */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

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

const LIST_KEY = {
  task: 'tasks',
  milestone: 'milestones',
  project: 'projects',
  group: 'groups',
  category: 'categories',
  mark: 'marks',
} as const;

/** Ersetzt ein Objekt und baut den Index neu. */
function replace(boot: Bootstrap, kind: Kind, updated: Entity): { boot: Bootstrap; ws: Workspace } {
  const key = LIST_KEY[kind];
  const next: Bootstrap = {
    ...boot,
    [key]: (boot[key] as Entity[]).map((x) => (x.id === updated.id ? updated : x)),
  };
  return { boot: next, ws: new Workspace(next) };
}

/**
 * Ändern im Archiv – wie im Prototyp bleibt der Inspektor dort bearbeitbar.
 * Geändert wird die geladene Archivseite, mit demselben Vorgriff wie `patch`.
 */
async function patchArchived(kind: Kind, id: string, changes: Record<string, unknown>): Promise<void> {
  if (kind !== 'task' && kind !== 'milestone') return;
  const key = kind === 'task' ? 'tasks' : 'milestones';
  const put = (object: Task | Milestone): void => {
    const page = useStore.getState().archive;
    if (!page) return;
    useStore.setState({
      archive: {
        ...page,
        [key]: (page[key] as (Task | Milestone)[]).map((x) => (x.id === object.id ? object : x)),
      },
    });
  };
  const current = (useStore.getState().archive?.[key] as (Task | Milestone)[] | undefined)?.find(
    (x) => x.id === id,
  );
  if (!current) return;

  put({ ...current, ...changes } as Task | Milestone);
  try {
    const updated = await api.patch<Task | Milestone>(kind, id, current.version, changes);
    put(updated);
    pushUndo([
      {
        op: 'patch',
        kind,
        id,
        version: updated.version,
        changes: Object.fromEntries(
          Object.keys(changes).map((k) => [k, (current as Record<string, unknown>)[k]]),
        ),
      },
    ]);
  } catch (e) {
    put(e instanceof ApiError && e.status === 409 && e.current ? (e.current as Task) : current);
    useStore.setState({
      toast:
        e instanceof ApiError && e.status === 409
          ? 'Inzwischen woanders geändert – neuer Stand übernommen.'
          : e instanceof Error
            ? e.message
            : 'Änderung fehlgeschlagen',
      toastUndo: false,
    });
  }
}

/** Wie `replace`, hängt das Objekt aber an, wenn es noch fehlt (fremdes Anlegen). */
function upsert(boot: Bootstrap, kind: Kind, object: Entity): { boot: Bootstrap; ws: Workspace } {
  const list = boot[LIST_KEY[kind]] as Entity[];
  if (list.some((x) => x.id === object.id)) return replace(boot, kind, object);
  const next: Bootstrap = { ...boot, [LIST_KEY[kind]]: [...list, object] };
  return { boot: next, ws: new Workspace(next) };
}

function drop(boot: Bootstrap, kind: Kind, id: string): { boot: Bootstrap; ws: Workspace } {
  const next: Bootstrap = {
    ...boot,
    [LIST_KEY[kind]]: (boot[LIST_KEY[kind]] as Entity[]).filter((x) => x.id !== id),
  };
  return { boot: next, ws: new Workspace(next) };
}

/**
 * Mehrere Meldungen kurz hintereinander (etwa beim Zeichnen im anderen Tab)
 * ergeben ein einziges Nachladen statt eines Dauerfeuers.
 */
let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReload(run: () => void): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = null;
    run();
  }, 400);
}
