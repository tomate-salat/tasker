import type {
  Category,
  Data,
  Group,
  Mark,
  Milestone,
  Prio,
  Project,
  Status,
  Task,
} from '../shared/model.js';
import type { BulkAction, BulkItem, Kind, Step, Stub, Undoable } from '../shared/api.js';
import type { DbCtx } from './db.js';
import { loadDrawingMeta, type DrawingMeta } from './drawings.js';
import { newId, type IdPrefix } from './ids.js';

/* ============================================================ Lesen */

export type Bootstrap = Data & {
  /** Verweise auf archivierte Objekte, nur Titel – siehe PHASE-2.md, Abschnitt 4. */
  stubs: Stub[];
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
  const tasks = all<TaskRow>(
    `SELECT t.* FROM task t WHERE ${ACTIVE_TASK} ORDER BY t.sort_order`,
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
  ].map((r) => ({ ...r, archived: true as const }));

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
    tasks: tasks.map((t) => toTask(t, tagsOf.get(t.id) ?? [], depsOfTask.get(t.id) ?? [])),
    stubs,
    archiveCounts,
    drawings: loadDrawingMeta(ctx),
  };
}

export type ArchiveEntry = {
  kind: 'task' | 'milestone';
  id: string;
  projectId: string;
  title: string;
  archivedAt: string;
  /** Anzahl mitgegangener Unteraufgaben. */
  hiddenCount: number;
};

/** Das Archiv, seitenweise – wird erst beim Öffnen der Archivansicht geholt. */
export function loadArchive(
  ctx: DbCtx,
  o: { q?: string | undefined; projectId?: string | undefined; limit: number; offset: number },
): { entries: ArchiveEntry[]; total: number } {
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

  const countHidden = ctx.sqlite.prepare<[string], { c: number }>(
    'SELECT count(*) AS c FROM task WHERE hidden_by = ?',
  );

  return {
    total,
    entries: rows.map((r) => ({
      kind: r.kind,
      id: r.id,
      projectId: r.project_id,
      title: r.title,
      archivedAt: r.archived_at,
      hiddenCount: countHidden.get(r.id)?.c ?? 0,
    })),
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
  milestone: 'milestone',
  task: 'task',
};

const PREFIX: Record<Kind, IdPrefix> = {
  project: 'p',
  category: 'c',
  mark: 'k',
  group: 'g',
  milestone: 'm',
  task: 't',
};

/** Spaltennamen zu den Feldern des Datenmodells. */
const COLUMN: Record<string, string> = {
  projectId: 'project_id',
  parentId: 'parent_id',
  milestoneId: 'milestone_id',
  groupId: 'group_id',
  categoryId: 'category_id',
  markId: 'mark_id',
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

    // Ein Milestone nimmt beim Projektwechsel seine Wurzelaufgaben mit – sonst
    // hinge er in einem Projekt und seine Aufgaben in einem anderen.
    if (kind === 'milestone' && typeof fields['projectId'] === 'string') {
      const target = fields['projectId'];
      for (const rootId of milestoneRoots(ctx, id)) {
        const ids = [rootId, ...descendantIds(ctx, rootId)];
        ctx.sqlite
          .prepare(`UPDATE task SET project_id = ? WHERE id IN (${ids.map(() => '?').join(',')})`)
          .run(target, ...ids);
      }
    }

    // „Erledigt“ führt den Zeitpunkt mit, damit Burnup und Archiv ihn haben.
    if (kind === 'task' && typeof fields['status'] === 'string') {
      const doneAt = fields['status'] === 'done' ? (current['done_at'] ?? nowIso()) : null;
      ctx.sqlite.prepare('UPDATE task SET done_at = ? WHERE id = ?').run(doneAt, id);
    }

    return read(ctx, kind, id);
  })();
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

export function restore(ctx: DbCtx, kind: 'task' | 'milestone', id: string): unknown {
  return ctx.sqlite.transaction(() => {
    const row = readRow(ctx, kind, id);
    if (!row) throw new NotFound();

    ctx.sqlite
      .prepare(`UPDATE ${TABLE[kind]} SET archived_at = NULL, updated_at = ?, version = version + 1
                WHERE id = ?`)
      .run(nowIso(), id);
    // Alles, was nur wegen dieses Eintrags verdeckt war, wird wieder sichtbar.
    ctx.sqlite.prepare('UPDATE task SET hidden_by = NULL WHERE hidden_by = ?').run(id);

    return read(ctx, kind, id);
  })();
}

