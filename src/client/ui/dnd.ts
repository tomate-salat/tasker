import { create } from 'zustand';
import {
  container,
  countIn,
  draftMilestones,
  groupsOf,
  plannedMilestones,
  siblings,
  type OutlineRow,
  type Placement,
} from '@shared/outline.js';
import type { Step } from '@shared/api.js';
import { dependsOn } from '@shared/blocking.js';
import type { Milestone, Project, Task } from '@shared/model.js';
import type { Workspace } from '@shared/workspace.js';
import { folderPath, useStore, whereLabel, type View } from '../store.js';
import { placeSteps, toBacklog } from './actions.js';
import { appendImages } from './imageDrop.js';

/**
 * Ziehen und Ablegen, Regeln wie im Prototyp (`dragover`/`applyDrop`):
 *
 * - **Aufgabe** über einer Aufgabe: oben „davor“, unten „danach“, in der Mitte
 *   „hinein“. Über Milestone, Gruppe, leerem Platzhalter, Reiter (Plan,
 *   Backlog, Doku, Archiv) und Projekt in der Seitenleiste: „hinein“.
 * - **Milestone** über einem Milestone: davor oder danach; über den Reitern
 *   Plan, Backlog und Archiv: hinein.
 * - **Projekt** über einem Projekt, **Gruppe** über einer Gruppe desselben
 *   Projekts: davor oder danach.
 *
 * Über den Prototyp hinaus (Wunsch des Nutzers): Gehört die gezogene Aufgabe
 * zu einer Mehrfachauswahl, wandern alle Ausgewählten mit. Am Listenrand
 * scrollt es mit, und kurzes Verweilen über einem Reiter öffnet ihn.
 *
 * Der Zustand liegt in einem eigenen kleinen Speicher, weil Liste,
 * Seitenleiste und Reiter an einem Ziehvorgang beteiligt sind.
 */
export type Zone = 'before' | 'after' | 'child' | 'into';

type DragKind = 'task' | 'milestone' | 'group' | 'project' | 'image' | 'folder';

type Drag = {
  kind: DragKind;
  id: string;
  /** Die Aufgaben, die mitwandern – bei einer Mehrfachauswahl alle obersten. */
  ids: string[];
  /** Wohin eine Aufgabe nicht darf: sie selbst und ihr Teilbaum. */
  blocked: Set<string>;
};

type DragState = {
  drag: Drag | null;
  over: { key: string; zone: Zone } | null;
};

export const useDrag = create<DragState>(() => ({ drag: null, over: null }));

type GroupRowT = Extract<OutlineRow, { type: 'group' }>;
type EmptyRowT = Extract<OutlineRow, { type: 'empty' }>;

export type Target =
  | { type: 'task'; task: Task }
  | { type: 'milestone'; milestone: Milestone }
  | { type: 'group'; row: GroupRowT }
  | { type: 'empty'; row: EmptyRowT }
  | { type: 'tab'; view: View }
  | { type: 'project'; project: Project }
  /** Die beiden Felder im Inspektor: Ablegen setzt eine Abhängigkeit. */
  | { type: 'dep'; dir: 'by' | 'blocks'; item: Task | Milestone }
  /**
   * Die Beschreibung im Inspektor. Nimmt nur Bilder aus der Galerie: auswählen,
   * zum Reiter „Bilder“ wechseln, das Bild auf den Text ziehen.
   */
  | { type: 'desc'; kind: 'task' | 'milestone'; item: Task | Milestone }
  /**
   * Ein Ordner der Galerie – die Kachel selbst und die Spur oben. `null` ist
   * die oberste Ebene, also „aus dem Ordner heraus“.
   */
  | { type: 'folder'; id: string | null };

const keyOf = (t: Target): string => {
  switch (t.type) {
    case 'task':
      return t.task.id;
    case 'milestone':
      return t.milestone.id;
    case 'group':
    case 'empty':
      return t.row.id;
    case 'tab':
      return `tab:${t.view}`;
    case 'project':
      return `proj:${t.project.id}`;
    case 'dep':
      return `dep:${t.dir}:${t.item.id}`;
    case 'desc':
      return `desc:${t.item.id}`;
    case 'folder':
      return `folder:${t.id ?? 'oben'}`;
  }
};

