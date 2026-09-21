import { create } from 'zustand';
import {
  container,
  countIn,
  draftMilestones,
  groupsOf,
  isLooseRoot,
  plannedMilestones,
  siblings,
  type OutlineRow,
  type Placement,
} from '@shared/outline.js';
import type { Milestone, Project, Task } from '@shared/model.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore, whereLabel, type View } from '../store.js';
import { placeSteps, toBacklog } from './actions.js';

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

type DragKind = 'task' | 'milestone' | 'group' | 'project';

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
  | { type: 'project'; project: Project };

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
  }
};

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
const SPRING_VIEWS: View[] = ['plan', 'backlog', 'docs'];

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
  const { ws, multi, visible } = useStore.getState();
  let ids = [id];
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

  switch (drag.kind) {
    case 'task':
      if (target.type === 'task') {
        if (drag.blocked.has(target.task.id)) return null;
        return y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'child';
      }
      if (target.type === 'tab') {
        return ['plan', 'backlog', 'docs', 'archive'].includes(target.view) ? 'into' : null;
      }
      return 'into';
    case 'milestone':
      if (target.type === 'milestone') return target.milestone.id === drag.id ? null : half;
      if (target.type === 'tab') {
        return ['plan', 'backlog', 'archive'].includes(target.view) ? 'into' : null;
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
  switch (drag.kind) {
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
            { ...loose, doc: false, index: END },
            undefined,
            (n) => `${tasksWord(n)} liegen jetzt im Backlog › Unsortiert`,
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
          { ...loose, doc: false, projectId: p.id, index: END },
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
            ...markFor(t, dest.place),
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
 * Die Regel des Prototyps für smarte Gruppen: hinein setzt die Markierung der
 * Gruppe, heraus in den Backlog nimmt sie weg, heraus in einen Milestone lässt
 * sie stehen.
 */
function markFor(dragged: Task, place: Placement): { markId?: string | null } {
  if (!place.milestoneId && !place.groupId) return { markId: place.markId ?? null };
  if (place.groupId && isLooseRoot(dragged) && dragged.markId) return { markId: null };
  return {};
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
