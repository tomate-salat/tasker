import { create } from 'zustand';
import type { BulkAction, Kind, Step } from '@shared/api.js';
import { dayKey } from '@shared/burnup.js';
import type { ChangeEvent } from '@shared/events.js';
import { isArchived, type Milestone, type Task } from '@shared/model.js';
import {
  areaLabel,
  doneCandidates,
  draftMilestones,
  isLooseRoot,
  looseBoxId,
  placeLabel,
  plannedMilestones,
  visibility,
  type OutlineFilter,
} from '@shared/outline.js';
import { schedule } from '@shared/schedule.js';
import { progressLockedBy } from '@shared/tisch.js';
import { Workspace } from '@shared/workspace.js';
import {
  ApiError,
  api,
  type ArchivePage,
  type Bootstrap,
  type DrawingOwner,
  type ImageEntry,
  type ImageFolder,
  type Settings,
  type TrashList,
} from './api.js';
import { MS_STATUS } from './ui/icons.js';

export const VIEWS = [
  'tisch',
  'plan',
  'ready',
  'backlog',
  'docs',
  'timeline',
  'bilder',
  'archive',
  'trash',
] as const;
export type View = (typeof VIEWS)[number];

/** Darstellung von Plan, Ready, Backlog und Doku. */
export type Layout = 'list' | 'cards';

/** Die Ansichten, die als Liste oder als Karten erscheinen können. */
export const LAYOUT_VIEWS = ['plan', 'ready', 'backlog', 'docs'] as const;
export type LayoutView = (typeof LAYOUT_VIEWS)[number];

/** Vorgabe je Ansicht (Wunsch des Nutzers). */
const LAYOUT_DEFAULT: Record<LayoutView, Layout> = {
  plan: 'cards',
  ready: 'cards',
  backlog: 'list',
  docs: 'list',
};

export const isLayoutView = (v: View): v is LayoutView => (LAYOUT_VIEWS as readonly View[]).includes(v);

export const VIEW_LABEL: Record<View, string> = {
  tisch: 'Tisch',
  plan: 'Plan',
  ready: 'Ready',
  backlog: 'Backlog',
  docs: 'Doku',
  timeline: 'Zeitplan',
  bilder: 'Bilder',
  archive: 'Archiv',
  trash: 'Papierkorb',
};

/**
 * Die Reiter im Kopf. Der Papierkorb hängt wie im Prototyp unten in der Seitenleiste.
 * „Ready“ gibt es im Prototyp nicht – auf Wunsch dazugekommen, zwischen Plan und Backlog.
 * „Bilder“ ebenso: die Galerie ist ein Bestand wie das Archiv, kein Teil der Liste.
 * „Tisch“ (Wunsch des Nutzers) steht als erster: der aktive Milestone als Kartenspiel.
 */