export type MoveTarget = {
  parentId?: string | null | undefined;
  milestoneId?: string | null | undefined;
  groupId?: string | null | undefined;
  /** Nur für lose Wurzeln: entscheidet über die smarte Gruppe. Fehlt es, bleibt die Markierung. */
  markId?: string | null | undefined;
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
    const doc = target.doc === undefined ? (Number(current['doc']) ? 1 : 0) : target.doc ? 1 : 0;

    ctx.sqlite
      .prepare(
        `UPDATE task SET parent_id = ?, milestone_id = ?, group_id = ?, project_id = ?,
           mark_id = ?, doc = ?, sort_order = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
      )
      .run(
        parentId,
        milestoneId,
        groupId,
        projectId,
        markId,
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

    if (target.index !== undefined) {
      reorder(
        ctx,
        {
          parentId,
          milestoneId,
          groupId,
          projectId: String(projectId),
          markId: (markId as string | null) ?? null,
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
  const siblings = containerIds(ctx, where).filter((x) => x !== movedId);
  siblings.splice(Math.min(index, siblings.length), 0, movedId);

  const set = ctx.sqlite.prepare('UPDATE task SET sort_order = ? WHERE id = ?');
  siblings.forEach((sid, i) => set.run(i, sid));
}

/** Der Behälter, in dem Wurzelaufgaben nebeneinander liegen. */
type Container = {
  parentId: string | null;
  milestoneId: string | null;
  groupId: string | null;
  projectId: string;
  /** Nur für lose Wurzeln: Unsortiert und jede smarte Gruppe zählen getrennt. */
  markId: string | null;
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
          : [
              // Unsortiert und jede smarte Gruppe sind eigene Behälter.
              `parent_id IS NULL AND milestone_id IS NULL AND group_id IS NULL
                 AND project_id = ? AND doc = 0 AND mark_id IS ?`,
              [where.projectId, where.markId],
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

/** Spalten, die die Kopie nicht erbt: Kennung, Titel, Zeitstempel, Version. */
const FRESH_ON_COPY = new Set(['id', 'parent_id', 'title', 'created_at', 'updated_at', 'version']);

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

    // Rückwärts zurücknehmen, sonst stolpern Verschiebungen übereinander.
    return { count: targets.length, undo: undo.reverse() };
  })();
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
        case 'untrash':
          // Was aus dem Papierkorb kommt, bekommt neue Zeilen – ein sauberes
          // Gegenstück gibt es dafür nicht, also endet die Kette hier.
          restoreTrash(ctx, s.trashId);
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
    const detached =
      kind === 'milestone'
        ? detachRoots(ctx, 'milestone_id', id)
        : kind === 'group'
          ? detachRoots(ctx, 'group_id', id)
          : [];

    const taskIds =
      kind === 'task'
        ? [id, ...descendantIds(ctx, id)]
        : kind === 'project'
          ? projectTaskIds(ctx, id)
          : [];

    // Ein Projekt besitzt Kategorien, Gruppen und Milestones; die Datenbank
    // löscht sie mit, also müssen sie mit in den Eintrag.
    const owned = (table: string): Record<string, unknown>[] =>
      kind === 'project' ? rowsFor(ctx, table, 'project_id', [id]) as Record<string, unknown>[] : [];
    const categories = owned('category');
    const groups = owned('"group"');
    const milestones = owned('milestone');
    const milestoneIds = milestones.map((m) => m['id'] as string);

    const payload = {
      kind,
      row,
      categories,
      groups,
      milestones,
      milestoneLog: milestoneIds.length ? rowsFor(ctx, 'milestone_log', 'milestone_id', milestoneIds) : [],
      tasks: taskIds.length ? rowsIn(ctx, 'task', taskIds) : [],
      tags: taskIds.length ? rowsFor(ctx, 'task_tag', 'task_id', taskIds) : [],
      drawings: taskIds.length ? rowsFor(ctx, 'drawing', 'task_id', taskIds) : [],
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
        String(row['title'] ?? row['name'] ?? ''),
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
};

/** Nach dieser Frist räumt sich der Papierkorb selbst auf. */
export const TRASH_DAYS = 30;

export function loadTrash(ctx: DbCtx): TrashEntry[] {
  const rows = ctx.sqlite
    .prepare('SELECT * FROM trash ORDER BY deleted_at DESC')
    .all() as { id: string; kind: string; title: string; project_id: string | null; deleted_at: string; payload: string }[];

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    projectId: r.project_id,
    deletedAt: r.deleted_at,
    taskCount: (JSON.parse(r.payload) as { tasks: unknown[] }).tasks.length,
  }));
}

type TrashPayload = {
  kind: Kind;
  row: Record<string, unknown>;
  /** Nur bei einem Projekt; ältere Einträge haben sie nicht. */
  categories?: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
  milestones?: Record<string, unknown>[];
  milestoneLog?: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  drawings: Record<string, unknown>[];
  deps: Record<string, unknown>[];
};

/** Schreibt einen Papierkorb-Eintrag samt allem, was daran hing, zurück. */
export function restoreTrash(ctx: DbCtx, trashId: string): { restored: number } {
  return ctx.sqlite.transaction(() => {
    const entry = ctx.sqlite.prepare('SELECT * FROM trash WHERE id = ?').get(trashId) as
      | { payload: string }
      | undefined;
    if (!entry) throw new NotFound();

    const p = JSON.parse(entry.payload) as TrashPayload;
    insertRows(ctx, TABLE[p.kind], [p.row]);
    // Erst was das Projekt besitzt, dann die Aufgaben, die darauf zeigen.
    insertRows(ctx, 'category', p.categories ?? []);
    insertRows(ctx, '"group"', p.groups ?? []);
    insertRows(ctx, 'milestone', p.milestones ?? []);
    insertRows(ctx, 'milestone_log', p.milestoneLog ?? []);
    insertRows(ctx, 'task', parentsFirst(p.tasks));
    insertRows(ctx, 'task_tag', p.tags);
    insertRows(ctx, 'drawing', p.drawings);
    insertRows(ctx, 'dependency', p.deps);

    // Verweise, deren Gegenstück inzwischen fehlt, fallen wieder raus.
    pruneDependencies(ctx);
    // Die Zugehörigkeit kann sich geändert haben, während der Eintrag im Papierkorb lag.
    for (const t of p.tasks) {
      if (!t['parent_id']) refreshHidden(ctx, t['id'] as string);
    }

    ctx.sqlite.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
    return { restored: p.tasks.length || 1 };
  })();
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

export function purgeTrash(ctx: DbCtx, trashId: string): void {
  ctx.sqlite.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
}

/** Läuft beim Start: alles, was die Frist überschritten hat, ist endgültig weg. */
export function expireTrash(ctx: DbCtx, days = TRASH_DAYS): number {
  const limit = new Date(Date.now() - days * 864e5).toISOString();
  return ctx.sqlite.prepare('DELETE FROM trash WHERE deleted_at < ?').run(limit).changes;
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
      from_id NOT IN (SELECT id FROM task) OR to_id NOT IN (SELECT id FROM task));
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
  if (kind === 'project' || kind === 'mark') {
    const table = kind === 'project' ? 'project' : 'mark';
    return (
      (ctx.sqlite.prepare(`SELECT coalesce(max(sort_order), -1) AS m FROM ${table}`).get() as {
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
      : kind === 'category'
        ? ['category', 'project_id = ?', input['projectId']]
        : kind === 'group'
          ? ['"group"', 'project_id = ?', input['projectId']]
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

type ProjectRow = { id: string; version: number; name: string; color: string; sort_order: number };
type CategoryRow = { id: string; version: number; project_id: string; name: string; sort_order: number };
type MarkRow = { id: string; version: number; emoji: string; name: string; sort_order: number };
type GroupRow = { id: string; version: number; project_id: string; title: string; sort_order: number };
type MilestoneRow = {
  id: string; version: number; project_id: string; title: string; desc: string; planned: number; status: string;
  sort_order: number; queue_order: number; start_date: string | null; end_date: string | null;
  end_auto: number; archived_at: string | null;
};
type TaskRow = {
  id: string; version: number; project_id: string; parent_id: string | null; milestone_id: string | null;
  group_id: string | null; doc: number; title: string; desc: string; prio: number; status: string;
  done_at: string | null; sort_order: number; category_id: string | null; mark_id: string | null;
  archived_at: string | null; hidden_by: string | null;
};

const toProject = (r: ProjectRow): Project => ({
  id: r.id, version: r.version, name: r.name, color: r.color, order: r.sort_order,
});

const toCategory = (r: CategoryRow): Category => ({
  id: r.id, version: r.version, projectId: r.project_id, name: r.name, order: r.sort_order,
});

const toMark = (r: MarkRow): Mark => ({
  id: r.id, version: r.version, emoji: r.emoji, name: r.name, order: r.sort_order,
});

const toGroup = (r: GroupRow): Group => ({
  id: r.id, version: r.version, projectId: r.project_id, title: r.title, order: r.sort_order,
});

const toMilestone = (r: MilestoneRow, deps: string[]): Milestone => ({
  id: r.id,
  version: r.version,
  projectId: r.project_id,
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
  archivedAt: r.archived_at,
  tags,
  deps,
});
