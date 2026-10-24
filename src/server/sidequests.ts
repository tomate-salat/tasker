import { pickActiveRelease } from '../shared/release.js';
import { effectiveReleases } from '../shared/releaseOf.js';
import type { Status } from '../shared/model.js';
import type { DbCtx } from './db.js';
import { newId } from './ids.js';
import { syncParentStatus } from './repo.js';

/**
 * Nebenquests und der Release-Stempel (Wunsch des Nutzers, 24.10.2026).
 *
 * - Die Nebenquests sind eine besondere Gruppe im Backlog, je Projekt genau
 *   eine (`group.kind = 'sidequest'`). Was darin liegt, ist für ein Release
 *   optional – ein Bonus.
 * - Jede Aufgabe außerhalb von Release-Milestones bekommt den Stempel des
 *   aktiven Releases (`task.released_in`), sobald sie in Arbeit geht oder
 *   erledigt wird; geht sie vor dem Veröffentlichen zurück auf „Offen“ oder
 *   „Bereit“, fällt er wieder weg. In Release-Milestones gilt deren Release,
 *   gestempelt wird dort nicht.
 * - Gibt es kein aktives Release, wird vorgemerkt (`release_pending`) und
 *   nachgestempelt, sobald es eines gibt. Der Bestand von vor den Nebenquests
 *   bleibt ungestempelt.
 * - Beim Veröffentlichen behält Erledigtes den Stempel; Unerledigtes verliert
 *   ihn, geht auf „Bereit“ und – als lose Wurzel – zurück in die Nebenquests.
 */

export const SIDEQUEST_TITLE = 'Nebenquests';

const ACTIVE: Status[] = ['progress', 'done'];
const BACK: Status[] = ['open', 'ready'];

/**
 * Ob die Datenbank die Spalten schon hat. Vor Migration 0022 nicht – das gibt
 * es nur in den Migrationstests, die mit älteren Ständen anlegen.
 */
const known = new WeakMap<DbCtx, boolean>();
function migrated(ctx: DbCtx): boolean {
  let v = known.get(ctx);
  if (v === undefined) {
    v = (ctx.sqlite.prepare('PRAGMA table_info(task)').all() as { name: string }[]).some((c) => c.name === 'released_in');
    // Erst nach der Migration merken – der Test migriert danach weiter.
    if (v) known.set(ctx, v);
  }
  return v;
}

/** Legt jedem Projekt ohne Nebenquests die Gruppe an – beim Start und für neue Projekte. */
export function ensureSidequestGroups(ctx: DbCtx): number {
  if (!migrated(ctx)) return 0;
  const missing = ctx.sqlite
    .prepare(
      `SELECT id FROM project p WHERE NOT EXISTS (
         SELECT 1 FROM "group" g WHERE g.project_id = p.id AND g.kind = 'sidequest')`,
    )
    .all() as { id: string }[];
  const insert = ctx.sqlite.prepare(
    `INSERT INTO "group" (id, project_id, title, sort_order, kind) VALUES (?, ?, ?, 0, 'sidequest')`,
  );
  for (const p of missing) insert.run(newId('g'), p.id, SIDEQUEST_TITLE);
  return missing.length;
}

export function sidequestGroupId(ctx: DbCtx, projectId: string): string {
  const row = ctx.sqlite
    .prepare(`SELECT id FROM "group" WHERE project_id = ? AND kind = 'sidequest'`)
    .get(projectId) as { id: string } | undefined;
  if (row) return row.id;
  ensureSidequestGroups(ctx);
  return sidequestGroupId(ctx, projectId);
}

/** Je Milestone des Projekts das Release, zu dem er zählt – wie überall über `effectiveReleases`. */
function memberships(ctx: DbCtx, projectId: string): Map<string, string> {
  const ms = ctx.sqlite
    .prepare('SELECT id, release_id FROM milestone WHERE project_id = ?')
    .all(projectId) as { id: string; release_id: string | null }[];
  const deps = ctx.sqlite
    .prepare(
      `SELECT d.from_id, d.to_id FROM dependency d JOIN milestone m ON m.id = d.from_id
        WHERE d.kind = 'milestone' AND m.project_id = ?`,
    )
    .all(projectId) as { from_id: string; to_id: string }[];
  const releases = ctx.sqlite
    .prepare('SELECT id, sort_order FROM "release" WHERE project_id = ?')
    .all(projectId) as { id: string; sort_order: number }[];
  return effectiveReleases(
    ms.map((m) => ({
      id: m.id,
      projectId,
      releaseId: m.release_id,
      deps: deps.filter((d) => d.from_id === m.id).map((d) => d.to_id),
    })),
    releases.map((r) => ({ id: r.id, projectId, order: r.sort_order })),
  );
}