/**
 * Darf `from` auf `to` warten? Ein Milestone wartet nur auf Milestones, ein
 * Task auch auf einen Milestone. Schon Verknüpftes und Kreise fallen raus.
 */
export function canDepend(ws: Workspace, from: Task | Milestone, to: Task | Milestone): boolean {
  if (from.id === to.id) return false;
  if ('planned' in from && !('planned' in to)) return false;
  if (from.deps.includes(to.id)) return false;
  return !dependsOn(ws, to, from.id);
}

const clear = (): void => useDrag.setState({ drag: null, over: null });

/* ------------------------------------------------------ Mitscrollen */

/**
 * Über den Prototyp hinaus (Wunsch des Nutzers): Hält man eine gezogene Zeile
 * an den oberen oder unteren Rand der Liste, scrollt sie langsam mit – je
 * näher am Rand, desto schneller. Oben beginnt der Rand unter dem stehenden
 * Kopf, damit das Ablegen auf den Reitern ungestört bleibt.
 */
const EDGE = 60;
const MAX_STEP = 8;

let pointerX: number | null = null;
let pointerY: number | null = null;
let frame = 0;

const track = (e: DragEvent): void => {
  pointerX = e.clientX;
  pointerY = e.clientY;
};

/* Reiter öffnen sich beim Verweilen */

/**
 * Ebenfalls Wunsch des Nutzers: Bleibt man mit einer gezogenen Zeile kurz über
 * Plan, Backlog oder Doku, öffnet sich der Reiter – so lässt sich etwa eine
 * Auswahl aus dem Backlog direkt auf einen Milestone im Plan legen.
 */
const SPRING_MS = 600;
const SPRING_VIEWS: View[] = ['plan', 'ready', 'backlog', 'docs'];

let tabHover: { view: View; el: HTMLElement; since: number } | null = null;

function hoverTab(view: View, el: HTMLElement): void {
  if (tabHover?.view === view) return;
  tabHover = { view, el, since: performance.now() };
}

function springStep(): void {
  if (!tabHover || pointerX === null || pointerY === null) return;
  const box = tabHover.el.getBoundingClientRect();
  const inside =
    pointerX >= box.left && pointerX <= box.right && pointerY >= box.top && pointerY <= box.bottom;
  if (!inside) {
    tabHover = null;
    return;
  }
  if (performance.now() - tabHover.since < SPRING_MS) return;
  const store = useStore.getState();
  if (store.view !== tabHover.view && SPRING_VIEWS.includes(tabHover.view)) {
    store.setView(tabHover.view);
    watchDetached();
  }
  tabHover = null;
}

/**
 * Mit dem Ansichtswechsel verschwindet meist die gezogene Zeile aus dem DOM –
 * dann meldet der Browser das Ende des Ziehens (`dragend`) nicht mehr. Maus-
 * ereignisse gibt es während des Ziehens nicht; kommt wieder eins, ist es vorbei.
 */
function watchDetached(): void {
  const done = (): void => clear();
  for (const type of ['mousemove', 'pointerdown', 'keydown']) {
    document.addEventListener(type, done, { capture: true, once: true });
  }
  const off = useDrag.subscribe((s) => {
    if (s.drag) return;
    for (const type of ['mousemove', 'pointerdown', 'keydown']) {
      document.removeEventListener(type, done, { capture: true });
    }
    off();
  });
}

function scrollStep(): void {
  springStep();
  const main = document.querySelector<HTMLElement>('.main');
  if (main && pointerY !== null) {
    const box = main.getBoundingClientRect();
    const head = main.querySelector('.mhead')?.getBoundingClientRect();
    const top = head ? head.bottom : box.top;
    const speed = (d: number): number => Math.ceil(MAX_STEP * (1 - d / EDGE) ** 2);
    if (pointerY >= top && pointerY < top + EDGE) main.scrollTop -= speed(pointerY - top);
    else if (pointerY <= box.bottom && pointerY > box.bottom - EDGE) {
      main.scrollTop += speed(box.bottom - pointerY);
    }
  }
  frame = requestAnimationFrame(scrollStep);
}

