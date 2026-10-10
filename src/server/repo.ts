import type {
  Category,
  Data,
  Group,
  Mark,
  Milestone,
  Prio,
  Project,
  Release,
  ReleaseHeading,
  ReleaseStage,
  Status,
  Task,
} from '../shared/model.js';
import type {
  BulkAction,
  BulkItem,
  Kind,
  Step,
  Stub,
  TrashRow as TrashRowData,
  Undoable,
} from '../shared/api.js';
import type { ChangelogData } from '../shared/changelog.js';
import { convertibleItems, convertibleSections, replaceItems } from '../shared/checklist.js';
import { parentStatusAfter } from '../shared/parentStatus.js';
import { refsIn, type RefStub } from '../shared/refs.js';
import type { DbCtx } from './db.js';
import { loadDrawingMeta, type DrawingMeta } from './drawings.js';
import { purgeImagesFor, untrashImage } from './images.js';
import { newId, type IdPrefix } from './ids.js';

/* ============================================================ Lesen */

export type Bootstrap = Data & {
  /** Verweise auf archivierte Objekte, nur Titel – siehe PHASE-2.md, Abschnitt 4. */
  stubs: Stub[];
  /** Ziele von Verweisen im Text ($142), die nicht im aktiven Bestand sind. */
  refStubs: RefStub[];
  /** Anzahl archivierter Einträge je Projekt, für die Anzeige am Archiv-Tab. */
  archiveCounts: Record<string, number>;
  /** Nur die Namen der Zeichnungen; die Szenen holt der Editor einzeln. */
  drawings: DrawingMeta[];
};

/** Nur aktives Material: das Archiv wird bei Bedarf gesondert geladen. */
const ACTIVE_TASK = 't.hidden_by IS NULL AND t.archived_at IS NULL';

export function loadBootstrap(ctx: DbCtx): Bootstrap {
  const all = <T>(sql: string, ...p: unknown[]): T[] => ctx.sqlite.prepare(sql).all(...p) as T[];

  const projects = all<ProjectRow>('SELECT * FROM project ORDER BY sort_order');
  const categories = all<CategoryRow>('SELECT * FROM category ORDER BY sort_order');
  const marks = all<MarkRow>('SELECT * FROM mark ORDER BY sort_order');
  const groups = all<GroupRow>('SELECT * FROM "group" ORDER BY sort_order');
  const milestones = all<MilestoneRow>(
    'SELECT * FROM milestone WHERE archived_at IS NULL ORDER BY sort_order',
  );
  const releases = all<ReleaseRow>('SELECT * FROM "release" ORDER BY sort_order');
  const stages = all<StageRow>('SELECT * FROM release_stage ORDER BY sort_order');
  const headings = all<HeadingRow>('SELECT * FROM release_heading ORDER BY sort_order');
  const tasks = all<TaskRow>(
    `SELECT t.* FROM task t WHERE ${ACTIVE_TASK} ORDER BY t.sort_order, t.id`,
  );

  // Labels und Abhängigkeiten nur für das, was wir auch ausliefern.
  const tagRows = all<{ task_id: string; tag: string }>(
    `SELECT tt.task_id, tt.tag FROM task_tag tt JOIN task t ON t.id = tt.task_id
     WHERE ${ACTIVE_TASK} ORDER BY tt.tag`,
  );
  const taskDeps = all<{ from_id: string; to_id: string }>(
    `SELECT d.from_id, d.to_id FROM dependency d JOIN task t ON t.id = d.from_id
     WHERE d.kind = 'task' AND ${ACTIVE_TASK}`,
  );
  const msDeps = all<{ from_id: string; to_id: string }>(
    `SELECT d.from_id, d.to_id FROM dependency d JOIN milestone m ON m.id = d.from_id
     WHERE d.kind = 'milestone' AND m.archived_at IS NULL`,
  );

  // Zeigt eine aktive Abhängigkeit ins Archiv, kommt nur der Titel mit.
  const stubs = [
    ...all<{ id: string; title: string }>(
      `SELECT DISTINCT x.id, x.title FROM dependency d JOIN task x ON x.id = d.to_id
       JOIN task t ON t.id = d.from_id
       WHERE d.kind = 'task' AND ${ACTIVE_TASK}
         AND (x.hidden_by IS NOT NULL OR x.archived_at IS NOT NULL)`,
    ),
    ...all<{ id: string; title: string }>(
      `SELECT DISTINCT x.id, x.title FROM dependency d JOIN milestone x ON x.id = d.to_id
       JOIN milestone m ON m.id = d.from_id
       WHERE d.kind = 'milestone' AND m.archived_at IS NULL AND x.archived_at IS NOT NULL`,
    ),
    // Ein Task kann auch auf einen Milestone warten.
    ...all<{ id: string; title: string }>(
      `SELECT DISTINCT x.id, x.title FROM dependency d JOIN milestone x ON x.id = d.to_id
       JOIN task t ON t.id = d.from_id
       WHERE d.kind = 'task' AND ${ACTIVE_TASK} AND x.archived_at IS NOT NULL`,
    ),
  ].map((r) => ({ ...r, archived: true as const }));

  // Verweise im Text ($142) auf Archiviertes: Titel und Kennung kommen mit.
  const activeRefs = new Set([...tasks.map((t) => t.ref), ...milestones.map((m) => m.ref)]);
  const missing = [
    ...new Set([...tasks, ...milestones].flatMap((x) => refsIn(x.desc))),
  ].filter((r) => !activeRefs.has(r));
  const inList = missing.map(() => '?').join(',');
  const refStubs: RefStub[] = missing.length
    ? all<RefStub>(
        `SELECT id, ref, title, 'task' AS kind FROM task WHERE ref IN (${inList})
         UNION ALL
         SELECT id, ref, title, 'milestone' AS kind FROM milestone WHERE ref IN (${inList})`,
        ...missing,
        ...missing,
      )
    : [];

  const archiveCounts: Record<string, number> = {};
  for (const r of all<{ project_id: string; c: number }>(
    `SELECT project_id, count(*) AS c FROM (
       SELECT project_id FROM task WHERE archived_at IS NOT NULL
       UNION ALL
       SELECT project_id FROM milestone WHERE archived_at IS NOT NULL
     ) GROUP BY project_id`,
  )) {
    archiveCounts[r.project_id] = r.c;
  }

  const tagsOf = groupValues(tagRows, (r) => r.task_id, (r) => r.tag);
  const depsOfTask = groupValues(taskDeps, (r) => r.from_id, (r) => r.to_id);
  const depsOfMs = groupValues(msDeps, (r) => r.from_id, (r) => r.to_id);

  return {
    projects: projects.map(toProject),
    categories: categories.map(toCategory),
    marks: marks.map(toMark),
    groups: groups.map(toGroup),
    milestones: milestones.map((m) => toMilestone(m, depsOfMs.get(m.id) ?? [])),
    releases: releases.map(toRelease),
    stages: stages.map(toStage),
    headings: headings.map(toHeading),
    tasks: tasks.map((t) => toTask(t, tagsOf.get(t.id) ?? [], depsOfTask.get(t.id) ?? [])),
    archivedTasks: loadArchivedInPlace(ctx),
    stubs,
    refStubs,
    archiveCounts,
    drawings: loadDrawingMeta(ctx),
  };
}

/**
 * Einzeln archivierte Aufgaben, deren Ort – Elternaufgabe oder Milestone –
 * noch aktiv ist, samt allem darunter. Sie zählen und stehen weiter unter
 * ihrem Ort (siehe `Workspace.countedKids`). Ohne Labels und Abhängigkeiten.
 */
function loadArchivedInPlace(ctx: DbCtx): Task[] {
  const rows = ctx.sqlite
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM task
         WHERE archived_at IS NOT NULL AND hidden_by IS NULL
           AND (parent_id IS NOT NULL OR milestone_id IS NOT NULL)
         UNION ALL
         SELECT t.id FROM task t JOIN sub ON t.parent_id = sub.id
       )
       SELECT t.* FROM task t JOIN sub ON sub.id = t.id ORDER BY t.sort_order`,
    )
    .all() as TaskRow[];
  return rows.map((t) => toTask(t, [], []));
}

/**
 * Woraus das Changelog eines Releases entsteht: seine Milestones und alle
 * Aufgaben darunter – auch archivierte. Erledigtes wird hier regelmäßig
 * archiviert und gehört trotzdem ins Changelog, deshalb reicht der aktive
 * Bestand aus `loadBootstrap` dafür nicht.
 */
export function loadChangelog(ctx: DbCtx, releaseId: string): ChangelogData {
  if (!readRow(ctx, 'release', releaseId)) throw new NotFound();
  const milestones = ctx.sqlite
    .prepare(
      `SELECT id, ref, title, status, archived_at FROM milestone
        WHERE release_id = ? ORDER BY queue_order, id`,
    )
    .all(releaseId) as { id: string; ref: number; title: string; status: Status; archived_at: string | null }[];
  const tasks = ctx.sqlite
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT t.id FROM task t JOIN milestone m ON m.id = t.milestone_id
          WHERE m.release_id = ? AND t.parent_id IS NULL
         UNION
         SELECT t.id FROM task t JOIN sub ON t.parent_id = sub.id
       )
       SELECT t.* FROM task t JOIN sub ON sub.id = t.id ORDER BY t.sort_order, t.id`,
    )
    .all(releaseId) as TaskRow[];
  return {
    milestones: milestones.map((m) => ({
      id: m.id, ref: m.ref, title: m.title, status: m.status, archived: !!m.archived_at,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      ref: t.ref,
      version: t.version,
      parentId: t.parent_id,
      milestoneId: t.milestone_id,
      title: t.title,
      status: t.status as Status,
      changelog: t.changelog ?? '',
      changelogSkip: !!t.changelog_skip,
      changelogOrder: t.changelog_order ?? 0,
      archived: !!t.archived_at || !!t.hidden_by,
    })),
  };
}

/** Ob ein Objekt zum aktiven Bestand gehört, den `loadBootstrap` ausliefert. */
export function inBootstrap(ctx: DbCtx, kind: Kind, id: string): boolean {
  const row = readRow(ctx, kind, id);
  if (!row) return false;
  if (kind === 'task') return !row['archived_at'] && !row['hidden_by'];
  if (kind === 'milestone') return !row['archived_at'];
  return true;
}

export type ArchiveEntry = {
  kind: 'task' | 'milestone';
  id: string;
  projectId: string;
  title: string;
  archivedAt: string;
  /** Für die Herkunft („aus „Eltern““, „aus ◆ Milestone“) – der Ort kann selbst archiviert sein. */
  parentTitle: string | null;
  milestoneTitle: string | null;
};

export type ArchivePage = {
  entries: ArchiveEntry[];
  total: number;
  /**
   * Die archivierten Einträge der Seite samt allem, was darunter hängt – für
   * das Aufklappen und den Inspektor, wie im Prototyp.
   */
  tasks: Task[];
  milestones: Milestone[];
};

