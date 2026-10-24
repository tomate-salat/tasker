import { isArchived, type Release, type Task } from './model.js';
import { milestoneDone } from './progress.js';
import type { ScheduledMilestone } from './schedule.js';
import type { Workspace } from './workspace.js';

/**
 * Wo ein Release steht. Gespeichert wird das nicht: es ergibt sich aus seinen
 * Milestones und den Kanälen (siehe PHASE-2.md, „Releases“).
 */
export type ReleaseStatus = 'planned' | 'progress' | 'ready' | 'released';

export const RELEASE_STATUS_LABEL: Record<ReleaseStatus, string> = {
  planned: 'Geplant',
  progress: 'In Arbeit',
  ready: 'Bereit',
  released: 'Veröffentlicht',
};

/**
 * Veröffentlicht ist ein Release, wenn alle Kanäle abgehakt sind; bereit, wenn
 * alle Milestones fertig sind. In Arbeit ist es, sobald irgendetwas begonnen
 * hat – ein Milestone oder schon ein Kanal.
 */
export function releaseStatus(ws: Workspace, r: Release): ReleaseStatus {
  const stages = ws.releaseStages(r.id);
  const milestones = ws.releaseMilestones(r.id);
  // Archivierte Milestones bringt das Release mit (`archivedMilestones`); sie gelten als fertig.
  const archivedMilestones = r.archivedMilestones.length;
  if (stages.length && stages.every((s) => s.doneAt)) return 'released';
  if (milestones.length + archivedMilestones && milestones.every((m) => milestoneDone(ws, m))) return 'ready';
  const begun =
    archivedMilestones > 0 ||
    r.archivedBonus > 0 ||
    ws.tasks.some((t) => t.releasedIn === r.id) ||
    stages.some((s) => s.doneAt) ||
    milestones.some((m) => m.status === 'progress' || milestoneDone(ws, m));
  return begun ? 'progress' : 'planned';
}

/** Die eingeplanten Milestones eines Releases im Zeitplan – oder die eines Projekts ohne Release. */
export type ReleaseGroup = {
  projectId: string;
  /** `null`: die Milestones des Projekts, die zu keinem Release gehören. */
  release: Release | null;
  rows: ScheduledMilestone[];
  /** Vom frühesten Start bis zum spätesten Ende, in Wochen ab heute. */
  start: number;
  /** Das Ende des letzten Milestones – läuft einer über sein Enddatum, dessen Prognose. */
  end: number;
  done: boolean;
};

/**
 * Gruppiert den Zeitplan nach Release (siehe PHASE-2.md, „Releases“). Die
 * Gruppen stehen in der Reihenfolge, in der ihr erster Milestone im Plan
 * kommt; was zu keinem Release gehört, steht je Projekt am Schluss. Gerechnet
 * wird dabei nichts neu – die Zeiten kommen aus `schedule()`.
 */
export function releaseGroups(ws: Workspace, list: ScheduledMilestone[]): ReleaseGroup[] {
  const groups = new Map<string, ReleaseGroup>();
  for (const x of list) {
    const m = x.milestone;
    const release = ws.releaseOf(m);
    const key = `${m.projectId}:${release?.id ?? ''}`;
    const end = x.late ? Math.max(x.end, x.forecastEnd) : x.end;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { projectId: m.projectId, release, rows: [x], start: x.start, end, done: x.isDone });
      continue;
    }
    g.rows.push(x);
    g.start = Math.min(g.start, x.start);
    g.end = Math.max(g.end, end);
    g.done = g.done && x.isDone;
  }
  const all = [...groups.values()];
  const projects = [...new Set(all.map((g) => g.projectId))];
  return projects.flatMap((p) => {
    const own = all.filter((g) => g.projectId === p);
    return [...own.filter((g) => g.release), ...own.filter((g) => !g.release)];
  });
}

