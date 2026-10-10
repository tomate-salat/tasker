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
  /**
   * Wie viele aktive Milestones des Projekts sich gerade das Tempo teilen,
   * dieser eingeschlossen – 0, wenn er selbst nicht dazugehört.
   */
  sharing: number;
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
 *
 * Sind in einem Projekt mehrere Milestones „In Progress“, teilen sie sich das
 * Tempo (Wunsch des Nutzers) – siehe `sharedFinish`. Was noch nicht begonnen
 * hat, fängt erst an, wenn die aktiven durch sind: bis dahin ist das Tempo
 * vergeben.
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
          // Wartet die Aufgabe direkt auf einen Milestone, wartet auch dieser hier.
          const depMs = ws.milestone(depId);
          if (depMs) {
            if (depMs.id !== m.id && depMs.planned && !milestoneStats(ws, depMs).isDone) {
              deps.add(depMs.id);
            }
            continue;
          }
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
      sharing: 0,
    });
  }

  // Je Projekt: wann jeder aktive Milestone bei geteiltem Tempo fertig ist.
  const active = new Map<string, ScheduledMilestone[]>();
  for (const m of planned) {
    const x = byId.get(m.id) as ScheduledMilestone;
    const begun = m.startDate === null || weeksFromToday(m.startDate, today) <= 0;
    if (m.status !== 'progress' || !x.open || !begun) continue;
    const list = active.get(m.projectId);
    if (list) list.push(x);
    else active.set(m.projectId, [x]);
  }
  const shared = new Map<string, number>();
  const busyUntil = new Map<string, number>();
  for (const [projectId, list] of active) {
    const finish = sharedFinish(list.map((x) => x.open), velocity);
    list.forEach((x, i) => {
      shared.set(x.milestone.id, finish[i] as number);
      x.sharing = list.length;
    });
    busyUntil.set(projectId, Math.max(...finish));
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
    const share = shared.get(m.id);
    // Was noch nicht läuft, wartet auf die aktiven Milestones des Projekts.
    const cursor = cursors.get(m.projectId) ?? (share === undefined ? (busyUntil.get(m.projectId) ?? 0) : 0);

    x.fixed = m.startDate !== null;
    x.fixedEnd = m.endDate !== null;
    // Mit Startdatum beginnt der Balken dort; ohne nach dem vorherigen
    // Milestone beziehungsweise nach den Abhängigkeiten.
    x.start = m.startDate !== null ? weeksFromToday(m.startDate, today) : Math.max(cursor, depEnd);
    x.early = x.fixed && x.deps.length > 0 && x.start < depEnd - 1e-6;
    // Liegt der Start in der Vergangenheit, wird die Restarbeit ab heute gerechnet.
    x.forecastEnd = Math.max(x.start, 0) + (share ?? x.open / velocity);
    x.end = m.endDate !== null ? weeksFromToday(m.endDate, today) : x.forecastEnd;
    if (x.fixedEnd && !x.fixed) x.start = Math.min(x.start, x.end);
    x.late = !x.isDone && x.fixedEnd && x.forecastEnd > x.end + 1e-6;

    cursors.set(
      m.projectId,
      Math.max(cursor, busyUntil.get(m.projectId) ?? 0, x.isDone ? x.end : Math.max(x.end, x.forecastEnd)),
    );
    x.pos = list.length + 1;
    list.push(x);
  }

  return { list, byId };
}

/**
 * Wann mehrere gleichzeitig laufende Milestones fertig sind, in Wochen ab
 * heute: sie teilen sich das Tempo zu gleichen Teilen, und wird einer fertig,
 * geht sein Anteil an die übrigen. Der letzte ist damit genau dann fertig, wenn
 * alle offenen Aufgaben zusammen durch das Tempo geteilt aufgehen – nur die
 * einzelnen Enden davor hängen an der Annahme der gleichen Teile.
 */
export function sharedFinish(open: number[], velocity: number): number[] {
  const order = open.map((_, i) => i).sort((a, b) => (open[a] as number) - (open[b] as number));
  const out = new Array<number>(open.length).fill(0);
  let t = 0;
  let level = 0;
  order.forEach((i, k) => {
    // Bis hierher haben alle noch laufenden gleich viel geschafft – `level` je Milestone.
    t += (((open[i] as number) - level) * (open.length - k)) / velocity;
    level = open[i] as number;
    out[i] = t;
  });
  return out;
}
