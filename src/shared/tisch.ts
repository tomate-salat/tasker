import { isBlocked } from './blocking.js';
import { checklist } from './checklist.js';
import { isArchived, isDone, type Milestone, type Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Der „Tisch“ (Wunsch des Nutzers): die Arbeit am aktiven Milestone als
 * Kartenspiel. Aktiv ist ein Milestone mit Status „In Progress“ – je Projekt
 * höchstens einer. Die Zonen ergeben sich aus Status und Abhängigkeiten, nichts
 * davon wird eigens gespeichert.
 */

/**
 * Die Milestones eines Projekts auf „In Progress“, eingeplante zuerst in
 * Plan-Reihenfolge. Normal ist es höchstens einer; mehrere kann es nur aus der
 * Zeit vor der Regel geben (oder durch Wiederherstellen aus Archiv und Papierkorb).
 */
export function activeMilestones(ws: Workspace, projectId: string): Milestone[] {
  return ws.milestones
    .filter((m) => m.projectId === projectId && m.status === 'progress' && !isArchived(m))
    .sort((a, b) => Number(b.planned) - Number(a.planned) || (a.planned ? a.qorder - b.qorder : a.order - b.order));
}

/** Der aktive Milestone des Projekts – bei mehreren der oberste im Plan. */
export const activeMilestone = (ws: Workspace, projectId: string): Milestone | null =>
  activeMilestones(ws, projectId)[0] ?? null;

/** Ein anderer aktiver Milestone im selben Projekt – solange es ihn gibt, bleibt „In Progress“ für `m` gesperrt. */
export const progressLockedBy = (ws: Workspace, m: Milestone): Milestone | null =>
  activeMilestones(ws, m.projectId).find((x) => x.id !== m.id) ?? null;

export type TischLayout = {
  /** Wurzelaufgaben mit offenen Voraussetzungen oder Status „Blockiert“ – Stapel wie einzelne. */
  locked: Task[];
  /** Offene und unklare Wurzelaufgaben, dazu alle nicht erledigten Stapel. */
  open: Task[];
  /** In Arbeit: Wurzeln und Unteraufgaben ohne eigene Unteraufgaben, von Hand sortiert. */
  play: Task[];
  /** Erledigtes jeder Ebene, das zuletzt Erledigte zuerst. */
  pile: Task[];
};

/**
 * Wohin jede Karte gehört:
 *
 * - Ein Task mit Unteraufgaben ist ein **Stapel**. Er kommt nie ins Spiel –
 *   dort liegt nur die Arbeit selbst, also Unteraufgaben ohne eigene Kinder.
 *   Gesperrt liegt er oben, sonst in der Mitte, auch wenn darunter schon
 *   gearbeitet wird.
 * - „In Progress“ geht vor „gesperrt“: was schon läuft, liegt im Spiel.
 * - Gesperrte Unteraufgaben bleiben in ihrer Schublade und stehen nicht
 *   zusätzlich oben – das zeigt die Oberfläche.
 */
export function tischLayout(ws: Workspace, m: Milestone): TischLayout {
  const out: TischLayout = { locked: [], open: [], play: [], pile: [] };
  for (const root of ws.msRoots(m)) {
    if (ws.isDoc(root)) continue;
    const all = [root, ...ws.desc(root)];
    for (const t of all) if (isDone(t)) out.pile.push(t);
    // In Arbeit sind nur Blätter, Stapel nie.
    for (const t of all) {
      if (t.status === 'progress' && !ws.kids(t.id).length && !doneAbove(ws, t, root)) out.play.push(t);
    }
    if (isDone(root) || (root.status === 'progress' && !ws.kids(root.id).length)) continue;
    (isBlocked(ws, root) ? out.locked : out.open).push(root);
  }
  // Im Spiel wird von Hand sortiert (`playOrder`); bei Gleichstand bleibt die Baumreihenfolge.
  out.play.sort((a, b) => a.playOrder - b.playOrder);
  // Ohne Zeitpunkt ist es gerade eben erledigt worden (die Oberfläche setzt den
  // Status vor der Antwort des Servers) – das gehört obenauf, nicht ans Ende.
  const at = (t: Task): string => t.doneAt ?? '￿';
  out.pile.sort((a, b) => at(b).localeCompare(at(a)));
  return out;
}

/** Liegt ein erledigter Elternteil darüber? Dann ist die Karte mit ihm abgelegt. */
function doneAbove(ws: Workspace, t: Task, root: Task): boolean {
  if (t.id === root.id) return false;
  return ws.ancestors(t).some(isDone);
}

/** Warum eine Karte nicht ins Spiel darf – `null` heißt: sie darf. */
export function playRefusal(ws: Workspace, t: Task): string | null {
  if (isDone(t)) return null;
  if (ws.kids(t.id).length) return 'Ein Stapel kommt nicht ins Spiel – spiel seine Unteraufgaben aus';
  if (isBlocked(ws, t)) return 'Die Karte ist noch angekettet';
  return null;
}

/** Warum eine Karte nicht auf den Stapel darf – dieselbe Regel wie im Inspektor. */
export function doneRefusal(ws: Workspace, t: Task): string | null {
  const cl = checklist(t.desc);
  const open = ws.kids(t.id).filter((k) => !isDone(k)).length + cl.total - cl.done;
  return open ? `Erst erledigt, wenn alles darunter erledigt ist – noch ${open} offen` : null;
}

/** Ein Stapel, dessen Unteraufgaben alle erledigt sind – er wartet aufs Ablegen. */
export const stackReady = (ws: Workspace, t: Task): boolean =>
  !isDone(t) && ws.kids(t.id).length > 0 && doneRefusal(ws, t) === null;

/* ------------------------------------------------------------ Ablage */

/**
 * Der aufgedeckte Erledigt-Stapel (Wunsch des Nutzers, nach Codecks): was im
 * Milestone erledigt wurde, je Woche. Wochen laufen von Montag bis Sonntag in
 * der Zeitzone des Geräts – der Server kennt nur UTC.
 */
export type DoneWeek = {
  /** Der Montag der Woche, `YYYY-MM-DD`. */
  start: string;
  /** Erledigtes jeder Ebene, das zuletzt Erledigte zuerst – auch schon Archiviertes. */
  cards: Task[];
  /** Was fürs Wochenziel zählt: nur Karten ohne Unteraufgaben, wie beim Fortschritt. */
  count: number;
  current: boolean;
  /** Die Woche mit den meisten Karten – erst ab zwei Wochen, bei Gleichstand die jüngere. */
  best: boolean;
};

export type DoneShelf = {
  /** Die jüngste Woche zuerst; Wochen ohne Erledigtes fehlen. */
  weeks: DoneWeek[];
  /** Wochen in Folge mit mindestens einer Karte. Die laufende Woche bricht die Serie nicht, solange sie läuft. */
  streak: number;
  /** Karten fürs Wochenziel in der laufenden Woche. */
  thisWeek: number;
};

const day = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Der Montag der Woche, in der `d` liegt – in der Zeitzone des Geräts. */
export const weekStart = (d: Date): string =>
  day(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));