/** Das Archiv, seitenweise – wird erst beim Öffnen der Archivansicht geholt. */
export function loadArchive(
  ctx: DbCtx,
  o: { q?: string | undefined; projectId?: string | undefined; limit: number; offset: number },
): ArchivePage {
  const like = `%${(o.q ?? '').toLowerCase()}%`;
  const where = `
    WHERE archived_at IS NOT NULL
      AND (:q = '' OR lower(title) LIKE :like)
      AND (:pid IS NULL OR project_id = :pid)`;
  const params = { q: o.q ?? '', like, pid: o.projectId ?? null };

  const sql = (select: string) => `
    SELECT ${select} FROM (
      SELECT 'task' AS kind, id, project_id, title, archived_at FROM task ${where}
      UNION ALL
      SELECT 'milestone' AS kind, id, project_id, title, archived_at FROM milestone ${where}
    )`;

  const total = (
    ctx.sqlite.prepare(sql('count(*) AS c')).get(params) as { c: number }
  ).c;

  const rows = ctx.sqlite
    .prepare(`${sql('*')} ORDER BY archived_at DESC LIMIT :limit OFFSET :offset`)
    .all({ ...params, limit: o.limit, offset: o.offset }) as {
    kind: 'task' | 'milestone';
    id: string;
    project_id: string;
    title: string;
    archived_at: string;
  }[];

  const taskIds = rows.filter((r) => r.kind === 'task').map((r) => r.id);
  const msIds = rows.filter((r) => r.kind === 'milestone').map((r) => r.id);
  const all = <T>(sql: string, ...p: unknown[]): T[] => ctx.sqlite.prepare(sql).all(...p) as T[];

  // Die Einträge, bei Milestones ihre Wurzelaufgaben, und darunter alles.
  const subtree = `
    WITH RECURSIVE sub(id) AS (
      SELECT id FROM task
       WHERE id IN (SELECT value FROM json_each(?))
          OR (parent_id IS NULL AND milestone_id IN (SELECT value FROM json_each(?)))
      UNION
      SELECT t.id FROM task t JOIN sub ON t.parent_id = sub.id
    ) SELECT id FROM sub`;
  const ids = [JSON.stringify(taskIds), JSON.stringify(msIds)];

  const tasks = all<TaskRow>(`SELECT * FROM task WHERE id IN (${subtree}) ORDER BY sort_order`, ...ids);
  const tagsOf = groupValues(
    all<{ task_id: string; tag: string }>(
      `SELECT task_id, tag FROM task_tag WHERE task_id IN (${subtree}) ORDER BY tag`,
      ...ids,
    ),
    (r) => r.task_id,
    (r) => r.tag,
  );
  const depsOfTask = groupValues(
    all<{ from_id: string; to_id: string }>(
      `SELECT from_id, to_id FROM dependency WHERE kind = 'task' AND from_id IN (${subtree})`,
      ...ids,
    ),
    (r) => r.from_id,
    (r) => r.to_id,
  );
  const milestones = all<MilestoneRow>(
    'SELECT * FROM milestone WHERE id IN (SELECT value FROM json_each(?))',
    JSON.stringify(msIds),
  );
  const depsOfMs = groupValues(
    all<{ from_id: string; to_id: string }>(
      `SELECT from_id, to_id FROM dependency
        WHERE kind = 'milestone' AND from_id IN (SELECT value FROM json_each(?))`,
      JSON.stringify(msIds),
    ),
    (r) => r.from_id,
    (r) => r.to_id,
  );

  const titleOf = (table: string, id: string | null): string | null =>
    id
      ? ((ctx.sqlite.prepare(`SELECT title FROM ${table} WHERE id = ?`).get(id) as
          | { title: string }
          | undefined)?.title ?? null)
      : null;
  const byId = new Map(tasks.map((t) => [t.id, t]));

  return {
    total,
    entries: rows.map((r) => {
      const t = r.kind === 'task' ? byId.get(r.id) : undefined;
      return {
        kind: r.kind,
        id: r.id,
        projectId: r.project_id,
        title: r.title,
        archivedAt: r.archived_at,
        parentTitle: titleOf('task', t?.parent_id ?? null),
        milestoneTitle: titleOf('milestone', t?.milestone_id ?? null),
      };
    }),
    tasks: tasks.map((t) => toTask(t, tagsOf.get(t.id) ?? [], depsOfTask.get(t.id) ?? [])),
    milestones: milestones.map((m) => toMilestone(m, depsOfMs.get(m.id) ?? [])),
  };
}

/* =========================================================== Schreiben */

export class Conflict extends Error {
  constructor(readonly current: unknown) {
    super('Version ist veraltet');
  }
}

export class NotFound extends Error {
  constructor() {
    super('Nicht gefunden');
  }
}

const TABLE: Record<Kind, string> = {
  project: 'project',
  category: 'category',
  mark: 'mark',
  group: '"group"',
  release: '"release"',
  stage: 'release_stage',
  heading: 'release_heading',
  milestone: 'milestone',
  task: 'task',
};

const PREFIX: Record<Kind, IdPrefix> = {
  project: 'p',
  category: 'c',
  mark: 'k',
  group: 'g',
  release: 'r',
  stage: 's',
  heading: 'h',
  milestone: 'm',
  task: 't',
};

/** Spaltennamen zu den Feldern des Datenmodells. */
const COLUMN: Record<string, string> = {
  projectId: 'project_id',
  parentId: 'parent_id',
  milestoneId: 'milestone_id',
  groupId: 'group_id',
  releaseId: 'release_id',
  categoryId: 'category_id',
  markId: 'mark_id',
  coverImageId: 'cover_image_id',
  playOrder: 'play_order',
  changelogSkip: 'changelog_skip',
  changelogOrder: 'changelog_order',
  order: 'sort_order',
  qorder: 'queue_order',
  startDate: 'start_date',
  endDate: 'end_date',
  endAuto: 'end_auto',
  archivedAt: 'archived_at',
  hiddenBy: 'hidden_by',
  doneAt: 'done_at',
};
const col = (field: string): string => COLUMN[field] ?? field;

const nowIso = (): string => new Date().toISOString();

/** Die Markierungen, mit denen ein neues Projekt anfängt – wie im Prototyp. */
const DEFAULT_MARKS = [
  ['🐞', 'Bug'],
  ['🛠️', 'Refactoring'],
] as const;

/**
 * Markierungen gehören zu einem Projekt. Hängt an einem Task eine aus einem
 * anderen (weil er dorthin gewandert ist), nimmt er die gleichnamige seines
 * Projekts – gibt es keine, wird sie dort angelegt, damit nichts verloren geht.
 */
function adoptMarks(ctx: DbCtx, taskIds: string[]): void {
  const find = ctx.sqlite.prepare(
    'SELECT t.project_id AS task_project, m.* FROM task t JOIN mark m ON m.id = t.mark_id WHERE t.id = ?',
  );
  for (const id of taskIds) {
    const row = find.get(id) as (MarkRow & { task_project: string }) | undefined;
    // Ohne `project_id` an der Markierung (Stand vor Migration 0014) gibt es nichts anzupassen.
    if (!row?.project_id || row.project_id === row.task_project) continue;
    const same = ctx.sqlite
      .prepare('SELECT id FROM mark WHERE project_id = ? AND lower(name) = lower(?) ORDER BY sort_order LIMIT 1')
      .get(row.task_project, row.name) as { id: string } | undefined;
    const markId =
      same?.id ?? (create(ctx, 'mark', { projectId: row.task_project, emoji: row.emoji, name: row.name }) as Mark).id;
    ctx.sqlite.prepare('UPDATE task SET mark_id = ? WHERE id = ?').run(markId, id);
  }
}

export function create(ctx: DbCtx, kind: Kind, input: Record<string, unknown>): unknown {
  return ctx.sqlite.transaction(() => {
    const id = newId(PREFIX[kind]);
    // Labels und Abhängigkeiten sind keine Spalten, sondern eigene Tabellen.
    const { tags, deps, ...rest } = input;
    const values: Record<string, unknown> = { id, ...rest };

    values['order'] = nextOrder(ctx, kind, input);
    // Ohne eigene Wahl bekommt jedes Projekt reihum eine Farbe aus der Palette.
    if (kind === 'project' && !values['color']) {
      values['color'] = PROJECT_COLORS[(values['order'] as number) % PROJECT_COLORS.length];
    }
    if (kind === 'milestone') values['qorder'] = values['order'];
    if (kind === 'task' && values['parentId']) {
      // Ein Kind hängt nie zusätzlich an Milestone oder Gruppe.
      values['milestoneId'] = null;
      values['groupId'] = null;
      // Liegt der neue Elternteil im Archiv, ist das Kind ebenfalls verdeckt.
      values['hiddenBy'] = hiderForParent(ctx, values['parentId'] as string);
    }
    if (kind === 'task' && !values['parentId'] && values['milestoneId']) {
      values['hiddenBy'] = archivedMilestone(ctx, values['milestoneId'] as string);
    }
    // „Ready“ gibt es nur für lose Wurzeln.
    if (kind === 'task' && (values['parentId'] || values['milestoneId'] || values['groupId'] || values['doc'])) {
      delete values['ready'];
    }
    if (kind === 'task' && values['status'] === 'progress') {
      values['playOrder'] = nextPlayOrder(ctx, String(values['projectId']));
    }

    const fields = Object.keys(values).filter((k) => values[k] !== undefined);
    ctx.sqlite
      .prepare(
        `INSERT INTO ${TABLE[kind]} (${fields.map(col).join(',')})
         VALUES (${fields.map((f) => `:${f}`).join(',')})`,
      )
      .run(Object.fromEntries(fields.map((f) => [f, toSql(values[f])])));

    if (kind === 'task' && Array.isArray(tags)) setTags(ctx, id, tags as string[]);
    if ((kind === 'task' || kind === 'milestone') && Array.isArray(deps)) {
      setDeps(ctx, kind, id, deps as string[]);
    }
    if (kind === 'task' && values['status'] === 'done') {
      ctx.sqlite.prepare('UPDATE task SET done_at = ? WHERE id = ?').run(nowIso(), id);
    }
    if (kind === 'task') adoptMarks(ctx, [id]);
    // Jedes Projekt ist für seine Markierungen selbst zuständig, fängt aber mit
    // denselben zwei an wie der Prototyp.
    if (kind === 'project') {
      for (const [emoji, name] of DEFAULT_MARKS) create(ctx, 'mark', { projectId: id, emoji, name });
    }
    // Ein neues Release fängt mit den Kanälen des vorherigen im Projekt an, noch nicht abgehakt.
    if (kind === 'release') {
      const names = ctx.sqlite
        .prepare(
          `SELECT s.name FROM release_stage s WHERE s.release_id = (
             SELECT id FROM "release" WHERE project_id = ? AND id <> ?
              ORDER BY sort_order DESC LIMIT 1
           ) ORDER BY s.sort_order`,
        )
        .all(values['projectId'], id) as { name: string }[];
      for (const { name } of names) create(ctx, 'stage', { releaseId: id, name });
    }

    return read(ctx, kind, id);
  })();
}