useDrag.subscribe((s, prev) => {
  if (!!s.drag === !!prev.drag) return;
  // In der Einfangphase – die Ablageziele halten das Ereignis sonst unterwegs an.
  if (s.drag) {
    document.addEventListener('dragover', track, true);
    frame = requestAnimationFrame(scrollStep);
  } else {
    document.removeEventListener('dragover', track, true);
    cancelAnimationFrame(frame);
    pointerX = null;
    pointerY = null;
    tabHover = null;
  }
});

/** Die Zone, die gerade über diesem Ziel angezeigt wird. */
export const useZone = (target: Target): Zone | null => {
  const key = keyOf(target);
  return useDrag((s) => (s.over?.key === key ? s.over.zone : null));
};

/** Ob diese Zeile gerade gezogen wird (bei einer Auswahl: jede ausgewählte). */
export const useDragging = (id: string): boolean =>
  useDrag((s) => !!s.drag && (s.drag.id === id || s.drag.ids.includes(id)));

/** Macht ein Element ziehbar. */
export function dragSource(kind: DragKind, id: string, enabled = true) {
  return {
    draggable: enabled,
    onDragStart: (e: React.DragEvent) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', id);
      } catch {
        // Manche Browser erlauben das nicht – das Ziehen geht trotzdem.
      }
      useDrag.setState({ drag: start(kind, id), over: null });
    },
    onDragEnd: clear,
  };
}

