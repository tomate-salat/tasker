import type { Release } from './model.js';
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
export function releaseStatus(ws: Workspace, r: Release, archivedMilestones = 0): ReleaseStatus {
  const stages = ws.releaseStages(r.id);
  const milestones = ws.releaseMilestones(r.id);
  if (stages.length && stages.every((s) => s.doneAt)) return 'released';
  // Archivierte Milestones kennt der aktive Bestand nicht; wer sie zählt, gibt sie mit – sie gelten als fertig.
  if (milestones.length + archivedMilestones && milestones.every((m) => milestoneDone(ws, m))) return 'ready';
  const begun =
    archivedMilestones > 0 ||
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
