import { checklist, checklistLines, CHECK_RE } from './checklist.js';
import { type Milestone, type Status, type Task, isDone } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Gezählt werden Aufgaben, nicht Punkte: jede Aufgabe ohne Unteraufgaben zählt 1,
 * eine Sammel-Aufgabe zählt die Summe ihrer Unteraufgaben.
 */
export function total(ws: Workspace, t: Task): number {
  const kids = ws.kids(t.id);
  return kids.length ? sumBy(kids, (k) => total(ws, k)) : 1;
}

/** Erledigte Aufgaben darunter. */
export function doneCount(ws: Workspace, t: Task): number {
  if (isDone(t)) return total(ws, t);
  return sumBy(ws.kids(t.id), (k) => doneCount(ws, k));
}

/** Erledigt oder nur noch aus erledigten Unteraufgaben bestehend. */
export function allDone(ws: Workspace, t: Task): boolean {
  if (isDone(t)) return true;
  const kids = ws.kids(t.id);
  return kids.length > 0 && kids.every((k) => allDone(ws, k));
}

/**
 * Für die Balken: erledigte Aufgaben zählen voll, offene anteilig nach ihrer
 * eigenen Checkliste. Zähler, Zeitplan und Burnup benutzen weiterhin nur
 * `doneCount`, also wirklich erledigte Aufgaben.
 */
export function progressUnits(ws: Workspace, t: Task): number {
  if (isDone(t)) return total(ws, t);
  const kids = ws.kids(t.id);
  const own = checklist(t.desc);
  const fromChecklist = own.total && !kids.length ? own.done / own.total : 0;
  return fromChecklist + sumBy(kids, (k) => progressUnits(ws, k));
}

export function progressPct(ws: Workspace, t: Task): number {
  const tot = total(ws, t);
  if (tot) return Math.round((progressUnits(ws, t) / tot) * 100);
  if (isDone(t)) return 100;
  return partsPct(checklist(t.desc), ws.kids(t.id), ws);
}

export type MilestoneStats = {
  /** Aufgaben insgesamt. */
  total: number;
  /** Davon erledigt. */
  done: number;
  /** Offen; ein manuell auf „erledigt“ gesetzter Milestone hat 0. */
  open: number;
  /** Wurzelaufgaben. */
  count: number;
  /** Status steht auf „erledigt“. */
  isDone: boolean;
  /** Alle Aufgaben sind erledigt – abgeleitet, unabhängig vom Status. */
  tasksDone: boolean;
};

export function milestoneStats(ws: Workspace, m: Milestone): MilestoneStats {
  const roots = ws.msRoots(m);
  const tot = sumBy(roots, (r) => total(ws, r));
  const dn = sumBy(roots, (r) => doneCount(ws, r));
  const done = m.status === 'done';
  return {
    total: tot,
    done: dn,
    open: done ? 0 : tot - dn,
    count: roots.length,
    isDone: done,
    tasksDone: roots.length > 0 && roots.every((r) => allDone(ws, r)),
  };
}

/**
 * Fertig im Sinne von Abhängigkeiten: entweder ausdrücklich auf „erledigt“
 * gesetzt oder alle seine Aufgaben sind erledigt. Wer darauf wartet, wartet
 * dann nicht weiter, nur weil der Status noch nicht umgestellt wurde.
 */
export function milestoneDone(ws: Workspace, m: Milestone): boolean {
  const stats = milestoneStats(ws, m);
  return stats.isDone || stats.tasksDone;
}

export function milestoneProgressPct(ws: Workspace, m: Milestone): number {
  if (m.status === 'done') return 100;
  const roots = ws.msRoots(m);
  const tot = sumBy(roots, (r) => total(ws, r));
  if (tot) return Math.round((sumBy(roots, (r) => progressUnits(ws, r)) / tot) * 100);
  return partsPct(checklist(m.desc), roots, ws);
}

/* --------------------------------------------------------- Segmentbalken */

export type Segment =
  | { kind: 'checklist'; done: boolean }
  | { kind: 'task'; status: Status };

/**
 * Ein Segment je Checklisten-Punkt des Objekts und je Blatt-Aufgabe darunter.
 * Die Sortierung für die Anzeige macht die Oberfläche.
 */
export function statusSegments(ws: Workspace, x: Task | Milestone): Segment[] {
  const { lines, out } = checklistLines(x.desc);
  const segs: Segment[] = out.map((i) => ({
    kind: 'checklist',
    done: ((lines[i] as string).match(CHECK_RE)?.[2] ?? ' ') !== ' ',
  }));

  const walk = (t: Task): void => {
    const kids = ws.kids(t.id);
    if (kids.length) kids.forEach(walk);
    else segs.push({ kind: 'task', status: t.status });
  };

  const roots = isMilestone(x) ? ws.msRoots(x) : ws.kids(x.id);
  roots.forEach(walk);
  return segs;
}

/* ------------------------------------------------------------- Intern */

const isMilestone = (x: Task | Milestone): x is Milestone => 'planned' in x;

export const sumBy = <T>(list: readonly T[], f: (x: T) => number): number =>
  list.reduce((s, x) => s + f(x), 0);

/** Rückfall ohne zählbare Aufgaben: eigene Checkliste plus erledigte Unteraufgaben. */
function partsPct(
  own: { total: number; done: number },
  kids: Task[],
  ws: Workspace,
): number {
  const parts = own.total + kids.length;
  if (!parts) return 0;
  const done = own.done + kids.filter((k) => allDone(ws, k)).length;
  return Math.round((done / parts) * 100);
}
