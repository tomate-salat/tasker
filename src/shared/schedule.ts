import { type Milestone, isDone } from './model.js';
import { milestoneStats, type MilestoneStats } from './progress.js';
import type { Workspace } from './workspace.js';

/** Wochen zwischen heute und einem Datum; negativ heißt Vergangenheit. */
export function weeksFromToday(iso: string, today: Date = new Date()): number {
  const target = new Date(`${iso}T12:00:00`);
  const base = new Date(today);
  base.setHours(12, 0, 0, 0);
  return (target.getTime() - base.getTime()) / (7 * 864e5);
}

/** Die Umkehrung: das Datum, das `weeks` Wochen von heute entfernt liegt. */
export function dateFromWeeks(weeks: number, today: Date = new Date()): Date {
  const d = new Date(today);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d;
}

/** Kalenderwoche nach ISO 8601 – die Beschriftung der Zeitachse. */
export function isoWeek(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // Auf den Donnerstag derselben Woche schieben; dessen Jahr zählt.
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  const jan1 = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
  return Math.ceil(((x.getTime() - jan1.getTime()) / 864e5 + 1) / 7);
}

export type ScheduledMilestone = MilestoneStats & {
  milestone: Milestone;
  /** Milestones, auf die gewartet wird – eigene und über Task-Abhängigkeiten gefundene. */
  deps: string[];
  /** Start in Wochen ab heute. */
  start: number;
  /** Ende in Wochen ab heute – bei festem Enddatum dieses, sonst die Prognose. */
  end: number;
  /** Ende nach reiner Rechnung: Start plus offene Aufgaben durch Tempo. */
  forecastEnd: number;
  /** Startdatum ist von Hand gesetzt. */
  fixed: boolean;
  /** Enddatum ist von Hand gesetzt. */
  fixedEnd: boolean;
  /** Startet trotz Abhängigkeit früher, als diese es erlauben würde. */
  early: boolean;
  /** Die Prognose läuft über das gesetzte Enddatum hinaus. */
  late: boolean;
  /** Position in der Reihenfolge, beginnend bei 1. */
  pos: number;
};

export type Schedule = {
  list: ScheduledMilestone[];
  byId: Map<string, ScheduledMilestone>;
};

export type ScheduleOptions = {
  /** Aufgaben pro Woche. */
  velocity: number;
  today?: Date;
};

/**
 * Reiht die eingeplanten Milestones je Projekt nacheinander auf und rechnet aus, wann sie
 * beim eingestellten Tempo fertig werden.
 *
 * Abhängigkeiten kommen aus zwei Quellen: direkt zwischen Milestones und
 * indirekt über Aufgaben, die auf Aufgaben eines anderen Milestones warten.
 */
export function schedule(ws: Workspace, options: ScheduleOptions): Schedule {
  const velocity = Math.max(1, options.velocity || 1);
  const today = options.today ?? new Date();
  const planned = ws.plannedMilestones();
  const byId = new Map<string, ScheduledMilestone>();

  for (const m of planned) {
    const stats = milestoneStats(ws, m);
    const deps = new Set(
      m.deps.filter((id) => {
        const other = ws.milestone(id);
        return other !== null && other.planned && !milestoneStats(ws, other).isDone;
      }),
    );

    // Wartet eine Aufgabe dieses Milestones auf eine Aufgabe aus einem anderen,
    // wartet der ganze Milestone mit.
    for (const root of ws.msRoots(m)) {
      for (const task of [root, ...ws.desc(root)]) {
        for (const depId of task.deps) {
          const dep = ws.task(depId);
          if (!dep || isDone(dep)) continue;
          const other = ws.milestoneOf(dep);
          if (other && other.id !== m.id && other.planned) deps.add(other.id);
        }
      }
    }

    byId.set(m.id, {
      ...stats,
      milestone: m,
      deps: [...deps],
      start: 0,
      end: 0,
      forecastEnd: 0,
      fixed: false,
      fixedEnd: false,
      early: false,
      late: false,
      pos: 0,
    });
  }

  const pending = [...planned];
  const list: ScheduledMilestone[] = [];
  // Jedes Projekt hat seine eigene Reihe (Wunsch des Nutzers, im Prototyp lief
  // alles in einer): Projekte verschieben sich nicht gegenseitig. Nur eine
  // ausdrücklich gesetzte Abhängigkeit wirkt über die Projektgrenze.
  const cursors = new Map<string, number>();

  while (pending.length) {
    // Als Nächstes der erste, dessen Abhängigkeiten schon eingeplant sind.
    // Bei einem Kreis greift der Rückfall auf den ersten Eintrag.
    let i = pending.findIndex((m) =>
      (byId.get(m.id)?.deps ?? []).every((d) => !pending.some((p) => p.id === d)),
    );
    if (i < 0) i = 0;

    const m = pending.splice(i, 1)[0] as Milestone;
    const x = byId.get(m.id) as ScheduledMilestone;
    const depEnd = Math.max(0, ...x.deps.map((d) => byId.get(d)?.end ?? 0));
    const cursor = cursors.get(m.projectId) ?? 0;

    x.fixed = m.startDate !== null;
    x.fixedEnd = m.endDate !== null;
    // Mit Startdatum beginnt der Balken dort; ohne nach dem vorherigen
    // Milestone beziehungsweise nach den Abhängigkeiten.
    x.start = m.startDate !== null ? weeksFromToday(m.startDate, today) : Math.max(cursor, depEnd);
    x.early = x.fixed && x.deps.length > 0 && x.start < depEnd - 1e-6;
    // Liegt der Start in der Vergangenheit, wird die Restarbeit ab heute gerechnet.
    x.forecastEnd = Math.max(x.start, 0) + x.open / velocity;
    x.end = m.endDate !== null ? weeksFromToday(m.endDate, today) : x.forecastEnd;
    if (x.fixedEnd && !x.fixed) x.start = Math.min(x.start, x.end);
    x.late = !x.isDone && x.fixedEnd && x.forecastEnd > x.end + 1e-6;

    cursors.set(m.projectId, Math.max(cursor, x.isDone ? x.end : Math.max(x.end, x.forecastEnd)));
    x.pos = list.length + 1;
    list.push(x);
  }

  return { list, byId };
}
