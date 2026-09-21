import { backfillLog, dayKey, type LogEntry, msPoints, todayEntry } from '../shared/burnup.js';
import { Workspace } from '../shared/workspace.js';
import type { DbCtx } from './db.js';
import { loadBootstrap } from './repo.js';

/**
 * Schreibt das Burnup-Protokoll aller aktiven Milestones fort, wie `logScopes`
 * im Prototyp nach jeder Änderung. Milestones ohne Protokoll bekommen es erst
 * aus den Abschlussdaten nachgetragen.
 *
 * Der Tag ist der Kalendertag in der Zeitzone des Servers (`TZ`).
 */
export function logScopes(ctx: DbCtx, today: string = dayKey(new Date())): void {
  ctx.sqlite.transaction(() => {
    const ws = new Workspace(loadBootstrap(ctx));
    const logs = loadLogs(ctx);
    const put = ctx.sqlite.prepare(
      `INSERT INTO milestone_log (milestone_id, day, scope, done) VALUES (?, ?, ?, ?)
       ON CONFLICT (milestone_id, day) DO UPDATE SET scope = excluded.scope, done = excluded.done`,
    );

    for (const m of ws.milestones) {
      let log = logs[m.id];
      if (!log) {
        log = backfillLog(ws, m, today);
        for (const e of log) put.run(m.id, e.d, e.s, e.dn);
      }
      const { s, dn } = msPoints(ws, m);
      const e = todayEntry(log, s, dn, today);
      if (e) put.run(m.id, e.d, e.s, e.dn);
    }
  })();
}

/** Die Protokolle der aktiven Milestones, je Milestone nach Tag sortiert. */
export function loadLogs(ctx: DbCtx): Record<string, LogEntry[]> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT l.milestone_id AS id, l.day AS d, l.scope AS s, l.done AS dn
       FROM milestone_log l JOIN milestone m ON m.id = l.milestone_id
       WHERE m.archived_at IS NULL ORDER BY l.milestone_id, l.day`,
    )
    .all() as ({ id: string } & LogEntry)[];
  const out: Record<string, LogEntry[]> = {};
  for (const { id, ...e } of rows) (out[id] ??= []).push(e);
  return out;
}