function start(kind: DragKind, id: string): Drag {
  const { ws, multi, visible, imageSel } = useStore.getState();
  let ids = [id];
  // Ein Bild aus einer Auswahl nimmt die ganze Auswahl mit – in der Reihenfolge,
  // in der sie zusammengeklickt wurde.
  if (kind === 'image' && imageSel.has(id) && imageSel.size > 1) ids = [...imageSel];
  if (kind === 'task' && ws && multi.has(id) && multi.size > 1) {
    // In der Reihenfolge der Liste, ohne die, deren Vorfahre schon mitwandert.
    const order = (x: string): number => {
      const i = visible.indexOf(x);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    ids = [...multi]
      .filter((x) => ws.task(x) && !ws.ancestors(ws.task(x) as Task).some((a) => multi.has(a.id)))
      .sort((a, b) => order(a) - order(b));
  }
  const blocked = new Set<string>();
  if (kind === 'task' && ws) {
    for (const x of ids) {
      blocked.add(x);
      const t = ws.task(x);
      if (t) for (const d of ws.desc(t)) blocked.add(d.id);
    }
  }
  return { kind, id, ids, blocked };
}

/** Macht ein Element zum Ablageziel. */
export function dropTarget(target: Target) {
  return {
    onDragOver: (e: React.DragEvent) => {
      const { drag, over } = useDrag.getState();
      if (!drag) return;
      const zone = zoneFor(drag, target, e);
      if (!zone) return;
      if (target.type === 'tab') hoverTab(target.view, e.currentTarget as HTMLElement);
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      const key = keyOf(target);
      if (over?.key !== key || over.zone !== zone) useDrag.setState({ over: { key, zone } });
    },
    onDrop: (e: React.DragEvent) => {
      const { drag, over } = useDrag.getState();
      if (!drag || !over || over.key !== keyOf(target)) return;
      e.preventDefault();
      e.stopPropagation();
      clear();
      void applyDrop(drag, target, over.zone);
    },
  };
}

function zoneFor(drag: Drag, target: Target, e: React.DragEvent): Zone | null {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const y = (e.clientY - box.top) / box.height;
  const half: Zone = y < 0.5 ? 'before' : 'after';

  // Die Felder im Inspektor nehmen, was dort eine Abhängigkeit ergibt.
  if (target.type === 'dep') return depPairs(drag, target).length ? 'into' : null;

  // Die Beschreibung nimmt nur Bilder – eine Zeile fällt dort durch.
  if (target.type === 'desc') return drag.kind === 'image' ? 'into' : null;

  // Ein Ordner der Galerie nimmt Bilder und andere Ordner auf – aber nie sich
  // selbst und nichts, worin er schon liegt: der Ast hinge danach nirgends.
  if (target.type === 'folder') {
    if (drag.kind === 'image') return 'into';
    if (drag.kind !== 'folder') return null;
    const ahnen = folderPath(target.id).map((f) => f.id);
    return target.id === drag.id || ahnen.includes(drag.id) ? null : 'into';
  }
  if (drag.kind === 'image' || drag.kind === 'folder') return null;

  switch (drag.kind) {
    case 'task':
      if (target.type === 'task') {
        if (drag.blocked.has(target.task.id)) return null;
        // Karten stehen nebeneinander: dort liegt „davor/danach“ links und rechts.
        const at =
          (e.currentTarget as HTMLElement).dataset['axis'] === 'x'
            ? (e.clientX - box.left) / box.width
            : y;
        return at < 0.28 ? 'before' : at > 0.72 ? 'after' : 'child';
      }
      if (target.type === 'tab') {
        return ['plan', 'ready', 'backlog', 'docs', 'archive'].includes(target.view) ? 'into' : null;
      }
      return 'into';
    case 'milestone':
      if (target.type === 'milestone') return target.milestone.id === drag.id ? null : half;
      if (target.type === 'tab') {
        return ['plan', 'ready', 'backlog', 'archive'].includes(target.view) ? 'into' : null;
      }
      return null;
    case 'project':
      return target.type === 'project' && target.project.id !== drag.id ? half : null;
    case 'group':
      return target.type === 'group' && target.row.group && target.row.group.id !== drag.id
        ? half
        : null;
  }
}

/* ------------------------------------------------------------ Ablegen */

async function applyDrop(drag: Drag, target: Target, zone: Zone): Promise<void> {
  const ws = useStore.getState().ws;
  if (!ws) return;
  if (target.type === 'dep') return dropDep(drag, target);
  if (target.type === 'desc') return dropImage(drag, target);
  if (target.type === 'folder') {
    const store = useStore.getState();
    if (drag.kind === 'folder') return store.moveFolder(drag.id, target.id);
    if (drag.kind === 'image') return store.sortIntoFolder(drag.ids, target.id);
    return;
  }
  switch (drag.kind) {
    case 'image':
    case 'folder':
      return;
    case 'task':
      return dropTasks(ws, drag, target, zone);
    case 'milestone':
      return dropMilestone(ws, drag.id, target, zone);
    case 'project':
      return dropProject(ws, drag.id, target, zone);
    case 'group':
      return dropGroup(ws, drag.id, target, zone);
  }
}

type DepTarget = Extract<Target, { type: 'dep' }>;

/** Die Paare „wartet auf“, die dieses Ablegen ergeben würde – leere Liste heißt: geht nicht. */
function depPairs(drag: Drag, target: DepTarget): { from: Task | Milestone; to: Task | Milestone }[] {
  const ws = useStore.getState().ws;
  if (!ws || (drag.kind !== 'task' && drag.kind !== 'milestone')) return [];
  const item = ws.task(target.item.id) ?? ws.milestone(target.item.id);
  if (!item) return [];

  return drag.ids
    .map((id) => (drag.kind === 'task' ? ws.task(id) : ws.milestone(id)))
    .filter((x): x is Task | Milestone => !!x)
    .map((x) => (target.dir === 'by' ? { from: item, to: x } : { from: x, to: item }))
    .filter((p) => canDepend(ws, p.from, p.to));
}

type DescTarget = Extract<Target, { type: 'desc' }>;

/**
 * Ein Bild aus der Galerie auf die Beschreibung: der Verweis kommt ans Ende des
 * Textes. Damit lässt sich eine Aufgabe auswählen, zum Reiter „Bilder“ wechseln
 * und von dort etwas hereinziehen – dafür bleibt die Auswahl beim Reiterwechsel
 * stehen.
 */
async function dropImage(drag: Drag, target: DescTarget): Promise<void> {
  const { images } = useStore.getState();
  const list = drag.ids.map((id) => images.find((b) => b.id === id)).filter((b) => !!b);
  await appendImages(target.kind, target.item, list);
}

async function dropDep(drag: Drag, target: DepTarget): Promise<void> {
  const store = useStore.getState();
  const pairs = depPairs(drag, target);
  if (!pairs.length) {
    store.say('Daraus wird hier keine Abhängigkeit');
    return;
  }

  // Alles, was auf dasselbe wartet, in einem Schritt – sonst stolpern die Versionen.
  const byFrom = new Map<string, { from: Task | Milestone; to: string[] }>();
  for (const p of pairs) {
    const entry = byFrom.get(p.from.id) ?? { from: p.from, to: [] };
    entry.to.push(p.to.id);
    byFrom.set(p.from.id, entry);
  }

  const steps: Step[] = [...byFrom.values()].map(({ from, to }) => ({
    op: 'patch',
    kind: 'planned' in from ? 'milestone' : 'task',
    id: from.id,
    version: from.version,
    changes: { deps: [...new Set([...from.deps, ...to])] },
  }));

  const first = pairs[0] as { from: Task | Milestone; to: Task | Milestone };
  const name = (x: Task | Milestone): string => x.title || 'Ohne Titel';
  await store.runSteps(steps, () =>
    pairs.length === 1
      ? `„${name(first.from)}“ wartet jetzt auf „${name(first.to)}“`
      : `${pairs.length} Abhängigkeiten gesetzt`,
  );
}

const loose = { parentId: null, milestoneId: null, groupId: null };
const END = Number.MAX_SAFE_INTEGER;
const tasksWord = (n: number): string => `${n} ${n === 1 ? 'Task' : 'Tasks'}`;

async function dropTasks(ws: Workspace, drag: Drag, target: Target, zone: Zone): Promise<void> {
  const store = useStore.getState();
  const t = ws.task(drag.id);
  if (!t) return;
  const many = drag.ids.length > 1;

  /** Eine Aufgabe oder die ganze Auswahl an dasselbe Ziel. */
  const move = (
    to: Record<string, unknown>,
    one?: (moved: Task | null, now: Workspace | null) => string,
    all?: (n: number, now: Workspace | null) => string,
  ): Promise<void> =>
    many
      ? store.bulk({ type: 'move', target: to }, (n) =>
          all ? all(n, useStore.getState().ws) : `${tasksWord(n)} verschoben`,
        )
      : store.moveTask(t.id, to, one);

  /** Wo die erste gezogene Aufgabe jetzt liegt – für die Meldung. */
  const whereNow = (now: Workspace | null): string => {
    const x = now?.task(t.id);
    return now && x ? whereLabel(now, x) : '';
  };

  if (zone === 'into') {
    switch (target.type) {
      case 'tab':
        if (target.view === 'archive') {
          if (many) {
            await store.bulk({ type: 'archive' }, (n) => `${tasksWord(n)} archiviert`);
          } else await store.archiveItem('task', t.id);
          return;
        }
        if (target.view === 'plan') {
          store.say('Zieh den Task auf einen Milestone im Plan');
          return;
        }
        if (target.view === 'backlog') {
          if (!many) return toBacklog(t);
          return move(
            { ...loose, doc: false, ready: false, index: END },
            undefined,
            (n) => `${tasksWord(n)} liegen jetzt im Backlog › Unsortiert`,
          );
        }
        if (target.view === 'ready') {
          // Markierung und Kategorie bleiben – sie bestimmen die Gruppe in „Ready“.
          return move(
            { ...loose, doc: false, ready: true, index: END },
            (_, now) => `Liegt jetzt ${whereNow(now)}`,
            (n) => `${tasksWord(n)} sind jetzt ready`,
          );
        }
        if (target.view === 'docs') {
          return move(
            { ...loose, doc: true, index: END },
            () => `„${t.title}“ liegt jetzt in der Dokumentation`,
            (n) => `${tasksWord(n)} liegen jetzt in der Dokumentation`,
          );
        }
        return;

      case 'project': {
        const p = target.project;
        return move(
          { ...loose, doc: false, ready: false, projectId: p.id, index: END },
          () => `In den Backlog von ${p.name} verschoben`,
          (n) => `${tasksWord(n)} in den Backlog von ${p.name} verschoben`,
        );
      }

      case 'milestone':
      case 'group':
      case 'empty': {
        const dest =
          target.type === 'milestone'
            ? {
                projectId: target.milestone.projectId,
                place: { milestoneId: target.milestone.id } as Placement,
              }
            : { projectId: target.row.projectId, place: target.row.place };
        return move(
          {
            ...loose,
            milestoneId: dest.place.milestoneId ?? null,
            groupId: dest.place.groupId ?? null,
            projectId: dest.projectId,
            doc: false,
            ...placeFields(dest.place),
            index: many ? END : countIn(ws, dest.projectId, dest.place, t.id),
          },
          (_, now) => `Liegt jetzt ${whereNow(now)}`,
          (n, now) => `${tasksWord(n)} liegen jetzt ${whereNow(now)}`,
        );
      }
      default:
        return;
    }
  }

  if (target.type !== 'task') return;
  const onto = target.task;

  if (zone === 'child') {
    store.setCollapsed(onto.id, false);
    return move({ parentId: onto.id, index: ws.kids(onto.id).filter((k) => !drag.blocked.has(k.id)).length });
  }

  // Davor oder danach: Platz unter den künftigen Geschwistern, ohne die Gezogenen.
  const list = siblings(ws, onto).filter((x) => !drag.ids.includes(x.id));
  const at = list.indexOf(onto);
  if (at < 0) {
    store.say('Ziel nicht gefunden.');
    return;
  }
  return move({
    ...container(onto),
    projectId: onto.projectId,
    // Neben einer Wurzel gilt auch deren Art: Doku-Seite oder Aufgabe.
    ...(onto.parentId ? {} : { doc: onto.doc }),
    index: at + (zone === 'after' ? 1 : 0),
  });
}

/**
 * Was ein loser Behälter an der Aufgabe festlegt: Unsortiert nimmt „ready“
 * weg und lässt Markierung und Kategorie stehen; eine Gruppe in „Ready“ setzt
 * „ready“ und ihre Markierung – eine Kategorie-Gruppe ihre Kategorie und
 * nimmt die Markierung weg, sonst stünde die Aufgabe bei der Markierung.
 * Milestones und eigene Gruppen lassen beides, wie es ist.
 */
export function placeFields(place: Placement): Record<string, unknown> {
  if (place.milestoneId || place.groupId) return {};
  return {
    ready: !!place.ready,
    ...(place.markId !== undefined ? { markId: place.markId } : {}),
    ...(place.categoryId !== undefined ? { categoryId: place.categoryId } : {}),
  };
}

async function dropMilestone(ws: Workspace, id: string, target: Target, zone: Zone): Promise<void> {
  const store = useStore.getState();
  const m = ws.milestone(id);
  if (!m) return;

  if (zone === 'into' && target.type === 'tab') {
    if (target.view === 'archive') return store.archiveItem('milestone', id);
    return store.planMilestone(id, target.view === 'plan');
  }
  if (target.type !== 'milestone') return;

  // Wie im Prototyp: der Milestone übernimmt Projekt und Planungsstand des Ziels.
  const x = target.milestone;
  const key = x.planned ? 'qorder' : 'order';
  const list = (x.planned ? plannedMilestones : draftMilestones)(ws, x.projectId).filter(
    (y) => y.id !== id,
  );
  const extra: Record<string, unknown> = {};
  if (m.projectId !== x.projectId) extra['projectId'] = x.projectId;
  if (m.planned !== x.planned) extra['planned'] = x.planned;
  const at = list.indexOf(x) + (zone === 'after' ? 1 : 0);
  await store.runSteps(placeSteps('milestone', key, [...list, m], m, at, extra), null);
}

async function dropProject(ws: Workspace, id: string, target: Target, zone: Zone): Promise<void> {
  const p = ws.project(id);
  if (!p || target.type !== 'project') return;
  const list = ws.projects.filter((x) => x.id !== id);
  const at = list.indexOf(target.project) + (zone === 'after' ? 1 : 0);
  await useStore.getState().runSteps(placeSteps('project', 'order', ws.projects, p, at), null);
}

async function dropGroup(ws: Workspace, id: string, target: Target, zone: Zone): Promise<void> {
  const store = useStore.getState();
  const g = ws.group(id);
  const x = target.type === 'group' ? target.row.group : null;
  if (!g || !x) return;
  if (g.projectId !== x.projectId) {
    store.say('Gruppen bleiben in ihrem Projekt');
    return;
  }
  const all = groupsOf(ws, g.projectId);
  const at = all.filter((y) => y.id !== id).indexOf(x) + (zone === 'after' ? 1 : 0);
  await store.runSteps(placeSteps('group', 'order', all, g, at), null);
}