export const TABS: View[] = ['tisch', 'plan', 'ready', 'backlog', 'docs', 'timeline', 'bilder', 'archive'];

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
  /** Liste oder Karten, je Ansicht gewählt und pro Gerät gemerkt. */
  layouts: Record<LayoutView, Layout>;
  setLayout: (view: LayoutView, layout: Layout) => void;
  /** Erledigte Aufgaben im Plan ausgeblendet – pro Gerät gemerkt. */
  hideDone: boolean;
  setHideDone: (hide: boolean) => void;
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
  /** Die ganze Auswahl endgültig löschen – über den Papierkorb, siehe `purgeAfterTrash`. */
  destroyMulti: () => Promise<void>;

  /**
   * Der Rücknahme-Stapel. Er lebt im Tab, nicht auf dem Server: jede
   * schreibende Handlung legt hier die Gegen-Schritte ab, die sie zurücknehmen
   * würden. Beim Zurücknehmen prüft der Server die `version` mit – eine
   * Rücknahme auf einem überholten Stand wird abgelehnt statt blind ausgeführt.
   */
  undoStack: { label: string; steps: Step[] }[];
  /** Zeigt die Kurzmeldung gerade ein „Rückgängig“ an? */
  toastUndo: boolean;
  /**
   * „Anzeigen“ bzw. „Öffnen“ an einer Meldung, wie `toast(msg, {label, fn})` im
   * Prototyp. Gilt nur für die Meldung, zu der es gehört (`toast`) – eine
   * neuere Meldung trägt es so nicht versehentlich weiter.
   */
  toastLink: { toast: string; label: string; run: () => void } | null;
  /**
   * Holt etwas in den Blick und wählt es aus (`goto` im Prototyp): richtiges
   * Projekt und richtige Ansicht, Behälter aufgeklappt, Filter weg, wenn er es
   * verstecken würde.
   */
  reveal: (id: string) => void;
  /**
   * Die Zeichnung, die das Abzeichen an einer Zeile geöffnet hat (`openDraw` im
   * Prototyp) – unabhängig davon, was im Inspektor steht.
   */
  drawingOpen: { owner: DrawingOwner; id: string } | null;
  openDrawing: (open: { owner: DrawingOwner; id: string } | null) => void;
  /** Das Abhängigkeits-Board um einen Task oder Milestone, geöffnet aus dem Inspektor. */
  graphOpen: { projectId: string; focusId: string } | null;
  openGraph: (open: { projectId: string; focusId: string } | null) => void;
  /** Klappt die Behälter einer Aufgabe auf (`expandTo` im Prototyp) – nur die Ansicht bleibt. */
  expandTo: (id: string) => void;
  /** Meldung mit eigenem Knopf, etwa „Anzeigen“. */
  sayLink: (message: string, label: string, run: () => void) => void;
  /** Meldung mit „Rückgängig“, das die übergebenen Gegen-Schritte ausführt. */
  sayUndo: (message: string, steps: Step[]) => void;
  undo: () => Promise<void>;
  /**
   * Mehrere Schritte in einer Transaktion, mit Meldung und Rücknahme. Ohne
   * Meldung (`null`) landet nur die Rücknahme auf dem Stapel – etwa beim
   * Umsortieren per Ziehen, das man ohnehin sieht.
   */
  runSteps: (steps: Step[], message: ((count: number) => string) | null) => Promise<void>;
  /** Archiviert alles Erledigte der aktuellen Ansicht – Milestones und Aufgaben. */
  archiveDone: () => Promise<void>;
  toggle: (id: string) => void;
  setCollapsed: (id: string, value: boolean) => void;
  say: (message: string | null) => void;
  setVelocity: (velocity: number) => Promise<void>;
  /** Obergrenze und Kantenlänge für hochgeladene Bilder. */
  setImageLimits: (patch: { imageMaxKb?: number; imageMaxEdge?: number }) => Promise<void>;

  /** Der Bestand für die Galerie – samt Verwendungen, aber ohne die Bytes. */
  images: ImageEntry[];
  imagesLoaded: boolean;
  loadImages: () => Promise<void>;
  trashImage: (id: string) => Promise<void>;
  trashImages: (ids: string[]) => Promise<void>;
  /** Endgültig, ohne „Rückgängig“: die Bytes eines Bildes kommen nicht zurück. */
  destroyImages: (ids: string[]) => Promise<void>;
  restoreImage: (id: string) => Promise<void>;

  /**
   * Die Auswahl in der Galerie. Bewusst nicht `selected` und nicht `multi`: der
   * Inspektor soll weiter die offene Aufgabe zeigen, während man daneben Bilder
   * zusammenstellt, die man ihr geben will.
   */
  imageSel: Set<string>;
  setImageSel: (ids: string[]) => void;
  toggleImageSel: (id: string) => void;
  clearImageSel: () => void;

  /** Die Ordner der Galerie und der, in dem sie gerade steht. */
  folders: ImageFolder[];
  folderAt: string | null;
  openFolder: (id: string | null) => void;
  addFolder: (name: string, projectId: string | null, parentId: string | null) => Promise<void>;
  renameFolder: (id: string, name: string) => Promise<void>;
  /** `null` als Ziel heißt: ganz nach oben. */
  moveFolder: (id: string, parentId: string | null) => Promise<void>;
  /** `withContents` legt die Bilder des ganzen Astes in den Papierkorb. */
  deleteFolder: (id: string, withContents?: boolean) => Promise<void>;
  sortIntoFolder: (ids: string[], folderId: string | null) => Promise<void>;

  patch: (kind: Kind, id: string, changes: Record<string, unknown>) => Promise<void>;
  /** Legt eine Aufgabe an und gibt ihre ID zurück – für „danach gleich umbenennen“. */
  addTask: (input: Record<string, unknown>) => Promise<string | null>;
  addProject: (name: string) => Promise<void>;
  /** Projekt, dessen Name gerade in der Seitenleiste bearbeitet wird. */
  editProject: string | null;
  setEditProject: (id: string | null) => void;
  renameProject: (id: string, name: string) => Promise<void>;
  /** Wie im Prototyp: das letzte Projekt bleibt. */
  trashProject: (id: string, forGood?: boolean) => Promise<void>;
  /** Für welches Projekt der Kategorien-Dialog gilt; ohne Angabe das aktuelle. */
  catProject: string | null;
  openCategories: (projectId?: string) => void;
  /** Wie `openCategories`: die Markierungen gehören zu einem Projekt. */
  openMarks: (projectId?: string) => void;
  /** Ohne Angabe ein eingeplanter Milestone im aktuellen Projekt. Gibt die ID zurück. */
  addMilestone: (
    title: string,
    o?: { planned?: boolean; projectId?: string },
  ) => Promise<string | null>;
  /** Gibt die ID zurück – „Neue Gruppe“ im Menü benennt sie gleich um. */
  addGroup: (title: string, projectId?: string) => Promise<string | null>;
  /** Kopiert eine Aufgabe samt Unterbaum und wählt die Kopie aus. */
  duplicateTask: (id: string) => Promise<void>;
  /**
   * Macht aus einem Task mit Unteraufgaben einen vorbereiteten Milestone –
   * die Unteraufgaben werden seine Wurzelaufgaben.
   */
  convertToMilestone: (id: string) => Promise<void>;
  /** Checkboxen der Beschreibung zu Unteraufgaben – ohne `items` alle offenen. */
  checklistToSubtasks: (id: string, items?: number[]) => Promise<void>;
  /**
   * Ohne `message` still (nur Rückgängig auf dem Stapel). Mit `message` gibt es
   * eine Meldung mit „Rückgängig“; sie bekommt die Aufgabe am neuen Ort.
   */
  moveTask: (
    id: string,
    target: Record<string, unknown>,
    message?: (moved: Task | null, ws: Workspace | null) => string,
  ) => Promise<void>;
  archiveItem: (kind: 'task' | 'milestone', id: string) => Promise<void>;
  /** Milestone in den Plan oder zurück in den Backlog, jeweils ans Ende – `planMs` im Prototyp. */
  planMilestone: (id: string, planned: boolean) => Promise<void>;
  /**
   * Status eines Milestones, `setMsStatus` im Prototyp: „In Progress“ setzt ein
   * fehlendes Startdatum, „Done“ ein fehlendes Enddatum; das automatische
   * Enddatum geht wieder, wenn er doch nicht fertig ist.
   */
  setMilestoneStatus: (id: string, status: 'open' | 'progress' | 'done') => Promise<void>;
  /** `message` ersetzt die übliche Meldung – etwa „In den Papierkorb verschoben“ im Archiv. */
  remove: (kind: Kind, id: string, message?: string) => Promise<void>;
  /** Endgültig löschen – über den Papierkorb, siehe `purgeAfterTrash`. */
  destroy: (kind: Kind, id: string) => Promise<void>;
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
const LAYOUT_KEY = 'tasker.layouts';
const ARCH_OPEN_KEY = 'tasker.archOpen';
const HIDE_DONE_KEY = 'tasker.hideDone';

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

