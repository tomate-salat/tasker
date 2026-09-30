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
  /** In Arbeit: Wurzeln und Unteraufgaben ohne eigene Unteraufgaben, in Baumreihenfolge. */
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