/** „0.4.0 · Zirkus-Update“ – was davon da ist. */
export const releaseLabel = (r: Pick<Release, 'name' | 'title'>): string =>
  [r.name, r.title].filter(Boolean).join(' · ') || 'Ohne Version';

/**
 * Wohin ein im Plan angelegter Milestone kommt – im Plan steht nur, was zu
 * einem Release zählt: das oberste aktive Release des Projekts, wie es im
 * Reiter „Releases“ zuoberst steht.
 */
export const planRelease = (ws: Workspace, projectId: string): Release | null =>
  ws.releases
    .filter((r) => r.projectId === projectId && !isArchived(r))
    .sort((a, b) => b.order - a.order)[0] ?? null;

/* ---------------------------------------------------------- Nebenquests */

/** Was zum Bestimmen des aktiven Releases über ein Release bekannt sein muss. */
export type ReleaseCandidate = {
  id: string;
  order: number;
  archived: boolean;
  /** Alle Kanäle abgehakt (und mindestens einer da) – wie `releaseStatus` 'released'. */
  released: boolean;
  /** Ein Milestone des Releases – auch über Abhängigkeiten mitgezählt – steht auf „In Progress“. */
  running: boolean;
};

/**
 * Das aktive Release eines Projekts: dafür stempelt der Server (Wunsch des
 * Nutzers, Nebenquests). Server, Web-App und Godot-Addon wählen gleich: unter
 * den nicht archivierten, nicht veröffentlichten Releases – nach `order`
 * aufsteigend, bei Gleichstand nach ID – das erste mit laufendem Milestone,
 * sonst das erste überhaupt, auch eines ganz ohne Milestones.
 */
export function pickActiveRelease(list: ReleaseCandidate[]): string | null {
  const open = list
    .filter((r) => !r.archived && !r.released)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  return (open.find((r) => r.running) ?? open[0])?.id ?? null;
}

export function activeRelease(ws: Workspace, projectId: string): Release | null {
  const list = ws.releases
    .filter((r) => r.projectId === projectId)
    .map((r) => {
      const stages = ws.releaseStages(r.id);
      return {
        id: r.id,
        order: r.order,
        archived: isArchived(r),
        released: stages.length > 0 && stages.every((s) => s.doneAt),
        running: ws.releaseMilestones(r.id).some((m) => m.status === 'progress'),
      };
    });
  return ws.release(pickActiveRelease(list));
}

/**
 * Mit welchem Release eine Aufgabe rausgeht: liegt sie in einem Milestone mit
 * Release, mit dessen; sonst mit dem, das sie gestempelt hat (`releasedIn`).
 */
export function taskRelease(ws: Workspace, t: Task): string | null {
  const m = ws.milestoneOf(t);
  return (m && ws.releaseOf(m)?.id) || t.releasedIn;
}

/** Bonus: gestempelt, aber in keinem Release-Milestone – zählt nicht für „bereit“. */
export const isBonus = (ws: Workspace, t: Task): boolean => {
  const m = ws.milestoneOf(t);
  return !!t.releasedIn && !(m && ws.releaseOf(m));
};

/**
 * Die Bonus-Aufgaben eines Releases im aktiven Bestand, gezählt wie der
 * Fortschritt: nur Blätter, also Aufgaben ohne gestempelte Unteraufgaben.
 * Archiviertes zählt hier nicht mit – das bringt das Release mit (`archivedBonus`).
 */
export function releaseBonus(ws: Workspace, r: Release): { done: number; open: number; tasks: Task[] } {
  const tasks = ws.tasks.filter((t) => t.releasedIn === r.id && !isArchived(t) && isBonus(ws, t));
  const stamped = new Set(tasks.map((t) => t.id));
  const leaves = tasks.filter((t) => !ws.kids(t.id).some((k) => stamped.has(k.id)));
  const done = leaves.filter((t) => t.status === 'done').length;
  return { done, open: leaves.length - done, tasks };
}