/** Der Montag `weeks` Wochen vor diesem Montag. */
function weeksBefore(start: string, weeks: number): string {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  return day(new Date(y, m - 1, d - 7 * weeks));
}

export function doneShelf(ws: Workspace, m: Milestone, now: Date = new Date()): DoneShelf {
  // Erledigt Archiviertes bleibt liegen – sonst schrumpften alte Wochen beim Aufräumen.
  const done: Task[] = [];
  const walk = (t: Task): void => {
    if (isDone(t)) done.push(t);
    for (const k of ws.countedKids(t.id)) walk(k);
  };
  for (const root of ws.msCounted(m)) if (!root.doc) walk(root);

  // Ohne Zeitpunkt ist es gerade eben erledigt worden – siehe `tischLayout`.
  const at = (t: Task): number => (t.doneAt ? new Date(t.doneAt).getTime() : now.getTime());
  done.sort((a, b) => at(b) - at(a));

  const thisStart = weekStart(now);
  const byStart = new Map<string, DoneWeek>();
  for (const t of done) {
    const start = weekStart(new Date(at(t)));
    let week = byStart.get(start);
    if (!week) byStart.set(start, (week = { start, cards: [], count: 0, current: start === thisStart, best: false }));
    week.cards.push(t);
    if (!ws.countedKids(t.id).length) week.count++;
  }
  const weeks = [...byStart.values()].sort((a, b) => b.start.localeCompare(a.start));

  const most = Math.max(0, ...weeks.map((w) => w.count));
  const best = weeks.length > 1 && most > 0 ? weeks.find((w) => w.count === most) : undefined;
  if (best) best.best = true;

  const counts = (start: string): number => byStart.get(start)?.count ?? 0;
  let from = counts(thisStart) ? 0 : 1;
  let streak = 0;
  while (counts(weeksBefore(thisStart, from++))) streak++;

  return { weeks, streak, thisWeek: counts(thisStart) };
}