/** Die gemerkten Darstellungen – was fehlt oder nicht passt, nimmt die Vorgabe. */
function readLayouts(): Record<LayoutView, Layout> {
  const saved = readLocal<Partial<Record<string, unknown>>>(LAYOUT_KEY, {});
  const out = { ...LAYOUT_DEFAULT };
  for (const v of LAYOUT_VIEWS) {
    const l = saved?.[v];
    if (l === 'list' || l === 'cards') out[v] = l;
  }
  return out;
}

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
  layouts: readLayouts(),
  setLayout: (view, layout) => {
    const layouts = { ...get().layouts, [view]: layout };
    writeLocal(LAYOUT_KEY, layouts);
    set({ layouts });
  },
  hideDone: readLocal<boolean>(HIDE_DONE_KEY, false),
  setHideDone: (hideDone) => {
    writeLocal(HIDE_DONE_KEY, hideDone);
    set({ hideDone });
  },
  sideOpen: false,
  view: 'plan',
  selected: null,
  editing: null,
  collapsed: readLocal<Record<string, boolean>>(COLLAPSED_KEY, {}),
  settings: { velocity: 8, theme: 'system', imageMaxKb: 500, imageMaxEdge: 2560 },
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
        // Die Galerie zieht mit, sobald sie einmal geladen war: die Verwendungen
        // stehen sonst auf dem Stand von vorher.
        get().view === 'bilder' || get().imagesLoaded ? get().loadImages() : null,
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

  // Die Auswahl bleibt beim Reiterwechsel stehen (Wunsch des Nutzers): so kann
  // man Tasks aus einer anderen Ansicht auf die Abhängigkeiten im Inspektor ziehen.
  setView: (view) => set({ view, editing: null, sideOpen: false }),

  setVelocity: async (velocity) => {
    try {
      set({ settings: await api.putSettings({ velocity }) });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Tempo konnte nicht gesetzt werden' });
    }
  },

  setImageLimits: async (patch) => {
    try {
      set({ settings: await api.putSettings(patch) });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Einstellung konnte nicht gesetzt werden' });
    }
  },

  // Den Inspektor zu schließen hebt auch die Auswahl auf (so wie im Prototyp).
  select: (id) => set({ selected: id, editing: null }),

  editingNew: false,
  // Eine Gruppe hat keinen Inspektor – sie umzubenennen wählt nichts aus.
  edit: (editing, isNew = false) =>
    set({
      editing,
      editingNew: !!editing && isNew,
      ...(editing && !get().boot?.groups.some((g) => g.id === editing) ? { selected: editing } : {}),
    }),

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

  bulk: async (action, message) => bulkRun(action, message),

  destroyMulti: async () =>
    bulkRun({ type: 'trash' }, (c) => `${c} ${c === 1 ? 'Aufgabe' : 'Aufgaben'} endgültig gelöscht`, true),

  /* ------------------------------------------------------------ Rücknahme */

  undoStack: [],
  toastUndo: false,
  toastLink: null,
  sayLink: (message, label, run) => linked(message, label, run),
  sayUndo: (message, steps) => remember(message, steps),
  drawingOpen: null,
  openDrawing: (drawingOpen) => set({ drawingOpen }),
  graphOpen: null,
  openGraph: (graphOpen) => set({ graphOpen }),

  expandTo: (id) => {
    const ws = get().ws;
    const m = ws?.milestone(id);
    const t = m ? null : ws?.task(id);
    if (!ws || (!m && !t)) return;
    const collapsed = { ...get().collapsed };
    if (m) collapsed[m.id] = false;
    if (t) {
      for (const a of ws.ancestors(t)) collapsed[a.id] = false;
      const root = ws.root(t);
      if (root.milestoneId) collapsed[root.milestoneId] = false;
      else if (root.groupId) collapsed[root.groupId] = false;
      else if (!ws.isDoc(root)) collapsed[looseBoxId(root, ws)] = false;
    }
    writeLocal(COLLAPSED_KEY, collapsed);
    set({ collapsed });
  },

  reveal: (id) => {
    const s = get();
    const ws = s.ws;
    const m = ws?.milestone(id) ?? null;
    const t = m ? null : (ws?.task(id) ?? null);
    const x = m ?? t;
    if (!ws) return;
    const scope = x && s.scope !== 'all' && s.scope !== x.projectId ? x.projectId : s.scope;
    const scoped =
      scope !== s.scope
        ? { scope, lastProject: scope, filter: { ...s.filter, categoryId: null }, archive: null }
        : {};
    if (scope !== s.scope) writeLocal(SCOPE_KEY, scope);

    // Archiviertes zeigt das Archiv – ungefiltert und mit aufgeklappten Behältern.
    // Was nicht im aktiven Bestand liegt, ist archiviert.
    if (!x || (m && isArchived(m)) || (t && !ws.isActive(t))) {
      const archOpen = { ...s.archOpen };
      if (t) {
        for (const a of ws.ancestors(t)) archOpen[a.id] = true;
        const root = ws.root(t);
        if (root.milestoneId) archOpen[root.milestoneId] = true;
      }
      writeLocal(ARCH_OPEN_KEY, archOpen);
      set({ ...scoped, view: 'archive', archiveQuery: '', archOpen, selected: id, editing: null, sideOpen: false });
      return;
    }

    get().expandTo(id);
    const collapsed = get().collapsed;
    const view = homeView(ws, id, s.view);
    const filter = scoped.filter ?? s.filter;
    const hidden = t && !visibility(ws, filter)(t);
    set({
      ...scoped,
      ...(hidden ? { filter: { tag: null, categoryId: null, markId: null } } : {}),
      view,
      collapsed,
      selected: id,
      editing: null,
      sideOpen: false,
    });
    requestAnimationFrame(() =>
      document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'nearest' }),
    );
  },

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
      if (message) remember(message(count), undo);
      else pushUndo(undo);
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
    if (!ws || (view !== 'plan' && view !== 'ready' && view !== 'backlog')) return;

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

  say: (toast) => set({ toast, toastUndo: false, toastLink: null }),

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

    // Wer ins Spiel kommt, reiht sich auf dem Tisch hinten ein – so setzt es gleich auch der Server.
    const was = current as Task;
    const played =
      kind === 'task' && changes['status'] === 'progress' && was.status !== 'progress' && !('playOrder' in changes);
    const ahead = played
      ? { playOrder: Math.max(0, ...boot.tasks.filter((t) => t.projectId === was.projectId).map((t) => t.playOrder)) + 1 }
      : {};
    set(replace(boot, kind, { ...current, ...changes, ...ahead } as Entity));

    try {
      const updated = await api.patch<Task | Milestone>(kind, id, current.version, changes);
      set(replace(get().boot ?? boot, kind, updated));
      // Der Status einer Unteraufgabe kann den der Eltern-Aufgaben mitziehen (Server).
      if (kind === 'task' && 'status' in changes && (updated as Task).parentId) await get().load();
      // Die Gegen-Schritte kennt hier der Client selbst: die alten Werte plus
      // die Version, die dabei herauskam.
      pushUndo([
        {
          op: 'patch',
          kind,
          id,
          version: updated.version,
          changes: Object.fromEntries(
            // Mit dem Status kommt auch der Platz im Spiel zurück.
            [...Object.keys(changes), ...(kind === 'task' && 'status' in changes ? ['playOrder'] : [])].map((k) => [
              k,
              (current as Record<string, unknown>)[k],
            ]),
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

  trashProject: async (id, forGood = false) => {
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
      const n = entry?.taskCount ?? 0;
      const tasks = `${n} ${n === 1 ? 'Task' : 'Tasks'}`;
      if (forGood) {
        await purgeAfterTrash(
          [trashId],
          [{ op: 'untrash', trashId }],
          `Projekt „${p.name}“ mit ${tasks} endgültig gelöscht`,
        );
      } else {
        await get().load();
        remember(`Projekt „${p.name}“ mit ${tasks} im Papierkorb`, [{ op: 'untrash', trashId }]);
      }
      if (get().selected && !get().ws?.task(get().selected) && !get().ws?.milestone(get().selected)) {
        set({ selected: null });
      }
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  catProject: null,
  openCategories: (projectId) => set({ catProject: projectId ?? null, dialog: 'categories' }),
  openMarks: (projectId) => set({ catProject: projectId ?? null, dialog: 'marks' }),

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

  convertToMilestone: async (id) => {
    const task = get().ws?.task(id);
    if (!task) return;
    try {
      const { id: msId, count, undo } = await api.convert(id, task.version);
      await get().load();
      // Der neue Milestone steht im Backlog bzw. in „Ready“ – gleich hinschauen.
      get().reveal(msId);
      remember(
        `„${task.title || 'Ohne Titel'}“ ist jetzt ein Milestone mit ${count} ${
          count === 1 ? 'Task' : 'Tasks'
        }`,
        undo,
      );
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Umwandeln fehlgeschlagen' });
    }
  },

  checklistToSubtasks: async (id, items) => {
    const task = get().ws?.task(id);
    if (!task) return;
    try {
      const { count, undo } = await api.checklist(id, task.version, items);
      get().setCollapsed(id, false);
      await get().load();
      remember(count === 1 ? 'Eine Unteraufgabe angelegt' : `${count} Unteraufgaben angelegt`, undo);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Umwandeln fehlgeschlagen' });
    }
  },

  moveTask: async (id, target, message) => {
    const boot = get().boot;
    const current = boot?.tasks.find((t) => t.id === id);
    if (!current) return;
    try {
      const moved = await api.move<Task>(id, current.version, target);
      await get().load();
      // Zurück an die alte Stelle – der alte Ordnungswert füllt die Lücke wieder.
      const back: Step[] = [
        {
          op: 'move',
          id,
          version: moved.version,
          target: {
            parentId: current.parentId,
            milestoneId: current.milestoneId,
            groupId: current.groupId,
            markId: current.markId,
            ready: current.ready,
            categoryId: current.categoryId,
            projectId: current.projectId,
            doc: current.doc,
            order: current.order,
          },
        },
      ];
      if (message) {
        const ws = get().ws;
        remember(message(ws?.task(id) ?? null, ws), back);
      } else pushUndo(back);
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
    const ws = get().ws;
    const title = (kind === 'task' ? ws?.task(id)?.title : ws?.milestone(id)?.title) || 'Ohne Titel';
    try {
      await api.archive(kind, id);
      if (get().selected === id) set({ selected: null });
      await get().load();
      remember(`„${title}“ archiviert${kind === 'milestone' ? ' – samt Tasks' : ''}`, [
        { op: 'unarchive', kind, id },
      ]);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Archivieren fehlgeschlagen' });
    }
  },

  planMilestone: async (id, planned) => {
    const ws = get().ws;
    const m = ws?.milestone(id);
    if (!ws || !m) return;
    if (m.planned === planned) {
      set({ toast: planned ? 'Ist schon im Plan' : 'Liegt schon im Backlog', toastUndo: false });
      return;
    }
    // Ans Ende der Zielliste, wie `qorder = 1e6` bzw. `order = 1e6` im Prototyp.
    const key = planned ? 'qorder' : 'order';
    const list = (planned ? plannedMilestones : draftMilestones)(ws, m.projectId);
    const end = list.reduce((max, x) => Math.max(max, x[key]), -1) + 1;
    await get().patch('milestone', id, { planned, [key]: end });

    const now = get().ws;
    if (now?.milestone(id)?.planned !== planned) return; // Fehler steht schon in der Meldung.
    const line = planned
      ? schedule(now, { velocity: get().settings.velocity }).byId.get(id)
      : undefined;
    // Wie im Prototyp mit „Anzeigen“ – der Milestone ist gerade aus der Ansicht gewandert.
    linked(
      planned
        ? `„${m.title}“ ist im Plan${line && line.open ? ` · fertig ca. ${inWeeks(line.end)}` : ''}`
        : `„${m.title}“ ist zurück im Backlog`,
      'Anzeigen',
      () => get().reveal(id),
    );
  },

  setMilestoneStatus: async (id, status) => {
    const ws = get().ws;
    const m = ws?.milestone(id);
    if (!ws || !m || m.status === status) return;
    // Je Projekt ist nur einer aktiv – der Server lehnt es sonst auch ab.
    const other = status === 'progress' ? progressLockedBy(ws, m) : null;
    if (other) {
      set({ toast: `Erst ist „${other.title || 'Ohne Titel'}“ dran – nur ein Milestone kann In Progress sein`, toastUndo: false });
      return;
    }
    const today = dayKey(new Date());
    const changes: Partial<Milestone> = { status };
    const autoStart = status === 'progress' && !m.startDate;
    const autoEnd = status === 'done' && !m.endDate;
    if (autoStart) changes.startDate = today;
    if (autoEnd) Object.assign(changes, { endDate: today, endAuto: true });
    if (m.status === 'done' && status !== 'done' && m.endAuto) {
      Object.assign(changes, { endDate: null, endAuto: false });
    }
    await get().patch('milestone', id, changes);
    if (get().ws?.milestone(id)?.status !== status) return; // Fehler steht schon in der Meldung.
    const now = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
    set({
      toast: `◆ ${m.title}: ${MS_STATUS[status]}${autoStart ? ` · Start ${now}` : ''}${autoEnd ? ` · Ende ${now}` : ''}`,
      toastUndo: true,
    });
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

  destroy: async (kind, id) => {
    try {
      const { trashId } = await api.remove(kind, id);
      if (get().selected === id) set({ selected: null });
      await purgeAfterTrash([trashId], [{ op: 'untrash', trashId }], DESTROYED[kind] ?? 'Endgültig gelöscht');
    } catch (e) {
      await get().load();
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
      linked(
        `Wiederhergestellt ${where}${r.moved ? ' (der ursprüngliche Ort ist archiviert)' : ''}`,
        'Anzeigen',
        () => get().reveal(id),
      );
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
      if (r.kind === 'project') {
        linked(`Projekt „${title}“ ${r.label} wiederhergestellt`, 'Öffnen', () => get().setScope(r.id));
      } else {
        const message = `„${title || 'Ohne Titel'}“ wiederhergestellt ${r.label}`.trim();
        if (r.kind === 'task' || r.kind === 'milestone') linked(message, 'Anzeigen', () => get().reveal(r.id));
        else set({ toast: message, toastUndo: false });
      }
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Wiederherstellen fehlgeschlagen', toastUndo: false });
    }
  },

  purgeTrash: async (id) => {
    try {
      const { undo, images } = await api.purgeTrash(id);
      // Mit einem Bild ändern sich auch Beschreibungen (der Hinweis tritt an seine
      // Stelle) – dafür braucht es den ganzen Bestand neu, nicht nur den Papierkorb.
      await Promise.all([images ? get().load() : get().loadTrash(), images ? get().loadImages() : null]);
      remember(`Endgültig gelöscht${bildHinweis(images)}`, undo);
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  trashConfirm: false,
  setTrashConfirm: (trashConfirm) => set({ trashConfirm }),

  emptyTrash: async (ids) => {
    if (!ids.length) return;
    try {
      const { count, undo, images } = await api.emptyTrash(ids);
      set({ trashConfirm: false });
      await Promise.all([images ? get().load() : get().loadTrash(), images ? get().loadImages() : null]);
      remember(
        `${count} ${count === 1 ? 'Eintrag' : 'Einträge'} endgültig gelöscht${bildHinweis(images)}`,
        undo,
      );
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen' });
    }
  },

  /* --------------------------------------------------------------- Bilder */

  images: [],
  imagesLoaded: false,

  loadImages: async () => {
    try {
      const { images, folders } = await api.images();
      // Stand der Ordner gerade nicht mehr da (anderer Tab), steht die Galerie
      // sonst in einem Ordner, den es nicht gibt, und wirkt leer.
      const at = get().folderAt;
      set({
        images,
        folders,
        imagesLoaded: true,
        folderAt: at && folders.some((f) => f.id === at) ? at : null,
      });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Bilder konnten nicht geladen werden' });
    }
  },

  trashImage: async (id) => {
    const name = get().images.find((b) => b.id === id)?.name ?? 'Bild';
    try {
      await api.trashImage(id);
      if (get().imageSel.has(id)) {
        const rest = new Set(get().imageSel);
        rest.delete(id);
        set({ imageSel: rest });
      }
      await Promise.all([get().loadImages(), get().trash ? get().loadTrash() : null]);
      // Kein `remember`: das Zurückholen läuft über den Papierkorb, nicht über Schritte.
      linked(`„${name}“ in den Papierkorb gelegt`, 'Rückgängig', () => void get().restoreImage(id));
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen', toastUndo: false });
    }
  },

  /**
   * Mehrere Bilder in einem Zug. Der Bestand wird einmal am Ende neu geholt –
   * sonst zuckt die Galerie bei jedem einzelnen Bild.
   */
  trashImages: async (ids) => {
    if (ids.length === 1) return get().trashImage(ids[0] as string);
    if (!ids.length) return;
    try {
      for (const id of ids) await api.trashImage(id);
      set({ imageSel: new Set() });
      await Promise.all([get().loadImages(), get().trash ? get().loadTrash() : null]);
      linked(`${ids.length} Bilder in den Papierkorb gelegt`, 'Rückgängig', () => {
        void (async () => {
          for (const id of ids) await api.restoreImage(id);
          await Promise.all([get().loadImages(), get().trash ? get().loadTrash() : null]);
          set({ toast: 'Bilder wiederhergestellt', toastUndo: false, toastLink: null });
        })();
      });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen', toastUndo: false });
    }
  },

  destroyImages: async (ids) => {
    if (!ids.length) return;
    const trashIds: string[] = [];
    try {
      for (const id of ids) trashIds.push((await api.trashImage(id)).trashId);
      const rest = new Set(get().imageSel);
      for (const id of ids) rest.delete(id);
      set({ imageSel: rest });
      const name = ids.length === 1 ? `„${get().images.find((b) => b.id === ids[0])?.name ?? 'Bild'}“` : `${ids.length} Bilder`;
      // Bilder kennen kein „Rückgängig“ – `purgeTrash` lässt sie ohnehin aus.
      await purgeAfterTrash(trashIds, [], `${name} endgültig gelöscht`);
    } catch (e) {
      // Was schon im Papierkorb liegt, bleibt dort – verloren geht nichts.
      await Promise.all([get().loadImages(), get().trash ? get().loadTrash() : null]);
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen', toastUndo: false });
    }
  },

  imageSel: new Set(),
  setImageSel: (ids) => set({ imageSel: new Set(ids) }),

  toggleImageSel: (id) => {
    const next = new Set(get().imageSel);
    if (!next.delete(id)) next.add(id);
    set({ imageSel: next });
  },

  clearImageSel: () => {
    if (get().imageSel.size) set({ imageSel: new Set() });
  },

  /* ---------------------------------------------------- Ordner der Galerie */

  folders: [],
  folderAt: null,

  // Beim Wechsel fällt die Auswahl: sie zeigte auf Bilder, die man nicht mehr sieht.
  openFolder: (folderAt) => set({ folderAt, imageSel: new Set() }),

  addFolder: async (name, projectId, parentId) => {
    try {
      const folder = await api.addFolder({ projectId, parentId, name });
      await get().loadImages();
      set({ toast: `Ordner „${folder.name}“ angelegt`, toastUndo: false, toastLink: null });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Ordner anlegen fehlgeschlagen', toastUndo: false });
    }
  },

  renameFolder: async (id, name) => {
    try {
      await api.patchFolder(id, { name });
      await get().loadImages();
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Umbenennen fehlgeschlagen', toastUndo: false });
    }
  },

  moveFolder: async (id, parentId) => {
    const before = get().folders.find((f) => f.id === id)?.parentId ?? null;
    try {
      const folder = await api.patchFolder(id, { parentId });
      await get().loadImages();
      linked(`„${folder.name}“ verschoben`, 'Rückgängig', () => void get().moveFolder(id, before));
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Verschieben fehlgeschlagen', toastUndo: false });
    }
  },

  /**
   * Zwei Wege, die der Nutzer im Dialog wählt: Der Ordner allein lässt seinen
   * Inhalt eine Ebene höher rücken – dabei geht nichts verloren. Mit Inhalt
   * wandern die Bilder in den Papierkorb, von dort sind sie einzeln zurückzuholen.
   */
  deleteFolder: async (id, withContents = false) => {
    const folder = get().folders.find((f) => f.id === id);
    const name = folder?.name ?? 'Ordner';
    try {
      const { images } = await api.deleteFolder(id, withContents);
      if (get().folderAt === id) get().openFolder(folder?.parentId ?? null);
      await Promise.all([get().loadImages(), get().trash ? get().loadTrash() : null]);
      set({
        toast: withContents
          ? `Ordner „${name}“ gelöscht${images ? ` – ${images === 1 ? 'ein Bild liegt' : `${images} Bilder liegen`} im Papierkorb` : ''}`
          : `Ordner „${name}“ aufgelöst – der Inhalt liegt eine Ebene höher`,
        toastUndo: false,
        toastLink: null,
      });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Löschen fehlgeschlagen', toastUndo: false });
    }
  },

  sortIntoFolder: async (ids, folderId) => {
    if (!ids.length) return;
    // Wo sie herkamen – je Bild, denn eine Auswahl kann aus mehreren Ordnern stammen.
    const before = new Map(get().images.filter((b) => ids.includes(b.id)).map((b) => [b.id, b.folderId]));
    const ziel = folderId ? `„${get().folders.find((f) => f.id === folderId)?.name ?? 'Ordner'}“` : 'ganz nach oben';
    try {
      await api.sortIntoFolder(ids, folderId);
      await get().loadImages();
      linked(
        `${ids.length === 1 ? 'Bild' : `${ids.length} Bilder`} ${folderId ? `in ${ziel} gelegt` : 'nach oben gelegt'}`,
        'Rückgängig',
        () => {
          void (async () => {
            // Je Herkunft ein Aufruf – so landet jedes Bild wieder dort, wo es lag.
            const groups = new Map<string | null, string[]>();
            for (const [id, folder] of before) groups.set(folder, [...(groups.get(folder) ?? []), id]);
            for (const [folder, list] of groups) await api.sortIntoFolder(list, folder);
            await get().loadImages();
            set({ toast: 'Zurückgelegt', toastUndo: false, toastLink: null });
          })();
        },
      );
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Verschieben fehlgeschlagen', toastUndo: false });
    }
  },

  restoreImage: async (id) => {
    try {
      await api.restoreImage(id);
      await Promise.all([get().loadImages(), get().trash ? get().loadTrash() : null]);
      set({ toast: 'Bild wiederhergestellt', toastUndo: false });
    } catch (e) {
      set({ toast: e instanceof Error ? e.message : 'Wiederherstellen fehlgeschlagen', toastUndo: false });
    }
  },
}));

/** Datum in so vielen Wochen, kurz – `fmtD(addWeeks(w))` im Prototyp. */
const inWeeks = (weeks: number): string => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

/**
 * Die Kette vom obersten Ordner bis zu diesem – für die Spur über dem Raster
 * und für die Frage, ob ein Ordner in sich selbst wandern soll.
 *
 * Die Schleife zählt mit: eine Kette, die sich schließt, wäre in der Datenbank
 * zwar nicht vorgesehen, hier aber eine Endlosschleife.
 */
export function folderPath(id: string | null, list?: ImageFolder[]): ImageFolder[] {
  const folders = list ?? useStore.getState().folders;
  const out: ImageFolder[] = [];
  let at = id;
  while (at && out.length < 100) {
    const folder = folders.find((f) => f.id === at);
    if (!folder) break;
    out.unshift(folder);
    at = folder.parentId;
  }
  return out;
}

/** Wo etwas liegt, in Worten – `whereLabel` aus dem Prototyp. */
export function whereLabel(ws: Workspace, t: Task): string {
  const project = ws.project(t.projectId)?.name ?? '';
  if (t.parentId) return `unter „${ws.task(t.parentId)?.title ?? ''}“`;
  const m = ws.milestone(t.milestoneId);
  if (m) return `in ◆ ${m.title}${m.planned ? '' : ' (Backlog)'}`;
  if (t.doc) return `in Dokumentation · ${project}`;
  return `${areaLabel(ws, t) === 'Ready' ? 'in Ready' : 'im Backlog'} › ${placeLabel(ws, t)} · ${project}`;
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

const DESTROYED: Partial<Record<Kind, string>> = {
  milestone: 'Milestone endgültig gelöscht – seine Tasks liegen unter „Unsortiert“',
};

/**
 * „Endgültig löschen“ ist kein eigener Weg: der Eintrag geht erst in den
 * Papierkorb und wird von dort gleich wieder entfernt – genau wie beim Leeren.
 * Alles, was am endgültigen Löschen hängt (Bilder, Verweise in Texten), läuft
 * so an einer einzigen Stelle und kann nicht auseinanderlaufen.
 *
 * „Rückgängig“ geht beide Schritte in einem zurück: `back` sind die
 * Gegen-Schritte des Löschens, sie laufen nach denen des Leerens.
 */
async function purgeAfterTrash(trashIds: string[], back: Step[], message: string): Promise<void> {
  const s = useStore.getState();
  if (!trashIds.length) return s.load();
  const { undo, images } = await api.emptyTrash(trashIds);
  await Promise.all([s.load(), images ? s.loadImages() : null]);
  remember(message, undo.length ? [...undo, ...back] : []);
}

/**
 * Eine Handlung auf der ganzen Auswahl. Mit `forGood` wird aus dem Papierkorb
 * gleich wieder geleert (`purgeAfterTrash`); die Einträge nennen die
 * Gegen-Schritte des Löschens.
 */
async function bulkRun(
  action: BulkAction,
  message: (count: number) => string,
  forGood = false,
): Promise<void> {
  const { ws, multi, visible, load } = useStore.getState();
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
    if (forGood) {
      const trashIds = undo.flatMap((s) => (s.op === 'untrash' ? [s.trashId] : []));
      await purgeAfterTrash(trashIds, undo, message(count));
    } else {
      await load();
      remember(message(count), undo);
    }
    // Archivieren und Löschen nehmen die Zeilen weg – danach ist nichts mehr ausgewählt.
    if (action.type === 'archive' || action.type === 'trash') {
      useStore.setState({ multi: new Set<string>(), anchor: null, selected: null });
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      await load();
      useStore.setState({ toast: 'Inzwischen woanders geändert – nichts geändert, bitte nochmal.' });
      return;
    }
    if (forGood) await load();
    useStore.setState({ toast: e instanceof Error ? e.message : 'Stapel-Änderung fehlgeschlagen' });
  }
}

/** Wie tief der Rücknahme-Stapel reicht. Mehr braucht niemand, weniger nervt. */
const UNDO_DEPTH = 25;

/**
 * Meldung zeigen und die Gegen-Schritte auf den Stapel legen. Ohne Schritte
 * bleibt es bei der Meldung – dann gibt es nichts zurückzunehmen.
 */
/**
 * Beim Leeren des Papierkorbs fallen die Bytes eines Bildes wirklich. Das gehört
 * in die Meldung, denn „Rückgängig“ bringt genau die nicht zurück.
 */
const bildHinweis = (n: number): string =>
  n ? ` · ${n === 1 ? 'ein Bild ist' : `${n} Bilder sind`} damit endgültig weg` : '';

function remember(message: string, steps: Step[]): void {
  if (!steps.length) {
    useStore.setState({ toast: message, toastUndo: false, toastLink: null });
    return;
  }
  pushUndo(steps, message);
  useStore.setState({ toast: message, toastUndo: true, toastLink: null });
}

/** Meldung mit „Anzeigen“ oder „Öffnen“ statt „Rückgängig“. */
function linked(message: string, label: string, run: () => void): void {
  useStore.setState({ toast: message, toastUndo: false, toastLink: { toast: message, label, run } });
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
/**
 * Die Ansicht, in der ein aktiver Task oder Milestone steht. `hint` ist die
 * Ansicht, in der man gerade ist, und entscheidet nur, wo es mehrere gibt:
 * ein Milestone im Plan steht auch im Zeitplan, ein vorbereiteter Milestone
 * in Backlog und „Ready“. Ohne Hinweis (`null`) gilt dort „Ready“.
 */
export function homeView(ws: Workspace, id: string, hint: View | null): View {
  const m = ws.milestone(id);
  const t = m ? null : ws.task(id);
  const ms = m ?? (t ? ws.milestone(ws.root(t).milestoneId) : null);
  const root = t ? ws.root(t) : null;
  if (hint === 'timeline' && m) return 'timeline';
  if (ms?.planned) return 'plan';
  if (t && ws.isDoc(t)) return 'docs';
  if (ms) return hint === 'ready' || hint === null ? 'ready' : 'backlog';
  return root && isLooseRoot(root) && root.ready ? 'ready' : 'backlog';
}

/** Steht es in mehr als einer Ansicht? Dann gehört die Ansicht in die Adresse. */
export const ambiguousView = (ws: Workspace, id: string): boolean =>
  new Set(VIEWS.map((v) => homeView(ws, id, v))).size > 1;

export const currentProjectId = (s: State): string | null =>
  s.scope === 'all' ? (s.lastProject ?? s.boot?.projects[0]?.id ?? null) : s.scope;

/** Setzt die Darstellung am Dokument; `system` überlässt sie dem Betriebssystem. */
export function applyTheme(theme: Settings['theme']): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  // Statusleiste der installierten App: bei `system` gelten die Vorgaben aus
  // index.html je nach Betriebssystem, sonst beide Einträge in der festen Farbe.
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.dataset.system ??= meta.content;
    meta.content = theme === 'system' ? meta.dataset.system : bg;
  });
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
