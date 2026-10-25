import { dayKey } from '../shared/burnup.js';
import type { EndChange } from '../shared/model.js';
import { releaseGroups } from '../shared/release.js';
import { dateFromWeeks, schedule, timelineMilestones } from '../shared/schedule.js';
import { Workspace } from '../shared/workspace.js';
import type { DbCtx } from './db.js';
import { loadBootstrap } from './repo.js';
import { getSettings } from './settings.js';

/**
 * Enddaten als Zusagen (Wunsch des Nutzers, Marschplan im Godot-Addon): mit
 * dem Beginn eines Releases wird die Prognose zur Zusage, und was danach am
 * Enddatum eines laufenden Milestones geändert wird, bleibt im Verlauf.
 *
 * Die Kalendertage rechnet hier ausnahmsweise der Server, also in UTC: kurz
 * nach Mitternacht Ortszeit kann ein Tag dazwischen liegen.
 */

type Row = { status: string; end_date: string | null };

const known = new WeakMap<DbCtx, boolean>();

/** Steht Migration 0023 schon? Die Migrations-Tests rufen `patch` auch auf älteren Ständen. */
export function marchReady(ctx: DbCtx): boolean {
  let v = known.get(ctx);
  if (v === undefined) {
    v = (ctx.sqlite.prepare('PRAGMA table_info(milestone)').all() as { name: string }[]).some(
      (c) => c.name === 'end_changes',
    );
    // Erst nach der Migration merken – der Test migriert danach weiter.
    if (v) known.set(ctx, v);
  }
  return v;
}

/**
 * Hält fest, wie ein laufender Milestone sein Enddatum verschoben hat. Vor dem
 * Start ist alles Planung, und das Erledigen selbst ist keine Verschiebung.
 */
export function recordEndChange(ctx: DbCtx, id: string, before: Row, after: Row, at: string): void {
  if (before.status !== 'progress' || after.status !== 'progress') return;
  if (before.end_date === after.end_date) return;
  const row = ctx.sqlite.prepare('SELECT end_changes FROM milestone WHERE id = ?').get(id) as
    | { end_changes: string | null }
    | undefined;
  const list = row?.end_changes ? (JSON.parse(row.end_changes) as EndChange[]) : [];
  list.push({ at, from: before.end_date, to: after.end_date });
  ctx.sqlite.prepare('UPDATE milestone SET end_changes = ? WHERE id = ?').run(JSON.stringify(list), id);
}

/**
 * Beginnt mit diesem Milestone sein Release zum ersten Mal, wird die Prognose
 * festgeschrieben: jeder offene Milestone des Releases ohne Enddatum bekommt
 * seine Prognose als Enddatum (von Hand Gesetztes bleibt), und das Release
 * merkt sich, wann es danach bereit sein sollte – die ✦-Marke im Zeitplan.
 * Gerechnet wird wie im Zeitplan der Web-App.
 */
export function beginRelease(ctx: DbCtx, milestoneId: string, today: Date = new Date()): void {
  const ws = new Workspace(loadBootstrap(ctx));
  const m = ws.milestone(milestoneId);
  const release = m ? ws.releaseOf(m) : null;
  if (!release || release.readyPlanned !== null || release.archivedAt !== null) return;

  const { velocity } = getSettings(ctx);
  const { list } = schedule(ws, { velocity, today, milestones: timelineMilestones(ws) });
  const group = releaseGroups(ws, list).find((g) => g.release?.id === release.id);
  if (!group) return;

  const day = (weeks: number): string => dayKey(dateFromWeeks(weeks, today));
  const setEnd = ctx.sqlite.prepare(
    'UPDATE milestone SET end_date = ?, end_auto = 0, version = version + 1, updated_at = ? WHERE id = ?',
  );
  const now = today.toISOString();
  for (const x of group.rows) {
    if (x.isDone || x.milestone.endDate !== null) continue;
    setEnd.run(day(x.forecastEnd), now, x.milestone.id);
  }
  ctx.sqlite
    .prepare('UPDATE "release" SET ready_planned = ?, version = version + 1, updated_at = ? WHERE id = ?')
    .run(day(group.end), now, release.id);
}

/** Enddaten und Bereit-Daten eines Projekts – ändert sich das mit, laden die anderen Fenster neu. */
export function endSignature(ctx: DbCtx, projectId: string, exceptId = ''): string {
  if (!marchReady(ctx)) return '';
  const row = ctx.sqlite
    .prepare(
      `SELECT coalesce((SELECT group_concat(id || ':' || coalesce(end_date, ''), ',') FROM
                (SELECT id, end_date FROM milestone WHERE project_id = ? AND id <> ? ORDER BY id)), '')
           || '|' ||
              coalesce((SELECT group_concat(id || ':' || coalesce(ready_planned, ''), ',') FROM
                (SELECT id, ready_planned FROM "release" WHERE project_id = ? ORDER BY id)), '') AS s`,
    )
    .get(projectId, exceptId, projectId) as { s: string | null };
  return row.s ?? '';
}