export function patch(
  ctx: DbCtx,
  kind: Kind,
  id: string,
  version: number,
  changes: Record<string, unknown>,
): unknown {
  return ctx.sqlite.transaction(() => {
    const current = readRow(ctx, kind, id);
    if (!current) throw new NotFound();
    if (current['version'] !== version) throw new Conflict(read(ctx, kind, id));

    const { tags, deps, ...fields } = changes;

    if (kind === 'milestone') {
      const projectId = (fields['projectId'] as string | undefined) ?? (current['project_id'] as string);
      if (typeof fields['releaseId'] === 'string') {
        // Ein Release sammelt nur Milestones seines eigenen Projekts.
        const release = readRow(ctx, 'release', fields['releaseId']);
        if (!release) throw new Error('Dieses Release gibt es nicht mehr');
        if (release['project_id'] !== projectId) {
          throw new Error('Das Release gehört zu einem anderen Projekt');
        }
      } else if (projectId !== current['project_id'] && fields['releaseId'] === undefined) {
        // Beim Projektwechsel bleibt das Release zurück.
        fields['releaseId'] = null;
      }
    }

    // Ein neuer Eintrag fürs Changelog reiht sich in der Liste hinten ein – außer der Platz kommt mit.
    if (
      kind === 'task' &&
      typeof fields['changelog'] === 'string' &&
      fields['changelog'].trim() &&
      !String(current['changelog'] ?? '').trim() &&
      fields['changelogOrder'] === undefined
    ) {
      fields['changelogOrder'] = nextChangelogOrder(ctx, String(current['project_id']));
    }

    // Wer ins Spiel kommt, reiht sich auf dem Tisch hinten ein – außer der Platz kommt mit.
    if (
      kind === 'task' &&
      fields['status'] === 'progress' &&
      current['status'] !== 'progress' &&
      fields['playOrder'] === undefined
    ) {
      fields['playOrder'] = nextPlayOrder(ctx, String(current['project_id']));
    }

    if (Object.keys(fields).length) {
      const names = Object.keys(fields);
      ctx.sqlite
        .prepare(
          `UPDATE ${TABLE[kind]} SET ${names.map((f) => `${col(f)} = :${f}`).join(', ')},
             updated_at = :updatedAt, version = version + 1 WHERE id = :id`,
        )
        .run({
          ...Object.fromEntries(names.map((f) => [f, toSql(fields[f])])),
          updatedAt: nowIso(),
          id,
        });
    } else {
      bump(ctx, kind, id);
    }

    if (kind === 'task' && Array.isArray(tags)) setTags(ctx, id, tags as string[]);
    if ((kind === 'task' || kind === 'milestone') && Array.isArray(deps)) {
      setDeps(ctx, kind, id, deps as string[]);
    }
    if (kind === 'task' && typeof fields['markId'] === 'string') adoptMarks(ctx, [id]);

    // Ein Milestone nimmt beim Projektwechsel seine Wurzelaufgaben mit – sonst
    // hinge er in einem Projekt und seine Aufgaben in einem anderen.
    if (kind === 'milestone' && typeof fields['projectId'] === 'string') {
      const target = fields['projectId'];
      for (const rootId of milestoneRoots(ctx, id)) {
        const ids = [rootId, ...descendantIds(ctx, rootId)];
        ctx.sqlite
          .prepare(`UPDATE task SET project_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
          .run(target, ...ids);
        adoptMarks(ctx, ids);
      }
    }

    // „Erledigt“ führt den Zeitpunkt mit, damit Burnup und Archiv ihn haben.
    if (kind === 'task' && typeof fields['status'] === 'string') {
      const doneAt = fields['status'] === 'done' ? (current['done_at'] ?? nowIso()) : null;
      ctx.sqlite.prepare('UPDATE task SET done_at = ? WHERE id = ?').run(doneAt, id);
      if (fields['status'] !== current['status']) syncParentStatus(ctx, id);
    }

    return read(ctx, kind, id);
  })();
}

/**
 * Der nächste freie Platz im Changelog – hinter allen Einträgen und
 * Überschriften des Projekts. Je Projekt statt je Release: so bleibt ein
 * Eintrag hinten, auch wenn sein Milestone das Release wechselt.
 */
const nextChangelogOrder = (ctx: DbCtx, projectId: string): number =>
  (
    ctx.sqlite
      .prepare(
        `SELECT COALESCE(MAX(n), 0) + 1 AS n FROM (
           SELECT MAX(changelog_order) AS n FROM task WHERE project_id = ?
           UNION ALL
           SELECT MAX(h.sort_order) FROM release_heading h JOIN "release" r ON r.id = h.release_id
            WHERE r.project_id = ?
         )`,
      )
      .get(projectId, projectId) as { n: number }
  ).n;

/** Der nächste freie Platz in „Im Spiel“ – hinter allem, was im Projekt je dort lag. */
const nextPlayOrder = (ctx: DbCtx, projectId: string): number =>
  (
    ctx.sqlite
      .prepare('SELECT COALESCE(MAX(play_order), 0) + 1 AS n FROM task WHERE project_id = ?')
      .get(projectId) as { n: number }
  ).n;

/**
 * Zieht den Status der Eltern-Aufgaben nach, nachdem sich der von `childId`
 * geändert hat – die Regel steht in `parentStatusAfter`. Ändert sich ein
 * Elternteil, gilt dasselbe für dessen Elternteil.
 */
function syncParentStatus(ctx: DbCtx, childId: string): void {
  let child = readRow(ctx, 'task', childId);
  while (child?.['parent_id']) {
    const parent = readRow(ctx, 'task', child['parent_id'] as string);
    if (!parent || Number(parent['doc'])) return;
    const kids = ctx.sqlite
      .prepare('SELECT status FROM task WHERE parent_id = ? AND archived_at IS NULL')
      .all(parent['id']) as { status: Status }[];
    const next = parentStatusAfter(
      parent['status'] as Status,
      child['status'] as Status,
      kids.map((k) => k.status),
    );
    if (!next) return;
    // Ohne neue Version: sonst scheiterten Mehrfachauswahl und Rückgängig, die
    // Eltern- und Unteraufgabe im selben Zug mit ihren alten Versionen ändern.
    ctx.sqlite
      .prepare('UPDATE task SET status = ?, done_at = ?, updated_at = ? WHERE id = ?')
      .run(next, next === 'done' ? (parent['done_at'] ?? nowIso()) : null, nowIso(), parent['id']);
    child = readRow(ctx, 'task', parent['id'] as string);
  }
}

/* ------------------------------------------------- Archivieren & Verschieben */

/**
 * Archivieren setzt das Datum am Eintrag selbst und markiert den Teilbaum als
 * verdeckt – aber nur dort, wo noch nichts steht: ein zuvor für sich
 * archiviertes Kind behält seinen eigenen Bezug.
 */
export function archive(ctx: DbCtx, kind: 'task' | 'milestone', id: string): unknown {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, kind, id);
    if (!row) throw new NotFound();
    if (row['archived_at']) return read(ctx, kind, id);

    ctx.sqlite
      .prepare(`UPDATE ${TABLE[kind]} SET archived_at = ?, updated_at = ?, version = version + 1
                WHERE id = ?`)
      .run(nowIso(), nowIso(), id);

    const roots = kind === 'task' ? [id] : milestoneRoots(ctx, id);

    for (const rootId of roots) {
      const subtree = descendantIds(ctx, rootId);
      // Der Milestone verdeckt auch seine Wurzelaufgaben, ein Task nur seine Kinder.
      const ids = kind === 'milestone' ? [rootId, ...subtree] : subtree;
      hideAll(ctx, ids, id);
    }

    return read(ctx, kind, id);
  })();
}

/**
 * Holt aus dem Archiv zurück. Wie im Prototyp (`restore`):
 * - Liegt der alte Ort selbst im Archiv, kommt die Aufgabe lose in den Backlog
 *   („Unsortiert“, ans Ende) – sonst bliebe sie unsichtbar. `moved` sagt das.
 * - `toEnd`: ein Milestone reiht sich hinten ein. Das gilt beim Zurückholen
 *   aus der Archivansicht, nicht beim Rückgängigmachen eines Archivierens.
 */
export function restore(
  ctx: DbCtx,
  kind: 'task' | 'milestone',
  id: string,
  o: { toEnd?: boolean } = {},
): Record<string, unknown> & { moved?: true } {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, kind, id);
    if (!row) throw new NotFound();

    ctx.sqlite
      .prepare(`UPDATE ${TABLE[kind]} SET archived_at = NULL, updated_at = ?, version = version + 1
                WHERE id = ?`)
      .run(nowIso(), id);
    // Alles, was nur wegen dieses Eintrags verdeckt war, wird wieder sichtbar.
    ctx.sqlite.prepare('UPDATE task SET hidden_by = NULL WHERE hidden_by = ?').run(id);

    if (kind === 'milestone' && o.toEnd) milestoneToEnd(ctx, id);

    let moved = false;
    if (kind === 'task' && row['hidden_by']) {
      const order = nextOrder(ctx, 'task', { projectId: row['project_id'] });
      ctx.sqlite
        .prepare(
          `UPDATE task SET parent_id = NULL, milestone_id = NULL, group_id = NULL, hidden_by = NULL,
                           sort_order = ? WHERE id = ?`,
        )
        .run(order, id);
      moved = true;
    }

    const result = read(ctx, kind, id) as Record<string, unknown>;
    return moved ? { ...result, moved: true as const } : result;
  })();
}

export type MoveTarget = {
  parentId?: string | null | undefined;
  milestoneId?: string | null | undefined;
  groupId?: string | null | undefined;
  /** Nur für lose Wurzeln: entscheidet über die smarte Gruppe. Fehlt es, bleibt die Markierung. */
  markId?: string | null | undefined;
  /** Nur für lose Wurzeln: Backlog oder „Ready“. Fehlt es, bleibt es, wie es war. */
  ready?: boolean | undefined;
  /** Für die Kategorie-Gruppen in „Ready“. Fehlt es, bleibt die Kategorie. */
  categoryId?: string | null | undefined;
  /** Fällt ein, wenn das Ziel kein eigenes Projekt hat (Unsortiert, smarte Gruppe). */
  projectId?: string | undefined;
  /** In die Dokumentation oder heraus. Fehlt es, bleibt die Aufgabe, was sie ist. */
  doc?: boolean | undefined;
  order?: number | undefined;
  /** Platz unter den künftigen Geschwistern; danach wird lückenlos neu nummeriert. */
  index?: number | undefined;
};

/** Verschiebt eine Aufgabe und zieht `hidden_by` für ihren Teilbaum nach. */
export function move(ctx: DbCtx, id: string, version: number, target: MoveTarget): unknown {
  return ctx.sqlite.transaction(() => {
    const current = readRow(ctx, 'task', id);
    if (!current) throw new NotFound();
    if (current['version'] !== version) throw new Conflict(read(ctx, 'task', id));

    const parentId = target.parentId ?? null;
    const milestoneId = parentId ? null : (target.milestoneId ?? null);
    const groupId = parentId || milestoneId ? null : (target.groupId ?? null);
    if (parentId && descendantIds(ctx, id).includes(parentId)) {
      throw new Error('Eine Aufgabe kann nicht unter ihre eigene Unteraufgabe wandern');
    }

    // Das Projekt des Ziels gilt für den ganzen Teilbaum.
    const projectId =
      targetProject(ctx, { parentId, milestoneId, groupId, projectId: target.projectId }) ??
      current['project_id'];
    // Markierung und Dokumentations-Kennzeichen werden nur angefasst, wenn sie
    // ausdrücklich mitgeschickt wurden.
    const markId = target.markId === undefined ? current['mark_id'] : target.markId;
    const categoryId = target.categoryId === undefined ? current['category_id'] : target.categoryId;
    const doc = target.doc === undefined ? (Number(current['doc']) ? 1 : 0) : target.doc ? 1 : 0;
    // „Ready“ gibt es nur für lose Wurzeln; wer in einen Behälter wandert, verliert es.
    const loose = !parentId && !milestoneId && !groupId && !doc;
    const ready = loose && (target.ready ?? !!Number(current['ready'])) ? 1 : 0;

    ctx.sqlite
      .prepare(
        `UPDATE task SET parent_id = ?, milestone_id = ?, group_id = ?, project_id = ?,
           mark_id = ?, category_id = ?, ready = ?, doc = ?, sort_order = ?, updated_at = ?,
           version = version + 1 WHERE id = ?`,
      )
      .run(
        parentId,
        milestoneId,
        groupId,
        projectId,
        markId,
        categoryId,
        ready,
        doc,
        target.order ?? current['sort_order'],
        nowIso(),
        id,
      );

    const subtree = descendantIds(ctx, id);
    if (subtree.length) {
      ctx.sqlite
        .prepare(
          `UPDATE task SET project_id = ? WHERE id IN (${subtree.map(() => '?').join(',')})`,
        )
        .run(projectId, ...subtree);
    }
    adoptMarks(ctx, [id, ...subtree]);

    if (target.index !== undefined) {
      reorder(
        ctx,
        {
          parentId,
          milestoneId,
          groupId,
          projectId: String(projectId),
          markId: (markId as string | null) ?? null,
          categoryId: (categoryId as string | null) ?? null,
          ready,
          doc,
        },
        id,
        target.index,
      );
    }
    refreshHidden(ctx, id);
    return read(ctx, 'task', id);
  })();
}

/**
 * Nummeriert die Geschwister im Zielbehälter lückenlos neu und setzt die
 * verschobene Aufgabe auf den gewünschten Platz. Ganzzahlige Ordnungswerte
 * bleiben damit ganzzahlig – kein Bruchrechnen, das irgendwann zu fein wird.
 */
function reorder(ctx: DbCtx, where: Container, movedId: string, index: number): void {
  const siblings = placeAt(ctx, containerIds(ctx, where), [movedId], index);
  const set = ctx.sqlite.prepare('UPDATE task SET sort_order = ? WHERE id = ?');
  siblings.forEach((sid, i) => set.run(i, sid));
}

/**
 * Setzt `moved` an den Platz `index` im Behälter `all`. Der Platz zählt wie im
 * Client nur unter den aktiven Geschwistern – Archiviertes liegt zwar im selben
 * Behälter, steht aber nicht in der Liste. Zählte es mit, landete eine Aufgabe
 * neben archivierten Geschwistern an einer anderen Stelle als abgelegt.
 */
function placeAt(ctx: DbCtx, all: string[], moved: string[], index: number): string[] {
  const rest = all.filter((id) => !moved.includes(id));
  const archived = new Set(
    rest.length
      ? (
          ctx.sqlite
            .prepare(
              `SELECT id FROM task WHERE archived_at IS NOT NULL
                 AND id IN (${rest.map(() => '?').join(',')})`,
            )
            .all(...rest) as { id: string }[]
        ).map((r) => r.id)
      : [],
  );
  const active = rest.filter((id) => !archived.has(id));
  // Vor die aktive Aufgabe, die jetzt an diesem Platz steht – oder ans Ende.
  const before = active[index];
  const at = before === undefined ? rest.length : rest.indexOf(before);
  rest.splice(at, 0, ...moved);
  return rest;
}

/** Der Behälter, in dem Wurzelaufgaben nebeneinander liegen. */
type Container = {
  parentId: string | null;
  milestoneId: string | null;
  groupId: string | null;
  projectId: string;
  /**
   * Nur für lose Wurzeln: Unsortiert (nicht ready) und jede Gruppe in „Ready“
   * zählen getrennt – dort entscheidet die Markierung, ohne sie die Kategorie.
   */
  markId: string | null;
  categoryId: string | null;
  ready: number;
  doc: number;
};

/** Die Geschwister eines Behälters in ihrer Reihenfolge. */
function containerIds(ctx: DbCtx, where: Container): string[] {
  const [clause, params] = where.parentId
    ? ['parent_id = ?', [where.parentId]]
    : where.milestoneId
      ? ['parent_id IS NULL AND milestone_id = ?', [where.milestoneId]]
      : where.groupId
        ? ['parent_id IS NULL AND group_id = ?', [where.groupId]]
        : where.doc
          ? [
              `parent_id IS NULL AND milestone_id IS NULL AND group_id IS NULL
                 AND project_id = ? AND doc = 1`,
              [where.projectId],
            ]
          : !where.ready
            ? [
                // Unsortiert: alles Lose, was nicht ready ist – mit oder ohne Markierung.
                `parent_id IS NULL AND milestone_id IS NULL AND group_id IS NULL
                   AND project_id = ? AND doc = 0 AND ready = 0`,
                [where.projectId],
              ]
            : where.markId
              ? [
                  `parent_id IS NULL AND milestone_id IS NULL AND group_id IS NULL
                     AND project_id = ? AND doc = 0 AND ready = 1 AND mark_id = ?`,
                  [where.projectId, where.markId],
                ]
              : [
                  // Ohne Markierung entscheidet die Kategorie; NULL ist „Ohne Kategorie“.
                  `parent_id IS NULL AND milestone_id IS NULL AND group_id IS NULL
                     AND project_id = ? AND doc = 0 AND ready = 1 AND mark_id IS NULL
                     AND category_id IS ?`,
                  [where.projectId, where.categoryId],
                ];

  return (
    ctx.sqlite
      .prepare(`SELECT id FROM task WHERE ${clause} ORDER BY sort_order, id`)
      .all(...(params as unknown[])) as { id: string }[]
  ).map((r) => r.id);
}

/** Der Behälter, in dem diese Zeile liegt. */
const containerOf = (row: Record<string, unknown>): Container => ({
  parentId: (row['parent_id'] as string | null) ?? null,
  milestoneId: (row['milestone_id'] as string | null) ?? null,
  groupId: (row['group_id'] as string | null) ?? null,
  projectId: String(row['project_id']),
  markId: (row['mark_id'] as string | null) ?? null,
  categoryId: (row['category_id'] as string | null) ?? null,
  ready: Number(row['ready']) ? 1 : 0,
  doc: Number(row['doc']) ? 1 : 0,
});

/**
 * Kopiert eine Aufgabe mitsamt Unteraufgaben, Labels und Abhängigkeiten. Die
 * Kopie legt sich direkt unter das Original und heißt „… (Kopie)“ – wie im
 * Prototyp. Angelegtes lässt sich nicht zurücknehmen, deshalb kommt hier auch
 * kein Gegen-Schritt heraus.
 */
export function duplicate(ctx: DbCtx, id: string): { id: string } {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, 'task', id);
    if (!row) throw new NotFound();

    const copy = (source: Record<string, unknown>, parentId: string | null, title: string): string => {
      const copyId = newId('t');
      const rest = Object.fromEntries(
        Object.entries(source).filter(([k]) => !FRESH_ON_COPY.has(k)),
      );
      insertRows(ctx, 'task', [{ ...rest, id: copyId, parent_id: parentId, title }]);
      setTags(ctx, copyId, tagsOf(ctx, source['id'] as string));
      setDeps(ctx, 'task', copyId, depsOf(ctx, 'task', source['id'] as string));
      for (const kidId of childIds(ctx, source['id'] as string)) {
        const kid = readRow(ctx, 'task', kidId);
        if (kid) copy(kid, copyId, String(kid['title'] ?? ''));
      }
      return copyId;
    };

    // Der Platz wird vor dem Einfügen bestimmt, sonst zählt die Kopie sich selbst mit.
    const where = containerOf(row);
    const index = containerIds(ctx, where).indexOf(id) + 1;

    const copyId = copy(row, (row['parent_id'] as string | null) ?? null, `${row['title'] ?? ''} (Kopie)`);
    reorder(ctx, where, copyId, index);
    return { id: copyId };
  })();
}

/**
 * Aus einem Task mit Unteraufgaben wird ein vorbereiteter Milestone: er
 * übernimmt Titel, Beschreibung und Verweis-Nummer, die Unteraufgaben werden
 * seine Wurzelaufgaben, der Task selbst wandert in den Papierkorb.
 *
 * Was der Milestone nicht kennt, wird vorher weitergereicht, damit in der
 * Liste nichts verschwindet: seine Kategorie erben Unteraufgaben ohne eigene,
 * seine Labels kommen zu ihren dazu, und worauf er selbst gewartet hat, warten
 * sie – sie haben es ohnehin von ihm geerbt. Wer auf ihn gewartet hat, wartet
 * danach auf den Milestone. Priorität, Markierung und Status fallen weg.
 */
export function convertToMilestone(
  ctx: DbCtx,
  id: string,
  version: number,
): { id: string; count: number; undo: Step[] } {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, 'task', id);
    if (!row) throw new NotFound();
    if (row['version'] !== version) throw new Conflict(read(ctx, 'task', id));
    if (row['doc']) throw new Error('Eine Doku-Seite lässt sich nicht in einen Milestone umwandeln');
    const kids = childIds(ctx, id);
    if (!kids.length) throw new Error('Nur ein Task mit Unteraufgaben wird zum Milestone');

    const undo: Step[] = [];
    const deps = depsOf(ctx, 'task', id);
    const isMs = (x: string): boolean => !!readRow(ctx, 'milestone', x);
    const tags = tagsOf(ctx, id);

    // Der Milestone kann die Nummer übernehmen: der Task verschwindet gleich.
    const ms = create(ctx, 'milestone', {
      projectId: row['project_id'],
      title: row['title'],
      desc: row['desc'],
      planned: false,
      ref: row['ref'],
      deps: deps.filter(isMs),
    }) as { id: string };

    // Erst verschieben, dann nachtragen – so steht in beiden Gegen-Schritten
    // die Version, die beim Zurücknehmen tatsächlich gilt.
    const taskDeps = deps.filter((d) => !isMs(d));
    for (const kidId of kids) {
      undo.push(
        moveBack(ctx, kidId, versionOf(ctx, 'task', kidId), {
          parentId: null,
          milestoneId: ms.id,
          index: Number.MAX_SAFE_INTEGER,
        }),
      );
      const kid = read(ctx, 'task', kidId) as Task;
      const changes = {
        ...(row['category_id'] && !kid.categoryId ? { categoryId: row['category_id'] } : {}),
        ...(tags.length ? { tags: [...new Set([...kid.tags, ...tags])] } : {}),
        ...(taskDeps.length ? { deps: [...new Set([...kid.deps, ...taskDeps])] } : {}),
      };
      if (Object.keys(changes).length) {
        undo.push(patchBack(ctx, 'task', kidId, versionOf(ctx, 'task', kidId), changes));
      }
    }

    // Wer auf den Task gewartet hat, wartet jetzt auf den Milestone.
    for (const from of incomingDeps(ctx, id)) {
      const before = depsOf(ctx, 'task', from);
      undo.push(
        patchBack(ctx, 'task', from, versionOf(ctx, 'task', from), {
          deps: before.map((d) => (d === id ? ms.id : d)),
        }),
      );
    }

    const { trashId } = remove(ctx, 'task', id);

    // In dieser Reihenfolge zurück: erst ist der Task wieder da, dann hängen
    // die Unteraufgaben wieder unter ihm, zuletzt geht der Milestone.
    const back: Step[] = [
      { op: 'untrash', trashId },
      ...undo.reverse(),
      { op: 'purge', kind: 'milestone', id: ms.id },
    ];
    return { id: ms.id, count: kids.length, undo: stampVersions(ctx, back) };
  })();
}

/**
 * Checkboxen der Beschreibung werden Unteraufgaben – wie in Codecks (Wunsch
 * des Nutzers): der Text hinter der Checkbox wird der Titel, alles Eingerückte
 * darunter die Beschreibung, und in der Beschreibung bleibt ein Verweis stehen.
 * Mit `headings` gilt dasselbe für Überschriften: die Überschrift wird der
 * Titel, ihr Abschnitt die Beschreibung.
 */
export function checklistToSubtasks(
  ctx: DbCtx,
  id: string,
  version: number,
  which?: number[],
  headings?: number[],
): { count: number; undo: Step[] } {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, 'task', id);
    if (!row) throw new NotFound();
    if (row['version'] !== version) throw new Conflict(read(ctx, 'task', id));
    if (row['doc']) throw new Error('Eine Doku-Seite hat keine Unteraufgaben');
    const desc = (row['desc'] as string | null) ?? '';
    const sections = headings ? convertibleSections(desc, headings) : [];
    // Eine Checkbox in einem gewählten Abschnitt geht mit diesem.
    const items = [
      ...sections,
      ...(headings && !which ? [] : convertibleItems(desc, which)).filter(
        (it) => !sections.some((s) => s.from < it.from && it.from < s.to),
      ),
    ].sort((a, b) => a.from - b.from);
    if (!items.length) {
      throw new Error(headings ? 'Keine Überschrift zum Umwandeln' : 'Keine offene Checkbox zum Umwandeln');
    }

    const made = items.map((item) => {
      const kid = create(ctx, 'task', {
        projectId: row['project_id'],
        parentId: id,
        title: item.title.slice(0, 500),
        desc: item.desc,
      }) as Task;
      return { item, id: kid.id, ref: kid.ref as number };
    });
    const back: Step[] = [
      patchBack(ctx, 'task', id, version, { desc: replaceItems(desc, made) }),
      ...made.map((m): Step => ({ op: 'purge', kind: 'task', id: m.id })),
    ];
    return { count: made.length, undo: stampVersions(ctx, back) };
  })();
}

/** Wer wartet auf diesen Task oder Milestone? */
const incomingDeps = (ctx: DbCtx, id: string): string[] =>
  (
    ctx.sqlite
      .prepare(`SELECT from_id FROM dependency WHERE kind = 'task' AND to_id = ?`)
      .all(id) as { from_id: string }[]
  ).map((r) => r.from_id);

/**
 * Trägt in eine Kette von Gegen-Schritten die Versionen ein, die beim Ausführen
 * gelten: jeder Schritt auf derselben Zeile zählt sie um eins hoch. Ohne das
 * würde der zweite Schritt auf einer Aufgabe an der Versionsprüfung scheitern.
 */
function stampVersions(ctx: DbCtx, steps: Step[]): Step[] {
  const seen = new Map<string, number>();
  return steps.map((s) => {
    if (s.op !== 'patch' && s.op !== 'move') return s;
    const kind = s.op === 'patch' ? s.kind : 'task';
    const done = seen.get(s.id) ?? 0;
    seen.set(s.id, done + 1);
    return { ...s, version: versionOf(ctx, kind, s.id) + done };
  });
}

/**
 * Spalten, die die Kopie nicht erbt: Kennung, Verweis-Nummer (vergibt der
 * Trigger neu), Titel, Zeitstempel, Version.
 */
const FRESH_ON_COPY = new Set([
  'id', 'ref', 'parent_id', 'title', 'created_at', 'updated_at', 'version',
  // Der Eintrag im Changelog gehört zum Original – in der Kopie stünde er doppelt.
  'changelog', 'changelog_skip', 'changelog_order',
]);

const milestoneRoots = (ctx: DbCtx, milestoneId: string): string[] =>
  (
    ctx.sqlite
      .prepare('SELECT id FROM task WHERE milestone_id = ? AND parent_id IS NULL')
      .all(milestoneId) as { id: string }[]
  ).map((r) => r.id);

/**
 * Setzt `hidden_by` für einen Teilbaum neu – die eine Stelle, an der der
 * abgeleitete Wert sonst auseinanderlaufen könnte.
 *
 * Regel: `hidden_by` ist der nächste archivierte Vorfahre (Task oder
 * Milestone), oder NULL. Ein eigenes `archived_at` setzt `hidden_by` nicht.
 */
export function refreshHidden(ctx: DbCtx, rootTaskId: string): void {
  const update = ctx.sqlite.prepare('UPDATE task SET hidden_by = ? WHERE id = ?');
  const walk = (taskId: string, inherited: string | null): void => {
    const row = readRow(ctx, 'task', taskId);
    if (!row) return;
    if ((row['hidden_by'] ?? null) !== inherited) update.run(inherited, taskId);
    // Ist dieser Task selbst archiviert, verdeckt er ab hier seine Kinder.
    const next = row['archived_at'] ? taskId : inherited;
    for (const k of childIds(ctx, taskId)) walk(k, next);
  };

  const row = readRow(ctx, 'task', rootTaskId);
  if (!row) return;
  const inherited = row['parent_id']
    ? hiderForParent(ctx, row['parent_id'] as string)
    : row['milestone_id']
      ? archivedMilestone(ctx, row['milestone_id'] as string)
      : null;
  walk(rootTaskId, inherited);
}

/** Prüft die Invariante für den ganzen Bestand – für Tests und Wartung. */
export function hiddenMismatches(ctx: DbCtx): { id: string; stored: string | null; want: string | null }[] {
  const rows = ctx.sqlite
    .prepare('SELECT id, parent_id, milestone_id, archived_at, hidden_by FROM task')
    .all() as {
    id: string;
    parent_id: string | null;
    milestone_id: string | null;
    archived_at: string | null;
    hidden_by: string | null;
  }[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const archivedMs = new Set(
    (
      ctx.sqlite.prepare('SELECT id FROM milestone WHERE archived_at IS NOT NULL').all() as {
        id: string;
      }[]
    ).map((r) => r.id),
  );

  const want = (r: (typeof rows)[number]): string | null => {
    const seen = new Set<string>();
    let cur = r;
    while (cur.parent_id && !seen.has(cur.parent_id)) {
      seen.add(cur.parent_id);
      const p = byId.get(cur.parent_id);
      if (!p) return null;
      if (p.archived_at) return p.id;
      cur = p;
    }
    if (cur.milestone_id && archivedMs.has(cur.milestone_id)) return cur.milestone_id;
    return null;
  };

  return rows
    .map((r) => ({ id: r.id, stored: r.hidden_by, want: want(r) }))
    .filter((x) => x.stored !== x.want);
}

/* -------------------------------------------------------- Mehrfachauswahl */

/**
 * Eine Handlung auf mehreren Aufgaben, als **eine** Transaktion: scheitert
 * eine, bleibt der ganze Stapel liegen. Das ist der Unterschied zu vielen
 * einzelnen Aufrufen aus dem Client – dort bliebe die Hälfte geändert zurück.
 *
 * Verschieben, Archivieren und Löschen nehmen Unteraufgaben ohnehin mit,
 * deshalb fallen Ausgewählte weg, deren Vorfahre auch ausgewählt ist.
 */
export function bulk(ctx: DbCtx, items: BulkItem[], action: BulkAction): Undoable {
  return ctx.sqlite.transaction(() => {
    const version = new Map(items.map((i) => [i.id, i.version]));
    const ids = items.map((i) => i.id);
    const targets = action.type === 'patch' || action.type === 'tag' ? ids : topLevel(ctx, ids);
    const undo: Step[] = [];

    for (const id of targets) {
      const v = version.get(id) as number;
      switch (action.type) {
        case 'patch':
          undo.push(patchBack(ctx, 'task', id, v, action.changes));
          break;
        case 'tag': {
          const tags = tagsOf(ctx, id);
          const next = action.add
            ? tags.includes(action.tag)
              ? tags
              : [...tags, action.tag]
            : tags.filter((x) => x !== action.tag);
          undo.push(patchBack(ctx, 'task', id, v, { tags: next }));
          break;
        }
        case 'move':
          // Ans Ende des Ziels, in der Reihenfolge der Auswahl.
          undo.push(moveBack(ctx, id, v, { ...action.target, index: Number.MAX_SAFE_INTEGER }));
          break;
        case 'archive':
          expect(ctx, id, v);
          archive(ctx, 'task', id);
          undo.push({ op: 'unarchive', kind: 'task', id });
          break;
        case 'trash':
          expect(ctx, id, v);
          undo.push({ op: 'untrash', trashId: remove(ctx, 'task', id).trashId });
          break;
      }
    }

    // Mit Platzangabe (Ziehen einer Auswahl zwischen zwei Zeilen): alle
    // zusammen an diese Stelle, in der Reihenfolge der Auswahl.
    if (action.type === 'move' && action.target.index !== undefined && targets.length) {
      placeTogether(ctx, targets, action.target.index);
    }

    // Rückwärts zurücknehmen, sonst stolpern Verschiebungen übereinander.
    return { count: targets.length, undo: undo.reverse() };
  })();
}

/**
 * Setzt mehrere Aufgaben, die schon im selben Behälter liegen, als Block an
 * den Platz `index` – gezählt unter den übrigen Geschwistern.
 */
function placeTogether(ctx: DbCtx, ids: string[], index: number): void {
  const first = readRow(ctx, 'task', ids[0] as string);
  if (!first) return;
  const all = containerIds(ctx, containerOf(first));
  const moved = ids.filter((id) => all.includes(id));
  const rest = placeAt(ctx, all, moved, index);

  const set = ctx.sqlite.prepare('UPDATE task SET sort_order = ? WHERE id = ?');
  rest.forEach((sid, i) => set.run(i, sid));
}

/**
 * Mehrere kleine Operationen in einer Transaktion – und die Gegen-Schritte
 * dazu. Damit läuft „Erledigte archivieren“ (Milestones und Aufgaben gemischt)
 * und die Rücknahme selbst.
 */
export function applySteps(ctx: DbCtx, steps: Step[]): Undoable {
  return ctx.sqlite.transaction(() => {
    const undo: Step[] = [];

    for (const s of steps) {
      switch (s.op) {
        case 'patch':
          undo.push(patchBack(ctx, s.kind, s.id, s.version, s.changes));
          break;
        case 'move':
          undo.push(moveBack(ctx, s.id, s.version, s.target));
          break;
        case 'archive':
          archive(ctx, s.kind, s.id);
          undo.push({ op: 'unarchive', kind: s.kind, id: s.id });
          break;
        case 'unarchive':
          restore(ctx, s.kind, s.id);
          undo.push({ op: 'archive', kind: s.kind, id: s.id });
          break;
        case 'trash':
          undo.push({ op: 'untrash', trashId: remove(ctx, s.kind, s.id).trashId });
          break;
        case 'purge':
          // Erst wie beim Löschen, dann auch den Papierkorb-Eintrag weg – der
          // Zwischenstand soll nichts hinterlassen. Damit endet die Kette.
          ctx.sqlite
            .prepare('DELETE FROM trash WHERE id = ?')
            .run(remove(ctx, s.kind, s.id).trashId);
          break;
        case 'untrash':
          // Was aus dem Papierkorb kommt, bekommt neue Zeilen – ein sauberes
          // Gegenstück gibt es dafür nicht, also endet die Kette hier.
          restoreTrash(ctx, s.trashId);
          break;
        case 'unpurge':
          unpurge(ctx, s.rows);
          break;
      }
    }

    return { count: steps.length, undo: undo.reverse() };
  })();
}

/** Ändert und liefert den Schritt, der die Änderung wieder zurücknimmt. */
function patchBack(
  ctx: DbCtx,
  kind: Kind,
  id: string,
  version: number,
  changes: Record<string, unknown>,
): Step {
  const before = read(ctx, kind, id) as Record<string, unknown> | null;
  if (!before) throw new NotFound();
  const back = Object.fromEntries(Object.keys(changes).map((k) => [k, before[k]]));
  // Mit dem Status kommt auch der Platz im Spiel zurück – sonst läge die Karte danach hinten.
  if (kind === 'task' && 'status' in changes) back['playOrder'] = before['playOrder'];
  // Der Projektwechsel löst den Milestone aus seinem Release – zurück gehört er wieder hinein.
  if (kind === 'milestone' && 'projectId' in changes) back['releaseId'] = before['releaseId'];
  patch(ctx, kind, id, version, changes);
  return { op: 'patch', kind, id, version: versionOf(ctx, kind, id), changes: back };
}

/** Verschiebt und liefert den Schritt zurück an die alte Stelle. */
function moveBack(ctx: DbCtx, id: string, version: number, target: MoveTarget): Step {
  const before = read(ctx, 'task', id) as Task | null;
  if (!before) throw new NotFound();
  move(ctx, id, version, target);
  return {
    op: 'move',
    id,
    version: versionOf(ctx, 'task', id),
    // Der alte Ordnungswert stellt die Reihenfolge wieder her: die Lücke, die
    // der Weggang gelassen hat, wird beim Zurückschieben wieder gefüllt.
    target: {
      parentId: before.parentId,
      milestoneId: before.milestoneId,
      groupId: before.groupId,
      markId: before.markId,
      ready: before.ready,
      categoryId: before.categoryId,
      projectId: before.projectId,
      doc: before.doc,
      order: before.order,
    },
  };
}

const versionOf = (ctx: DbCtx, kind: Kind, id: string): number =>
  Number(readRow(ctx, kind, id)?.['version'] ?? 1);

/** Aufgaben ohne ausgewählten Vorfahren – `topSelected` aus dem Prototyp. */
function topLevel(ctx: DbCtx, ids: string[]): string[] {
  const chosen = new Set(ids);
  const parentOf = (id: string): string | null =>
    (readRow(ctx, 'task', id)?.['parent_id'] as string | null | undefined) ?? null;

  return ids.filter((id) => {
    for (let up = parentOf(id); up; up = parentOf(up)) if (chosen.has(up)) return false;
    return true;
  });
}

/** Die Versionsprüfung für Wege, die sie nicht selbst machen. */
function expect(ctx: DbCtx, id: string, version: number): void {
  const row = readRow(ctx, 'task', id);
  if (!row) throw new NotFound();
  if (row['version'] !== version) throw new Conflict(read(ctx, 'task', id));
}

/* ---------------------------------------------------------------- Löschen */

/** Gelöschtes wandert als vollständige Kopie in den Papierkorb. */
export function remove(ctx: DbCtx, kind: Kind, id: string): { trashId: string } {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, kind, id);
    if (!row) throw new NotFound();

    /**
     * Wie im Prototyp nehmen Milestone und Gruppe ihre Aufgaben nicht mit in den
     * Papierkorb: sie sind eine Ablage, kein Besitzer. Die Wurzelaufgaben lösen
     * sich und liegen danach unter „Unsortiert“.
     */
    // Ein archivierter Milestone nimmt seine Aufgaben dagegen mit: sie liegen mit ihm im Archiv.
    const archivedMs = kind === 'milestone' && !!row['archived_at'];
    // Vor dem Lösen, sonst stimmt die Herkunft nicht mehr.
    const where = whereOf(ctx, kind, row);
    const detached =
      kind === 'milestone' && !archivedMs
        ? detachRoots(ctx, 'milestone_id', id)
        : kind === 'group'
          ? detachRoots(ctx, 'group_id', id)
          : kind === 'release'
            ? detachMilestones(ctx, id)
            : [];

    const taskIds =
      kind === 'task'
        ? [id, ...descendantIds(ctx, id)]
        : kind === 'project'
          ? projectTaskIds(ctx, id)
          : archivedMs
            ? milestoneRoots(ctx, id).flatMap((r) => [r, ...descendantIds(ctx, r)])
            : [];

    // Ein Projekt besitzt Kategorien, Markierungen, Gruppen und Milestones; die
    // Datenbank löscht sie mit, also müssen sie mit in den Eintrag.
    const owned = (table: string): Record<string, unknown>[] =>
      kind === 'project' ? rowsFor(ctx, table, 'project_id', [id]) as Record<string, unknown>[] : [];
    const categories = owned('category');
    const marks = owned('mark');
    const groups = owned('"group"');
    const milestones = owned('milestone');
    // Die Kanäle gehen mit ihrem Release – beim Projekt die aller seiner Releases.
    const releases = owned('"release"');
    const releaseIds = [...releases.map((r) => r['id'] as string), ...(kind === 'release' ? [id] : [])];
    const stages = releaseIds.length ? rowsFor(ctx, 'release_stage', 'release_id', releaseIds) : [];
    const headings = releaseIds.length ? rowsFor(ctx, 'release_heading', 'release_id', releaseIds) : [];
    // Dazu der Milestone selbst: Protokoll und Zeichnungen gehen mit ihm und kommen mit ihm zurück.
    const milestoneIds = [...milestones.map((m) => m['id'] as string), ...(kind === 'milestone' ? [id] : [])];

    const payload = {
      kind,
      row,
      where,
      /** Die gelösten Wurzelaufgaben (beim Release: Milestones) – beim Wiederherstellen kehren sie zurück. */
      moved: detached,
      categories,
      marks,
      groups,
      releases,
      stages,
      headings,
      milestones,
      milestoneLog: milestoneIds.length ? rowsFor(ctx, 'milestone_log', 'milestone_id', milestoneIds) : [],
      tasks: taskIds.length ? rowsIn(ctx, 'task', taskIds) : [],
      tags: taskIds.length ? rowsFor(ctx, 'task_tag', 'task_id', taskIds) : [],
      drawings: [
        ...(taskIds.length ? rowsFor(ctx, 'drawing', 'task_id', taskIds) : []),
        ...(milestoneIds.length ? rowsFor(ctx, 'drawing', 'milestone_id', milestoneIds) : []),
      ],
      deps: dependenciesFor(ctx, [...taskIds, ...milestoneIds, id]),
    };

    const trashId = newId('x');
    ctx.sqlite
      .prepare(
        `INSERT INTO trash (id, kind, title, project_id, payload, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        trashId,
        kind === 'category' || kind === 'mark' ? 'task' : kind,
        kind === 'release'
          ? [row['name'], row['title']].filter(Boolean).join(' · ')
          : String(row['title'] ?? row['name'] ?? ''),
        (row['project_id'] as string | null) ?? null,
        JSON.stringify(payload),
        nowIso(),
      );

    if (taskIds.length) {
      ctx.sqlite
        .prepare(`DELETE FROM task WHERE id IN (${taskIds.map(() => '?').join(',')})`)
        .run(...taskIds);
    }
    ctx.sqlite.prepare(`DELETE FROM ${TABLE[kind]} WHERE id = ?`).run(id);
    // Abhängigkeiten haben keinen Fremdschlüssel (sie zeigen auf zwei Tabellen).
    pruneDependencies(ctx);
    // Hing der gelöschte Milestone im Archiv, sind seine Aufgaben jetzt wieder sichtbar.
    for (const t of detached) refreshHidden(ctx, t);

    return { trashId };
  })();
}

export type TrashEntry = {
  id: string;
  kind: string;
  title: string;
  projectId: string | null;
  deletedAt: string;
  /** Wie viele Aufgaben mit im Eintrag stecken. */
  taskCount: number;
  /** Woher der Eintrag kam – beim Löschen festgehalten, wie im Prototyp. */
  where: string;
  drawingCount: number;
  /** Nur bei einem Projekt. */
  milestoneCount: number;
  color: string | null;
  /** Nur bei einem Bild: darüber holt die Ansicht die Vorschau. */
  imageId: string | null;
};

/** Nach dieser Frist räumt sich der Papierkorb selbst auf. */
export const TRASH_DAYS = 30;

type TrashRow = {
  id: string;
  kind: string;
  title: string;
  project_id: string | null;
  deleted_at: string;
  payload: string;
};

export function loadTrash(ctx: DbCtx): TrashEntry[] {
  const rows = ctx.sqlite
    // Gelöschte Zeichnungen liegen nur für „Rückgängig“ hier (siehe removeDrawing).
    .prepare("SELECT * FROM trash WHERE kind != 'drawing' ORDER BY deleted_at DESC")
    .all() as TrashRow[];

  return rows.map((r) => {
    // Ein Bild bringt hier nur seine ID mit, deshalb der weitere Typ.
    const p = JSON.parse(r.payload) as Omit<TrashPayload, 'kind' | 'tasks'> & {
      kind: TrashPayload['kind'] | 'image';
      tasks?: Record<string, unknown>[];
    };
    return {
      id: r.id,
      kind: r.kind,
      title: r.title,
      projectId: r.project_id,
      deletedAt: r.deleted_at,
      // Ein Bild bringt keine Aufgaben mit – sein Eintrag trägt nur die ID.
      taskCount: p.tasks?.length ?? 0,
      where: p.where ?? '',
      drawingCount: p.drawings?.length ?? 0,
      milestoneCount: p.milestones?.length ?? 0,
      color: p.kind === 'project' ? ((p.row['color'] as string | undefined) ?? null) : null,
      imageId: p.kind === 'image' ? ((p.row['id'] as string | undefined) ?? null) : null,
    };
  });
}

/** Ein Bild ist hier nicht dabei: sein Eintrag wird vorher abgefangen. */
type TrashPayload = {
  kind: Kind | 'drawing';
  row: Record<string, unknown>;
  /** Die Herkunft beim Löschen; ältere Einträge haben sie nicht. */
  where?: string;
  /** Wurzelaufgaben, die ein Milestone oder eine Gruppe beim Löschen losgelassen hat. */
  moved?: string[];
  /** Nur bei einem Projekt; ältere Einträge haben sie nicht. */
  categories?: Record<string, unknown>[];
  marks?: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
  /** Bei einem Projekt seine Releases; die Kanäle auch bei einem einzelnen Release. */
  releases?: Record<string, unknown>[];
  stages?: Record<string, unknown>[];
  headings?: Record<string, unknown>[];
  milestones?: Record<string, unknown>[];
  milestoneLog?: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  /** Fehlen bei einer gelöschten Zeichnung. */
  tags?: Record<string, unknown>[];
  drawings?: Record<string, unknown>[];
  deps?: Record<string, unknown>[];
};

/** Schreibt einen Papierkorb-Eintrag samt allem, was daran hing, zurück. */
export function restoreTrash(
  ctx: DbCtx,
  trashId: string,
  o: { toEnd?: boolean } = {},
): { restored: number; kind: string; id: string; label: string } {
  return ctx.sqlite.transaction(() => {
    const entry = ctx.sqlite.prepare('SELECT * FROM trash WHERE id = ?').get(trashId) as
      | { payload: string }
      | undefined;
    if (!entry) throw new NotFound();

    const raw = JSON.parse(entry.payload) as { kind: string; row: Record<string, unknown> };

    // Bei einem Bild liegen die Bytes noch da; es fällt nur die Markierung weg.
    if (raw.kind === 'image') {
      const id = String(raw.row['id'] ?? '');
      if (!untrashImage(ctx, id)) throw new NotFound();
      ctx.sqlite.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
      // Kein Zusatz: `label` ist sonst ein Ort („im Backlog“), den es hier nicht gibt.
      return { restored: 1, kind: 'image', id, label: '' };
    }

    const p = raw as TrashPayload;
    const exists = (table: string, id: unknown): boolean =>
      !!id && !!ctx.sqlite.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);

    const pid = p.row['project_id'];
    if (p.kind !== 'project' && pid && !exists('project', pid)) {
      throw new Error('Das Projekt dazu liegt im Papierkorb – stell zuerst das Projekt wieder her');
    }

    /**
     * Wie im Prototyp: Ist der alte Ort inzwischen weg, kommt eine Aufgabe lose
     * in den Backlog statt an einem Verweis ins Leere zu scheitern.
     */
    if (p.kind === 'task') {
      const root = p.tasks.find((t) => t['id'] === p.row['id']) ?? p.row;
      for (const r of new Set([root, p.row])) {
        if (r['parent_id'] && !exists('task', r['parent_id'])) {
          Object.assign(r, { parent_id: null, milestone_id: null, group_id: null });
          r['sort_order'] = nextOrder(ctx, 'task', { projectId: pid });
        } else if (!r['parent_id']) {
          if (r['milestone_id'] && !exists('milestone', r['milestone_id'])) {
            Object.assign(r, { milestone_id: null, group_id: null });
          }
          if (r['group_id'] && !exists('"group"', r['group_id'])) r['group_id'] = null;
        }
      }
    }
    // Dasselbe für das Release eines Milestones – der Milestone kommt dann ohne zurück.
    if (p.kind === 'milestone' && !exists('"release"', p.row['release_id'])) p.row['release_id'] = null;
    if ((p.kind === 'stage' || p.kind === 'heading') && !exists('"release"', p.row['release_id'])) {
      throw new Error('Das Release dazu liegt im Papierkorb – stell zuerst das Release wieder her');
    }
    insertRows(ctx, p.kind === 'drawing' ? 'drawing' : TABLE[p.kind], [p.row]);
    // Aus dem Papierkorb geholt reiht sich ein Milestone hinten ein (Prototyp:
    // `qorder = order = 1e6`); „Rückgängig“ stellt dagegen den alten Platz her.
    if (p.kind === 'milestone' && o.toEnd) milestoneToEnd(ctx, p.row['id'] as string);
    // Erst was das Projekt besitzt, dann die Aufgaben, die darauf zeigen.
    insertRows(ctx, 'category', p.categories ?? []);
    insertRows(ctx, 'mark', p.marks ?? []);
    insertRows(ctx, '"group"', p.groups ?? []);
    insertRows(ctx, '"release"', p.releases ?? []);
    insertRows(ctx, 'release_stage', p.stages ?? []);
    insertRows(ctx, 'release_heading', p.headings ?? []);
    insertRows(ctx, 'milestone', p.milestones ?? []);
    insertRows(ctx, 'milestone_log', p.milestoneLog ?? []);
    insertRows(ctx, 'task', parentsFirst(p.tasks));
    insertRows(ctx, 'task_tag', p.tags ?? []);
    insertRows(ctx, 'drawing', p.drawings ?? []);
    insertRows(ctx, 'dependency', p.deps ?? []);

    // Verweise, deren Gegenstück inzwischen fehlt, fallen wieder raus.
    pruneDependencies(ctx);
    // Die Zugehörigkeit kann sich geändert haben, während der Eintrag im Papierkorb lag.
    for (const t of p.tasks) {
      if (!t['parent_id']) refreshHidden(ctx, t['id'] as string);
    }
    // Ältere Einträge zeigen noch auf Markierungen anderer Projekte.
    adoptMarks(ctx, p.tasks.map((t) => t['id'] as string));

    // Was der Milestone oder die Gruppe losgelassen hat, kehrt zurück – sofern es noch lose liegt.
    const column = p.kind === 'milestone' ? 'milestone_id' : p.kind === 'group' ? 'group_id' : null;
    if (column && p.moved?.length) {
      ctx.sqlite
        .prepare(
          `UPDATE task SET ${column} = ?, updated_at = ?, version = version + 1
            WHERE id IN (SELECT value FROM json_each(?))
              AND parent_id IS NULL AND milestone_id IS NULL AND group_id IS NULL`,
        )
        .run(p.row['id'], nowIso(), JSON.stringify(p.moved));
    }

    // Die Milestones des Releases ebenso – sofern sie inzwischen in keinem anderen stecken.
    if (p.kind === 'release' && p.moved?.length) {
      ctx.sqlite
        .prepare(
          `UPDATE milestone SET release_id = ?, updated_at = ?, version = version + 1
            WHERE id IN (SELECT value FROM json_each(?)) AND release_id IS NULL AND project_id = ?`,
        )
        .run(p.row['id'], nowIso(), JSON.stringify(p.moved), pid);
    }

    ctx.sqlite.prepare('DELETE FROM trash WHERE id = ?').run(trashId);

    const id = p.row['id'] as string;
    const label =
      p.kind === 'project'
        ? 'mit allen Tasks'
        : p.kind === 'task'
          ? readRow(ctx, 'task', id)?.['archived_at'] || readRow(ctx, 'task', id)?.['hidden_by']
            ? 'im Archiv'
            : whereOf(ctx, 'task', readRow(ctx, 'task', id) ?? p.row)
          : p.kind === 'milestone'
            ? p.row['archived_at']
              ? 'im Archiv'
              : p.row['planned']
                ? 'im Plan'
                : 'im Backlog'
            : '';
    return { restored: p.tasks.length || 1, kind: p.kind, id, label };
  })();
}

/** Ein Milestone ans Ende von Plan und Backlog seines Projekts. */
function milestoneToEnd(ctx: DbCtx, id: string): void {
  const max = ctx.sqlite
    .prepare(
      `SELECT coalesce(max(sort_order), -1) AS o, coalesce(max(queue_order), -1) AS q
         FROM milestone WHERE project_id = (SELECT project_id FROM milestone WHERE id = ?) AND id != ?`,
    )
    .get(id, id) as { o: number; q: number };
  ctx.sqlite
    .prepare('UPDATE milestone SET sort_order = ?, queue_order = ? WHERE id = ?')
    .run(max.o + 1, max.q + 1, id);
}

/**
 * Die Herkunft in Worten – `whereLabel` aus dem Prototyp, für die Zeile im
 * Papierkorb und die Meldung nach dem Wiederherstellen.
 */
function whereOf(ctx: DbCtx, kind: Kind, row: Record<string, unknown>): string {
  const get = (sql: string, id: unknown): Record<string, unknown> | undefined =>
    id ? (ctx.sqlite.prepare(sql).get(id) as Record<string, unknown> | undefined) : undefined;
  const project = String(get('SELECT name FROM project WHERE id = ?', row['project_id'])?.['name'] ?? '');

  if (kind === 'milestone') {
    return row['archived_at'] ? 'aus dem Archiv' : row['planned'] ? 'aus dem Plan' : 'aus dem Backlog';
  }
  if (kind === 'group') return `Gruppe · ${project}`;
  if (kind !== 'task') return '';

  if (row['parent_id']) {
    return `unter „${String(get('SELECT title FROM task WHERE id = ?', row['parent_id'])?.['title'] ?? '?')}“`;
  }
  const m = get('SELECT title, planned FROM milestone WHERE id = ?', row['milestone_id']);
  if (m) return `in ◆ ${String(m['title'])}${m['planned'] ? '' : ' (Backlog)'}`;
  if (row['doc']) return `in Dokumentation · ${project}`;

  const g = get('SELECT title FROM "group" WHERE id = ?', row['group_id']);
  const k = get('SELECT emoji, name FROM mark WHERE id = ?', row['mark_id']);
  const group = g
    ? String(g['title']) || 'Neue Gruppe'
    : k
      ? `${String(k['emoji'])} ${String(k['name'])}`
      : 'Unsortiert';
  return `im Backlog › ${group} · ${project}`;
}

/**
 * Aufgaben so ordnen, dass jede nach ihrem Elternteil kommt – der Fremdschlüssel
 * prüft sofort. Die Tabellenreihenfolge taugt nicht: nach einem Verschieben
 * kann ein Kind älter sein als sein neuer Elternteil.
 */
function parentsFirst(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map(rows.map((r) => [r['id'] as string, r]));
  const out: Record<string, unknown>[] = [];
  const placed = new Set<string>();
  const place = (r: Record<string, unknown>): void => {
    const id = r['id'] as string;
    if (placed.has(id)) return;
    placed.add(id);
    const parent = byId.get(r['parent_id'] as string);
    if (parent) place(parent);
    out.push(r);
  };
  rows.forEach(place);
  return out;
}

/** Endgültig löschen – die Zeilen gehen als Gegen-Schritt an den Client zurück. */
export function purgeTrash(ctx: DbCtx, ids: string[]): Undoable & { images: number } {
  return ctx.sqlite.transaction(() => {
    const list = JSON.stringify(ids);
    const rows = ctx.sqlite
      .prepare(
        `SELECT id, kind, title, project_id, payload, deleted_at FROM trash
          WHERE id IN (SELECT value FROM json_each(?))`,
      )
      .all(list) as TrashRowData[];
    ctx.sqlite.prepare('DELETE FROM trash WHERE id IN (SELECT value FROM json_each(?))').run(list);

    /**
     * Bei einem Bild fallen hier auch die Bytes. Das lässt sich nicht
     * zurücknehmen, deshalb kommt so ein Eintrag gar nicht erst in die
     * Rückgängig-Liste – ein Wiederherstellen würde sonst einen Eintrag
     * anlegen, dessen Bild nicht mehr da ist.
     */
    const images = purgeImagesFor(ctx, rows);
    const back = rows.filter((r) => r.kind !== 'image');
    return { count: rows.length, images, undo: back.length ? [{ op: 'unpurge' as const, rows: back }] : [] };
  })();
}

function unpurge(ctx: DbCtx, rows: TrashRowData[]): void {
  const insert = ctx.sqlite.prepare(
    `INSERT OR IGNORE INTO trash (id, kind, title, project_id, payload, deleted_at)
     VALUES (@id, @kind, @title, @project_id, @payload, @deleted_at)`,
  );
  for (const r of rows) insert.run(r);
}

/** Läuft beim Start: alles, was die Frist überschritten hat, ist endgültig weg. */
export function expireTrash(ctx: DbCtx, days = TRASH_DAYS): number {
  const limit = new Date(Date.now() - days * 864e5).toISOString();
  return ctx.sqlite.transaction(() => {
    const rows = ctx.sqlite
      .prepare('SELECT kind, payload FROM trash WHERE deleted_at < ?')
      .all(limit) as { kind: string; payload: string }[];
    purgeImagesFor(ctx, rows);
    return ctx.sqlite.prepare('DELETE FROM trash WHERE deleted_at < ?').run(limit).changes;
  })();
}

/**
 * Schreibt gespeicherte Rohzeilen zurück. Die Spaltennamen stehen in den Daten
 * selbst, deshalb geht das ohne Wissen über die einzelne Tabelle.
 */
function insertRows(ctx: DbCtx, table: string, rows: Record<string, unknown>[]): void {
  for (const row of rows) {
    const fields = Object.keys(row);
    if (!fields.length) continue;
    ctx.sqlite
      .prepare(
        `INSERT OR IGNORE INTO ${table} (${fields.map((f) => `"${f}"`).join(',')})
         VALUES (${fields.map(() => '?').join(',')})`,
      )
      .run(...fields.map((f) => toSql(row[f])));
  }
}

/** Entfernt Abhängigkeiten, deren Ziel oder Quelle es nicht mehr gibt. */
export function pruneDependencies(ctx: DbCtx): void {
  ctx.sqlite.exec(`
    DELETE FROM dependency WHERE kind = 'task' AND (
      from_id NOT IN (SELECT id FROM task)
      -- Ein Task darf auch auf einen Milestone warten.
      OR (to_id NOT IN (SELECT id FROM task) AND to_id NOT IN (SELECT id FROM milestone)));
    DELETE FROM dependency WHERE kind = 'milestone' AND (
      from_id NOT IN (SELECT id FROM milestone) OR to_id NOT IN (SELECT id FROM milestone));
  `);
}

/* ============================================================== Intern */

function read(ctx: DbCtx, kind: Kind, id: string): unknown {
  const row = readRow(ctx, kind, id);
  if (!row) throw new NotFound();
  switch (kind) {
    case 'project':
      return toProject(row as unknown as ProjectRow);
    case 'category':
      return toCategory(row as unknown as CategoryRow);
    case 'mark':
      return toMark(row as unknown as MarkRow);
    case 'group':
      return toGroup(row as unknown as GroupRow);
    case 'release':
      return toRelease(row as unknown as ReleaseRow);
    case 'stage':
      return toStage(row as unknown as StageRow);
    case 'heading':
      return toHeading(row as unknown as HeadingRow);
    case 'milestone':
      return toMilestone(row as unknown as MilestoneRow, depsOf(ctx, 'milestone', id));
    case 'task':
      return toTask(row as unknown as TaskRow, tagsOf(ctx, id), depsOf(ctx, 'task', id));
  }
}

const readRow = (ctx: DbCtx, kind: Kind, id: string): Record<string, unknown> | undefined =>
  ctx.sqlite.prepare(`SELECT * FROM ${TABLE[kind]} WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;

const bump = (ctx: DbCtx, kind: Kind, id: string): void => {
  ctx.sqlite
    .prepare(`UPDATE ${TABLE[kind]} SET updated_at = ?, version = version + 1 WHERE id = ?`)
    .run(nowIso(), id);
};

const childIds = (ctx: DbCtx, id: string): string[] =>
  (ctx.sqlite.prepare('SELECT id FROM task WHERE parent_id = ?').all(id) as { id: string }[]).map(
    (r) => r.id,
  );

/** Alle Nachfahren, auch archivierte. */
function descendantIds(ctx: DbCtx, id: string): string[] {
  const rows = ctx.sqlite
    .prepare(
      `WITH RECURSIVE sub(id) AS (
         SELECT id FROM task WHERE parent_id = ?
         UNION
         SELECT t.id FROM task t JOIN sub ON t.parent_id = sub.id
       ) SELECT id FROM sub`,
    )
    .all(id) as { id: string }[];
  return rows.map((r) => r.id);
}

/**
 * Löst die Wurzelaufgaben von ihrer Ablage: sie bleiben bestehen und liegen
 * danach unter „Unsortiert“. Gibt die gelösten IDs zurück.
 */
function detachRoots(ctx: DbCtx, column: 'milestone_id' | 'group_id', id: string): string[] {
  const roots = (
    ctx.sqlite.prepare(`SELECT id FROM task WHERE ${column} = ?`).all(id) as { id: string }[]
  ).map((r) => r.id);
  if (roots.length) {
    ctx.sqlite
      .prepare(`UPDATE task SET ${column} = NULL, updated_at = ?, version = version + 1 WHERE ${column} = ?`)
      .run(nowIso(), id);
  }
  return roots;
}

/**
 * Löst die Milestones von ihrem Release: wie Aufgaben bei einem Milestone
 * bleiben sie bestehen. Gibt die gelösten IDs zurück.
 */
function detachMilestones(ctx: DbCtx, releaseId: string): string[] {
  const ids = (
    ctx.sqlite.prepare('SELECT id FROM milestone WHERE release_id = ?').all(releaseId) as { id: string }[]
  ).map((r) => r.id);
  if (ids.length) {
    ctx.sqlite
      .prepare('UPDATE milestone SET release_id = NULL, updated_at = ?, version = version + 1 WHERE release_id = ?')
      .run(nowIso(), releaseId);
  }
  return ids;
}

const projectTaskIds = (ctx: DbCtx, id: string): string[] =>
  (ctx.sqlite.prepare('SELECT id FROM task WHERE project_id = ?').all(id) as { id: string }[]).map(
    (r) => r.id,
  );

function hideAll(ctx: DbCtx, ids: string[], hider: string): void {
  if (!ids.length) return;
  ctx.sqlite
    .prepare(
      `UPDATE task SET hidden_by = ? WHERE hidden_by IS NULL AND id IN (${ids
        .map(() => '?')
        .join(',')})`,
    )
    .run(hider, ...ids);
}

/** Welcher archivierte Vorfahre verdeckt Kinder dieses Elternteils? */
function hiderForParent(ctx: DbCtx, parentId: string): string | null {
  const p = ctx.sqlite
    .prepare('SELECT id, archived_at, hidden_by FROM task WHERE id = ?')
    .get(parentId) as { id: string; archived_at: string | null; hidden_by: string | null } | undefined;
  if (!p) return null;
  return p.archived_at ? p.id : (p.hidden_by ?? null);
}

const archivedMilestone = (ctx: DbCtx, milestoneId: string): string | null => {
  const m = ctx.sqlite.prepare('SELECT id, archived_at FROM milestone WHERE id = ?').get(milestoneId) as
    | { id: string; archived_at: string | null }
    | undefined;
  return m?.archived_at ? m.id : null;
};

function targetProject(ctx: DbCtx, t: MoveTarget): string | null {
  const q = (sql: string, id: string): string | null =>
    (ctx.sqlite.prepare(sql).get(id) as { project_id: string } | undefined)?.project_id ?? null;
  if (t.parentId) return q('SELECT project_id FROM task WHERE id = ?', t.parentId);
  if (t.milestoneId) return q('SELECT project_id FROM milestone WHERE id = ?', t.milestoneId);
  if (t.groupId) return q('SELECT project_id FROM "group" WHERE id = ?', t.groupId);
  // Unsortiert und smarte Gruppen gehören zu keinem Behälter – dann zählt das mitgeschickte Projekt.
  return t.projectId ?? null;
}

/** Dieselben Farben wie im Prototyp, der Reihe nach vergeben. */
const PROJECT_COLORS = ['#7A4FA0', '#B04A6A', '#3E8A8A', '#6B7A2A', '#4A5BB0'];

function nextOrder(ctx: DbCtx, kind: Kind, input: Record<string, unknown>): number {
  if (kind === 'heading') {
    const release = readRow(ctx, 'release', String(input['releaseId']));
    if (!release) throw new NotFound();
    return nextChangelogOrder(ctx, String(release['project_id']));
  }
  if (kind === 'project') {
    return (
      (ctx.sqlite.prepare('SELECT coalesce(max(sort_order), -1) AS m FROM project').get() as {
        m: number;
      }).m + 1
    );
  }

  const [table, where, param] =
    kind === 'task'
      ? input['parentId']
        ? ['task', 'parent_id = ?', input['parentId']]
        : input['milestoneId']
          ? ['task', 'milestone_id = ?', input['milestoneId']]
          : input['groupId']
            ? ['task', 'group_id = ?', input['groupId']]
            : ['task', 'project_id = ?', input['projectId']]
      : kind === 'category' || kind === 'mark'
        ? [kind, 'project_id = ?', input['projectId']]
        : kind === 'group'
          ? ['"group"', 'project_id = ?', input['projectId']]
          : kind === 'release'
            ? ['"release"', 'project_id = ?', input['projectId']]
            : kind === 'stage'
              ? ['release_stage', 'release_id = ?', input['releaseId']]
              // `heading` ist oben schon abgehandelt.
              : ['milestone', 'project_id = ?', input['projectId']];

  const row = ctx.sqlite
    .prepare(`SELECT coalesce(max(sort_order), -1) AS m FROM ${table} WHERE ${where}`)
    .get(param) as { m: number };
  return row.m + 1;
}

function setTags(ctx: DbCtx, taskId: string, tags: string[]): void {
  ctx.sqlite.prepare('DELETE FROM task_tag WHERE task_id = ?').run(taskId);
  const ins = ctx.sqlite.prepare('INSERT OR IGNORE INTO task_tag (task_id, tag) VALUES (?, ?)');
  for (const tag of tags) ins.run(taskId, tag.trim());
}

function setDeps(ctx: DbCtx, kind: 'task' | 'milestone', id: string, deps: string[]): void {
  ctx.sqlite.prepare('DELETE FROM dependency WHERE kind = ? AND from_id = ?').run(kind, id);
  const ins = ctx.sqlite.prepare(
    'INSERT OR IGNORE INTO dependency (kind, from_id, to_id) VALUES (?, ?, ?)',
  );
  for (const to of deps) if (to !== id) ins.run(kind, id, to);
}

const tagsOf = (ctx: DbCtx, taskId: string): string[] =>
  (
    ctx.sqlite.prepare('SELECT tag FROM task_tag WHERE task_id = ? ORDER BY tag').all(taskId) as {
      tag: string;
    }[]
  ).map((r) => r.tag);

const depsOf = (ctx: DbCtx, kind: 'task' | 'milestone', id: string): string[] =>
  (
    ctx.sqlite
      .prepare('SELECT to_id FROM dependency WHERE kind = ? AND from_id = ?')
      .all(kind, id) as { to_id: string }[]
  ).map((r) => r.to_id);

const rowsIn = (ctx: DbCtx, table: string, ids: string[]): unknown[] =>
  ctx.sqlite.prepare(`SELECT * FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);

const rowsFor = (ctx: DbCtx, table: string, column: string, ids: string[]): unknown[] =>
  ctx.sqlite
    .prepare(`SELECT * FROM ${table} WHERE ${column} IN (${ids.map(() => '?').join(',')})`)
    .all(...ids);

const dependenciesFor = (ctx: DbCtx, ids: string[]): unknown[] =>
  ids.length
    ? ctx.sqlite
        .prepare(
          `SELECT * FROM dependency WHERE from_id IN (${ids.map(() => '?').join(',')})
           OR to_id IN (${ids.map(() => '?').join(',')})`,
        )
        .all(...ids, ...ids)
    : [];

const toSql = (v: unknown): unknown => (typeof v === 'boolean' ? (v ? 1 : 0) : (v ?? null));

function groupValues<R, V>(
  rows: R[],
  key: (r: R) => string,
  value: (r: R) => V,
): Map<string, V[]> {
  const map = new Map<string, V[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(value(r));
    else map.set(k, [value(r)]);
  }
  return map;
}

/* ------------------------------------------------------ Zeilen ins Modell */

type ProjectRow = {
  id: string; version: number; name: string; color: string; sort_order: number; cover_image_id: string | null;
};
type CategoryRow = {
  id: string; version: number; project_id: string; name: string; sort_order: number; cover_image_id: string | null;
};
type MarkRow = {
  id: string; version: number; project_id: string; emoji: string; name: string; sort_order: number;
  cover_image_id: string | null;
};
type GroupRow = { id: string; version: number; project_id: string; title: string; sort_order: number };
type ReleaseRow = {
  id: string; version: number; project_id: string; name: string; title: string; desc: string;
  sort_order: number; archived_at: string | null;
};
type StageRow = {
  id: string; version: number; release_id: string; name: string; sort_order: number; done_at: string | null;
};
type HeadingRow = { id: string; version: number; release_id: string; title: string; sort_order: number };
type MilestoneRow = {
  id: string; ref: number; version: number; project_id: string; release_id: string | null; title: string; desc: string; planned: number; status: string;
  sort_order: number; queue_order: number; start_date: string | null; end_date: string | null;
  end_auto: number; archived_at: string | null;
};
type TaskRow = {
  id: string; ref: number; version: number; project_id: string; parent_id: string | null; milestone_id: string | null;
  group_id: string | null; doc: number; title: string; desc: string; prio: number; status: string;
  done_at: string | null; sort_order: number; category_id: string | null; mark_id: string | null;
  ready: number; archived_at: string | null; hidden_by: string | null; cover_image_id: string | null;
  play_order: number; changelog: string; changelog_skip: number; changelog_order: number;
};

const toProject = (r: ProjectRow): Project => ({
  id: r.id, version: r.version, name: r.name, color: r.color, order: r.sort_order,
  coverImageId: r.cover_image_id ?? null,
});

const toCategory = (r: CategoryRow): Category => ({
  id: r.id, version: r.version, projectId: r.project_id, name: r.name, order: r.sort_order,
  coverImageId: r.cover_image_id ?? null,
});

const toMark = (r: MarkRow): Mark => ({
  id: r.id, version: r.version, projectId: r.project_id, emoji: r.emoji, name: r.name, order: r.sort_order,
  coverImageId: r.cover_image_id ?? null,
});

const toGroup = (r: GroupRow): Group => ({
  id: r.id, version: r.version, projectId: r.project_id, title: r.title, order: r.sort_order,
});

const toRelease = (r: ReleaseRow): Release => ({
  id: r.id, version: r.version, projectId: r.project_id, name: r.name, title: r.title, desc: r.desc,
  order: r.sort_order, archivedAt: r.archived_at,
});

const toStage = (r: StageRow): ReleaseStage => ({
  id: r.id, version: r.version, releaseId: r.release_id, name: r.name, order: r.sort_order,
  doneAt: r.done_at,
});

const toHeading = (r: HeadingRow): ReleaseHeading => ({
  id: r.id, version: r.version, releaseId: r.release_id, title: r.title, order: r.sort_order,
});

const toMilestone = (r: MilestoneRow, deps: string[]): Milestone => ({
  id: r.id,
  ref: r.ref,
  version: r.version,
  projectId: r.project_id,
  releaseId: r.release_id ?? null,
  title: r.title,
  desc: r.desc,
  planned: !!r.planned,
  status: r.status as Status,
  order: r.sort_order,
  qorder: r.queue_order,
  startDate: r.start_date,
  endDate: r.end_date,
  endAuto: !!r.end_auto,
  archivedAt: r.archived_at,
  deps,
});

const toTask = (r: TaskRow, tags: string[], deps: string[]): Task => ({
  id: r.id,
  ref: r.ref,
  version: r.version,
  projectId: r.project_id,
  parentId: r.parent_id,
  milestoneId: r.milestone_id,
  groupId: r.group_id,
  doc: !!r.doc,
  title: r.title,
  desc: r.desc,
  prio: r.prio as Prio,
  status: r.status as Status,
  doneAt: r.done_at,
  order: r.sort_order,
  categoryId: r.category_id,
  markId: r.mark_id,
  ready: !!r.ready,
  coverImageId: r.cover_image_id ?? null,
  playOrder: r.play_order ?? 0,
  changelog: r.changelog ?? '',
  changelogSkip: !!r.changelog_skip,
  changelogOrder: r.changelog_order ?? 0,
  archivedAt: r.archived_at,
  tags,
  deps,
});
