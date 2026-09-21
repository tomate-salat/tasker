import { type Milestone, isDone } from './model.js';
import { milestoneStats, sumBy, total } from './progress.js';
import { weeksFromToday } from './schedule.js';
import type { Workspace } from './workspace.js';

/**
 * Burnup wie im Prototyp: je Milestone ein Umfangs-Protokoll mit einem Eintrag
 * pro Tag, an dem sich etwas geändert hat (`m.log`). Hier steht es in der
 * Tabelle `milestone_log`; der Server schreibt es nach jeder Änderung fort.
 */
export type LogEntry = {
  /** 'YYYY-MM-DD' */
  d: string;
  /** Committete Aufgaben an diesem Tag. */
  s: number;
  /** Davon erledigt. */
  dn: number;
};

/** Der Kalendertag in Ortszeit, wie `dayKey` im Prototyp. */
export const dayKey = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Umfang und Erledigtes heute, gezählt wie überall: Aufgaben, nicht Punkte. */
export function msPoints(ws: Workspace, m: Milestone): { s: number; dn: number } {
  const st = milestoneStats(ws, m);
  return { s: st.total, dn: st.done };
}

/**
 * Für Milestones ohne Protokoll: Umfang wie heute, Erledigtes aus den
 * Abschlussdaten der Aufgaben.
 */
export function backfillLog(ws: Workspace, m: Milestone, today: string): LogEntry[] {
  const roots = ws.msRoots(m);
  const s = sumBy(roots, (r) => total(ws, r));
  const ev: { d: string | null; p: number }[] = [];
  const walk = (t: (typeof roots)[number]): void => {
    if (isDone(t)) {
      ev.push({ d: t.doneAt ? dayKey(new Date(t.doneAt)) : null, p: total(ws, t) });
      return;
    }
    ws.kids(t.id).forEach(walk);
  };
  roots.forEach(walk);

  const first = m.startDate ?? today;
  const doneBy = (d: string): number => sumBy(ev.filter((e) => !e.d || e.d <= d), (e) => e.p);
  const dates = [...new Set(ev.map((e) => e.d).filter((d): d is string => !!d && d > first))].sort();
  return [{ d: first, s, dn: doneBy(first) }, ...dates.map((d) => ({ d, s, dn: doneBy(d) }))];
}

/**
 * Der Eintrag für heute, falls sich seit dem letzten etwas geändert hat –
 * sonst `null`. Wie `logScopes` im Prototyp: am selben Tag wird überschrieben.
 */
export function todayEntry(log: LogEntry[], s: number, dn: number, today: string): LogEntry | null {
  const last = log[log.length - 1];
  if (last && last.s === s && last.dn === dn) return null;
  return { d: today, s, dn };
}

/** Das Protokoll samt dem heutigen Stand. */
export function withToday(log: LogEntry[], s: number, dn: number, today: string): LogEntry[] {
  const e = todayEntry(log, s, dn, today);
  if (!e) return log;
  const last = log[log.length - 1];
  return last && last.d === today ? [...log.slice(0, -1), e] : [...log, e];
}

const logAt = (log: LogEntry[], d: string): LogEntry => {
  let v: LogEntry | null = null;
  for (const e of log) {
    if (e.d <= d) v = e;
    else break;
  }
  return v ?? log[0] ?? { d, s: 0, dn: 0 };
};

export type BurnupData = {
  start: string;
  scope: number[];
  doneS: number[];
  s: number;
  dn: number;
  open: number;
  done: boolean;
  todayI: number;
  endI: number;
  /** Prognose: Tag-Index, an dem alles erledigt wäre. */
  fcI: number | null;
  /** Enddatum als Tag-Index. */
  deadI: number | null;
  maxI: number;
  maxV: number;
  added: number;
  removed: number;
};

const DAY = 864e5;
const noon = (iso: string): Date => new Date(`${iso}T12:00:00`);

/** Die Kurve ab dem Startdatum; ohne (oder mit künftigem) Start gibt es keine. */
export function burnupData(
  m: Milestone,
  log: LogEntry[],
  velocity: number,
  now: Date = new Date(),
): BurnupData | null {
  if (!m.startDate || weeksFromToday(m.startDate, now) > 0) return null;
  const start = noon(m.startDate);
  const today = new Date(now);
  today.setHours(12, 0, 0, 0);
  const idx = (d: Date): number => Math.round((d.getTime() - start.getTime()) / DAY);
  const done = m.status === 'done';
  const todayI = Math.max(0, idx(today));
  const endI = done && m.endDate ? Math.max(0, Math.min(todayI, idx(noon(m.endDate)))) : todayI;

  const scope: number[] = [];
  const doneS: number[] = [];
  for (let i = 0; i <= endI; i++) {
    const dt = new Date(start);
    dt.setDate(dt.getDate() + i);
    const e = logAt(log, dayKey(dt));
    scope.push(e.s);
    doneS.push(Math.min(e.dn, e.s));
  }

  const s = scope[endI] ?? 0;
  const dn = doneS[endI] ?? 0;
  const open = Math.max(0, s - dn);
  const fcI = !done && open > 0 ? todayI + (open / Math.max(1, velocity)) * 7 : null;
  const deadI = m.endDate ? idx(noon(m.endDate)) : null;
  const maxI = Math.max(endI, fcI ?? 0, deadI ?? 0, 1);
  const maxV = Math.max(1, ...scope);
  let added = 0;
  let removed = 0;
  for (let i = 1; i < scope.length; i++) {
    const diff = (scope[i] as number) - (scope[i - 1] as number);
    if (diff > 0) added += diff;
    else removed -= diff;
  }
  return { start: m.startDate, scope, doneS, s, dn, open, done, todayI, endI, fcI, deadI, maxI, maxV, added, removed };
}

/**
 * Weiche Kurve durch die Tagespunkte (monotone kubische Interpolation nach
 * Fritsch-Carlson): schießt nie über die Werte hinaus, Plateaus bleiben flach.
 */
export function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  const [x0, y0] = pts[0] as [number, number];
  if (n === 1) return `M${x0},${y0}`;
  const sl: number[] = [];
  const t: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = pts[i] as [number, number];
    const [bx, by] = pts[i + 1] as [number, number];
    sl[i] = (by - ay) / (bx - ax);
  }
  t[0] = sl[0] as number;
  t[n - 1] = sl[n - 2] as number;
  for (let i = 1; i < n - 1; i++) {
    const a = sl[i - 1] as number;
    const b = sl[i] as number;
    t[i] = a * b <= 0 ? 0 : (a + b) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    const si = sl[i] as number;
    if (si === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = (t[i] as number) / si;
    const b = (t[i + 1] as number) / si;
    const q = a * a + b * b;
    if (q > 9) {
      const k = 3 / Math.sqrt(q);
      t[i] = k * a * si;
      t[i + 1] = k * b * si;
    }
  }
  let p = `M${x0},${y0}`;
  for (let i = 0; i < n - 1; i++) {
    const [ax, ay] = pts[i] as [number, number];
    const [bx, by] = pts[i + 1] as [number, number];
    const h = (bx - ax) / 3;
    p += `C${ax + h},${ay + (t[i] as number) * h} ${bx - h},${by - (t[i + 1] as number) * h} ${bx},${by}`;
  }
  return p;
}
