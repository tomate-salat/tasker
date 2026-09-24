import { backfillLog, type LogEntry, msPoints, nextEntry, type Points } from '../shared/burnup.js';
import { Workspace } from '../shared/workspace.js';
import type { DbCtx } from './db.js';
import { loadAllTasks, loadBootstrap } from './repo.js';

/**
 * Der Bestand, wie der Burnup ihn braucht: aktive Milestones, aber alle
 * Aufgaben – erledigte archivierte zählen weiter (siehe `msPoints`).
 */
function burnupWorkspace(ctx: DbCtx): Workspace {
  return new Workspace({ ...loadBootstrap(ctx), tasks: loadAllTasks(ctx) });
}

/**
 * Schreibt das Burnup-Protokoll aller aktiven Milestones fort, wie `logScopes`
 * im Prototyp nach jeder Änderung. Milestones ohne Protokoll bekommen es erst
 * aus den Abschlusszeitpunkten nachgetragen.
 *
 * Der Server rechnet nur mit Zeitpunkten in UTC; Kalendertage bildet der Client.
 */
export function logScopes(ctx: DbCtx, at: string = new Date().toISOString()): void {
  ctx.sqlite.transaction(() => {
    const ws = burnupWorkspace(ctx);
    const logs = loadLogs(ctx);
    const put = ctx.sqlite.prepare(
      'INSERT OR REPLACE INTO milestone_log (milestone_id, at, scope, done) VALUES (?, ?, ?, ?)',
    );

    for (const m of ws.milestones) {
      let log = logs[m.id];
      if (!log) {
        log = backfillLog(ws, m);
        for (const e of log) put.run(m.id, e.at, e.s, e.dn);
      }
      const { s, dn } = msPoints(ws, m);
      const e = nextEntry(log, s, dn, at);
      if (e) put.run(m.id, e.at, e.s, e.dn);
    }
  })();
}

/**
 * Der Anteil archivierter Aufgaben am Burnup je aktivem Milestone. Der Client
 * kennt nur den aktiven Bestand und rechnet den heutigen Stand selbst; das
 * hier legt er drauf. Milestones ohne archivierten Anteil fehlen.
 */
export function archivedPoints(ctx: DbCtx): Record<string, Points> {
  const full = burnupWorkspace(ctx);
  const active = new Workspace(loadBootstrap(ctx));
  const out: Record<string, Points> = {};
  for (const m of full.milestones) {
    const a = msPoints(full, m);
    const b = msPoints(active, m);
    if (a.s !== b.s || a.dn !== b.dn) out[m.id] = { s: a.s - b.s, dn: a.dn - b.dn };
  }
  return out;
}

/** Die Protokolle der aktiven Milestones, je Milestone zeitlich sortiert. */
export function loadLogs(ctx: DbCtx): Record<string, LogEntry[]> {
  const rows = ctx.sqlite
    .prepare(
      `SELECT l.milestone_id AS id, l.at AS at, l.scope AS s, l.done AS dn
       FROM milestone_log l JOIN milestone m ON m.id = l.milestone_id
       WHERE m.archived_at IS NULL ORDER BY l.milestone_id, l.at`,
    )
    .all() as ({ id: string } & LogEntry)[];
  const out: Record<string, LogEntry[]> = {};
  for (const { id, ...e } of rows) (out[id] ??= []).push(e);
  return out;
}
