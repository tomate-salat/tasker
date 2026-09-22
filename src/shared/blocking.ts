import { isArchived, type Milestone, type Task, isDone } from './model.js';
import { milestoneDone } from './progress.js';
import type { Workspace } from './workspace.js';

/**
 * Worauf ein Task warten kann: ein anderer Task oder ein ganzer Milestone.
 * Milestones warten dagegen nur auf Milestones.
 */
export type Blocker = Task | Milestone;

export const isMilestone = (x: Blocker): x is Milestone => 'planned' in x;

/** Ein Blocker zählt, solange er weder erledigt noch weggeräumt ist. */
function stillBlocks(ws: Workspace, x: Blocker): boolean {
  if (!isMilestone(x)) return !isDone(x) && ws.isActive(x);
  return !isArchived(x) && !milestoneDone(ws, x);
}

/** Eigene Abhängigkeiten, die tatsächlich noch blockieren. */
export function ownBlockers(ws: Workspace, t: Task): Blocker[] {
  return t.deps
    .map((id) => ws.task(id) ?? ws.milestone(id))
    .filter((d): d is Blocker => d !== null && stillBlocks(ws, d));
}

export type InheritedBlock = {
  /** Blocker von Eltern-Tasks, mit dem Task, über den sie gelten. */
  deps: { blocker: Blocker; via: Task }[];
  /** Erster Elternteil mit Status „blockiert“. */
  statusVia: Task | null;
};

/**
 * Blockierungen der Eltern-Tasks gelten für alle Unteraufgaben mit – abgeleitet,
 * nicht gespeichert. Wird eine Unteraufgabe woanders hingeschoben, fällt die
 * geerbte Blockierung dadurch automatisch weg.
 */
export function inheritedBlock(ws: Workspace, t: Task): InheritedBlock {
  const deps: { blocker: Blocker; via: Task }[] = [];
  let statusVia: Task | null = null;

  for (const a of [...ws.ancestors(t)].reverse()) {
    for (const blocker of ownBlockers(ws, a)) {
      if (blocker.id === t.id) continue;
      if (t.deps.includes(blocker.id)) continue;
      if (deps.some((x) => x.blocker.id === blocker.id)) continue;
      deps.push({ blocker, via: a });
    }
    if (!statusVia && a.status === 'blocked') statusVia = a;
  }

  return { deps, statusVia };
}

export function blockers(ws: Workspace, t: Task): Blocker[] {
  return [...ownBlockers(ws, t), ...inheritedBlock(ws, t).deps.map((x) => x.blocker)];
}

export function isBlocked(ws: Workspace, t: Task): boolean {
  if (t.status === 'blocked') return true;
  if (blockers(ws, t).length > 0) return true;
  return inheritedBlock(ws, t).statusVia !== null;
}

/**
 * Hängt `a` direkt oder über Umwege von `targetId` ab? Wird gebraucht, um beim
 * Setzen einer Abhängigkeit Kreise zu verhindern – für Tasks wie Milestones.
 */
export function dependsOn(
  ws: Workspace,
  a: Task | Milestone,
  targetId: string,
  seen = new Set<string>(),
): boolean {
  if (a.deps.includes(targetId)) return true;
  for (const id of a.deps) {
    if (seen.has(id)) continue;
    seen.add(id);
    const next: Task | Milestone | null = ws.task(id) ?? ws.milestone(id);
    if (next && dependsOn(ws, next, targetId, seen)) return true;
  }
  return false;
}