export function isPublished(ctx: DbCtx, releaseId: string): boolean {
  const row = ctx.sqlite
    .prepare('SELECT count(*) AS n, count(done_at) AS d FROM release_stage WHERE release_id = ?')
    .get(releaseId) as { n: number; d: number };
  return row.n > 0 && row.n === row.d;
}

/** Das aktive Release des Projekts – nach `pickActiveRelease`, wie in Web-App und Addon. */
export function activeReleaseId(ctx: DbCtx, projectId: string): string | null {
  const member = memberships(ctx, projectId);
  const running = new Set(
    (
      ctx.sqlite
        .prepare(`SELECT id FROM milestone WHERE project_id = ? AND status = 'progress' AND archived_at IS NULL`)
        .all(projectId) as { id: string }[]
    ).flatMap((m) => member.get(m.id) ?? []),
  );
  const releases = ctx.sqlite
    .prepare('SELECT id, sort_order, archived_at FROM "release" WHERE project_id = ?')
    .all(projectId) as { id: string; sort_order: number; archived_at: string | null }[];
  return pickActiveRelease(
    releases.map((r) => ({
      id: r.id,
      order: r.sort_order,
      archived: !!r.archived_at,
      released: isPublished(ctx, r.id),
      running: running.has(r.id),
    })),
  );
}

type Row = {
  id: string;
  project_id: string;
  parent_id: string | null;
  milestone_id: string | null;
  status: Status;
  released_in: string | null;
  release_pending: number;
};

const taskRow = (ctx: DbCtx, id: string): Row | undefined =>
  ctx.sqlite
    .prepare('SELECT id, project_id, parent_id, milestone_id, status, released_in, release_pending FROM task WHERE id = ?')
    .get(id) as Row | undefined;

/** Die Kette nach oben, ohne die Aufgabe selbst, von unten nach oben. */
function ancestors(ctx: DbCtx, t: Row): Row[] {
  const out: Row[] = [];
  const seen = new Set([t.id]);
  for (let p = t.parent_id ? taskRow(ctx, t.parent_id) : undefined; p && !seen.has(p.id); ) {
    out.push(p);
    seen.add(p.id);
    p = p.parent_id ? taskRow(ctx, p.parent_id) : undefined;
  }
  return out;
}

/** Das Release des Milestones, an dem die Wurzel der Aufgabe hängt – `null` ohne. */
function milestoneRelease(ctx: DbCtx, t: Row, member = memberships(ctx, t.project_id)): string | null {
  const root = ancestors(ctx, t).at(-1) ?? t;
  return root.milestone_id ? (member.get(root.milestone_id) ?? null) : null;
}

const setStamp = (ctx: DbCtx, id: string, releaseId: string | null, pending: boolean): void => {
  ctx.sqlite
    .prepare('UPDATE task SET released_in = ?, release_pending = ? WHERE id = ?')
    .run(releaseId, pending ? 1 : 0, id);
};

/**
 * Stempelt die Aufgabe und reicht den Stempel an ungestempelte Vorfahren weiter
 * – sonst fehlte dem Changelog die Aufgabe darüber.
 */
function stampWithParents(ctx: DbCtx, t: Row, releaseId: string | null): void {
  setStamp(ctx, t.id, releaseId, !releaseId);
  for (const p of ancestors(ctx, t)) {
    if (p.released_in || p.release_pending) continue;
    setStamp(ctx, p.id, releaseId, !releaseId);
  }
}

/**
 * Nach einer Statusänderung: Stempel setzen oder zurücknehmen. Wird eine im
 * veröffentlichten Release erledigte Aufgabe wieder bearbeitet, geht sie mit
 * dem aktiven Release neu raus.
 */
export function stampOnStatus(ctx: DbCtx, taskId: string): void {
  if (!migrated(ctx)) return;
  const t = taskRow(ctx, taskId);
  if (!t) return;
  if (milestoneRelease(ctx, t)) {
    if (t.released_in || t.release_pending) setStamp(ctx, t.id, null, false);
    return;
  }
  if (ACTIVE.includes(t.status)) {
    if (t.release_pending) return;
    if (t.released_in && !isPublished(ctx, t.released_in)) {
      // Der Stempel bleibt – aber die Vorfahren brauchen ihn auch.
      stampWithParents(ctx, t, t.released_in);
      return;
    }
    if (t.released_in && t.status === 'done') return;
    stampWithParents(ctx, t, activeReleaseId(ctx, t.project_id));
    return;
  }
  if (
    BACK.includes(t.status) &&
    (t.release_pending || (t.released_in && !isPublished(ctx, t.released_in))) &&
    !workedBelow(ctx, t.id)
  ) {
    setStamp(ctx, t.id, null, false);
  }
}

/** Läuft unter der Aufgabe etwas oder ist erledigt? Dann behält sie ihren Stempel. */
const workedBelow = (ctx: DbCtx, id: string): boolean =>
  !!ctx.sqlite
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM task WHERE parent_id = ?
         UNION ALL
         SELECT t.id FROM task t JOIN sub ON t.parent_id = sub.id
       )
       SELECT 1 FROM task t JOIN sub ON sub.id = t.id
        WHERE t.status IN ('progress', 'done') AND t.archived_at IS NULL LIMIT 1`,
    )
    .get(id);

/**
 * Räumt Stempel auf, die nicht mehr stimmen: offen oder bereit, im noch nicht
 * veröffentlichten Release, und darunter läuft nichts. Das gab es, bevor der
 * Stapel seinen Stempel mit dem Status zurückgab (739a3b7) – beim Start einmal.
 */
export function repairStamps(ctx: DbCtx): number {
  if (!migrated(ctx)) return 0;
  const rows = ctx.sqlite
    .prepare(
      `SELECT id FROM task WHERE status IN ('open', 'ready') AND (released_in IS NOT NULL OR release_pending = 1)`,
    )
    .all() as { id: string }[];
  let n = 0;
  for (const { id } of rows) {
    const before = taskRow(ctx, id);
    stampOnStatus(ctx, id);
    const after = taskRow(ctx, id);
    if (before?.released_in !== after?.released_in || before?.release_pending !== after?.release_pending) n++;
  }
  return n;
}

/**
 * Nach dem Verschieben eines Teilbaums. Neu gestempelt wird dabei nichts –
 * nur nimmt eine Aufgabe, die einen Release-Milestone verlässt, dessen
 * Release als Stempel mit, und in einem Release-Milestone fällt er weg.
 */
export function stampAfterMove(ctx: DbCtx, ids: string[], before: Map<string, string | null>): void {
  if (!migrated(ctx)) return;
  const own = ctx.sqlite.prepare('SELECT 1 FROM "release" WHERE id = ? AND project_id = ?');
  for (const id of ids) {
    const t = taskRow(ctx, id);
    if (!t) continue;
    // Über die Projektgrenze geht kein Stempel mit.
    const foreign = !!t.released_in && !own.get(t.released_in, t.project_id);
    const was = before.get(id);
    if (foreign || milestoneRelease(ctx, t)) {
      if (t.released_in || t.release_pending) setStamp(ctx, id, null, false);
    } else if (!t.released_in && !t.release_pending && ACTIVE.includes(t.status) && was && own.get(was, t.project_id)) {
      setStamp(ctx, id, was, false);
    }
  }
}

/** Das Release, mit dem die Aufgaben vor dem Verschieben rausgingen. */
export function releasesBefore(ctx: DbCtx, ids: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!migrated(ctx)) return out;
  for (const id of ids) {
    const t = taskRow(ctx, id);
    if (t) out.set(id, milestoneRelease(ctx, t) ?? t.released_in);
  }
  return out;
}

/** Stempelt Vorgemerktes nach, sobald das Projekt ein aktives Release hat. */
export function settlePending(ctx: DbCtx, projectId: string): void {
  if (!migrated(ctx)) return;
  const pending = ctx.sqlite
    .prepare('SELECT 1 FROM task WHERE project_id = ? AND release_pending = 1 LIMIT 1')
    .get(projectId);
  if (!pending) return;
  const releaseId = activeReleaseId(ctx, projectId);
  if (!releaseId) return;
  ctx.sqlite
    .prepare('UPDATE task SET released_in = ?, release_pending = 0 WHERE project_id = ? AND release_pending = 1')
    .run(releaseId, projectId);
}

/**
 * Das Release ist veröffentlicht: Erledigtes behält seinen Stempel. Was nicht
 * erledigt ist, verliert ihn; die offenen Blätter gehen auf „Bereit“ (der
 * Status darüber ergibt sich daraus), lose Wurzeln zurück in die Nebenquests.
 * Erledigte Unteraufgaben bleiben beim alten Release.
 */
export function publishRelease(ctx: DbCtx, releaseId: string): void {
  if (!migrated(ctx)) return;
  const release = ctx.sqlite.prepare('SELECT project_id FROM "release" WHERE id = ?').get(releaseId) as
    | { project_id: string }
    | undefined;
  if (!release) return;
  const member = memberships(ctx, release.project_id);
  const rows = (
    ctx.sqlite
      .prepare(
        `SELECT id, project_id, parent_id, milestone_id, status, released_in, release_pending FROM task
          WHERE released_in = ? AND status <> 'done' AND archived_at IS NULL AND hidden_by IS NULL`,
      )
      .all(releaseId) as Row[]
  ).filter((t) => !milestoneRelease(ctx, t, member));
  if (!rows.length) return;

  const stamp = new Date().toISOString();
  const groupId = sidequestGroupId(ctx, release.project_id);
  const hasKids = ctx.sqlite.prepare('SELECT 1 FROM task WHERE parent_id = ? AND archived_at IS NULL LIMIT 1');
  const leaves: string[] = [];
  for (const t of rows) {
    ctx.sqlite
      .prepare('UPDATE task SET released_in = NULL, release_pending = 0, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(stamp, t.id);
    if (!hasKids.get(t.id) && !BACK.includes(t.status)) {
      ctx.sqlite.prepare(`UPDATE task SET status = 'ready', done_at = NULL WHERE id = ?`).run(t.id);
      leaves.push(t.id);
    }
    if (!t.parent_id && !t.milestone_id) {
      const end = ctx.sqlite
        .prepare('SELECT coalesce(max(sort_order), -1) + 1 AS n FROM task WHERE group_id = ? AND parent_id IS NULL')
        .get(groupId) as { n: number };
      ctx.sqlite.prepare('UPDATE task SET group_id = ?, sort_order = ? WHERE id = ?').run(groupId, end.n, t.id);
    }
  }
  for (const id of leaves) syncParentStatus(ctx, id);
}

/**
 * Erledigte Bonus-Aufgaben je Release, die nicht mehr im aktiven Bestand sind –
 * gezählt wie `releaseBonus`: nur Blätter unter den Gestempelten.
 */
export function archivedBonus(ctx: DbCtx): Map<string, number> {
  if (!migrated(ctx)) return new Map();
  const rows = ctx.sqlite
    .prepare(
      `SELECT t.released_in AS release_id, count(*) AS n FROM task t
        WHERE t.released_in IS NOT NULL AND t.status = 'done'
          AND (t.archived_at IS NOT NULL OR t.hidden_by IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM task k WHERE k.parent_id = t.id AND k.released_in = t.released_in)
        GROUP BY t.released_in`,
    )
    .all() as { release_id: string; n: number }[];
  return new Map(rows.map((r) => [r.release_id, r.n]));
}

/**
 * Ein Abdruck aller Stempel eines Projekts – ändert ein Schreibzugriff mehr als
 * den einen Eintrag, laden die anderen Fenster neu.
 */
export function stampSignature(ctx: DbCtx, projectId: string, exceptId = ''): string {
  if (!migrated(ctx)) return '';
  const row = ctx.sqlite
    .prepare(
      `SELECT group_concat(id || ':' || coalesce(released_in, '') || ':' || release_pending || ':' || status, ',') AS s
         FROM (SELECT id, released_in, release_pending, status FROM task
                WHERE project_id = ? AND id <> ? AND (released_in IS NOT NULL OR release_pending = 1)
                ORDER BY id)`,
    )
    .get(projectId, exceptId) as { s: string | null };
  return row.s ?? '';
}

