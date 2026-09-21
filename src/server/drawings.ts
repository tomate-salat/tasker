import type { Step, Undoable } from '../shared/api.js';
import type { DbCtx } from './db.js';
import { newId } from './ids.js';
import { Conflict, NotFound } from './repo.js';

/**
 * Zeichnungen gehören wie im Prototyp zu einer Aufgabe oder einem Milestone und
 * werden mit Excalidraw bearbeitet. Gespeichert wird die Szene als JSON – die
 * Elemente werden nie einzeln abgefragt, immer nur als Ganzes.
 *
 * Der Bestand liefert beim Start nur die Namen (`DrawingMeta`); die Szene
 * selbst holt erst der Editor. Eine Zeichnung ist schnell ein paar hundert
 * Kilobyte groß und hat im Startpaket nichts zu suchen.
 */

export type Scene = {
  elements: unknown[];
  /** Eingebettete Bilder, wie Excalidraw sie führt. */
  files?: Record<string, unknown>;
};

/** Wem eine Zeichnung gehört. */
export type Owner = { kind: 'task' | 'milestone'; id: string };

export type DrawingMeta = {
  id: string;
  version: number;
  /** Genau eins von beiden ist gesetzt. */
  taskId: string | null;
  milestoneId: string | null;
  name: string;
  order: number;
  updatedAt: string;
};

export type Drawing = DrawingMeta & { scene: Scene };

type Row = {
  id: string;
  version: number;
  task_id: string | null;
  milestone_id: string | null;
  name: string;
  sort_order: number;
  shapes: string;
  updated_at: string;
};

const nowIso = (): string => new Date().toISOString();

const COLUMN = { task: 'task_id', milestone: 'milestone_id' } as const;

const ownerOf = (r: Row): Owner =>
  r.task_id ? { kind: 'task', id: r.task_id } : { kind: 'milestone', id: r.milestone_id as string };

const toMeta = (r: Row): DrawingMeta => ({
  id: r.id,
  version: r.version,
  taskId: r.task_id,
  milestoneId: r.milestone_id,
  name: r.name,
  order: r.sort_order,
  updatedAt: r.updated_at,
});

/** Alte Zeilen hielten nur ein Formen-Array; beides wird gelesen. */
function toScene(raw: string): Scene {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return { elements: parsed };
    const o = parsed as Scene;
    return { elements: Array.isArray(o?.elements) ? o.elements : [], ...(o?.files ? { files: o.files } : {}) };
  } catch {
    return { elements: [] };
  }
}

const toDrawing = (r: Row): Drawing => ({ ...toMeta(r), scene: toScene(r.shapes) });

/** Nur die Namen – das reicht dem Startpaket für die Anzeige in der Liste. */
export const loadDrawingMeta = (ctx: DbCtx): DrawingMeta[] =>
  (
    ctx.sqlite
      .prepare(
        'SELECT id, version, task_id, milestone_id, name, sort_order, updated_at FROM drawing ORDER BY sort_order',
      )
      .all() as Row[]
  ).map(toMeta);

export const loadDrawings = (ctx: DbCtx, owner: Owner): Drawing[] =>
  (
    ctx.sqlite
      .prepare(`SELECT * FROM drawing WHERE ${COLUMN[owner.kind]} = ? ORDER BY sort_order`)
      .all(owner.id) as Row[]
  ).map(toDrawing);

export function createDrawing(ctx: DbCtx, owner: Owner, name?: string): Drawing {
  return ctx.sqlite.transaction(() => {
    const found = ctx.sqlite.prepare(`SELECT id FROM ${owner.kind} WHERE id = ?`).get(owner.id);
    if (!found) throw new NotFound();

    const existing = loadDrawings(ctx, owner);
    const id = newId('d');
    ctx.sqlite
      .prepare(
        `INSERT INTO drawing (id, ${COLUMN[owner.kind]}, name, sort_order, shapes, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(id, owner.id, uniqueName(name, existing), existing.length, '{"elements":[]}', nowIso(), nowIso());

    return readDrawing(ctx, id);
  })();
}

export function patchDrawing(
  ctx: DbCtx,
  id: string,
  version: number,
  changes: { name?: string; scene?: Scene; order?: number },
): Drawing {
  return ctx.sqlite.transaction(() => {
    const row = ctx.sqlite.prepare('SELECT * FROM drawing WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFound();
    if (row.version !== version) throw new Conflict(toDrawing(row));

    const name =
      changes.name === undefined
        ? row.name
        : uniqueName(
            changes.name,
            loadDrawings(ctx, ownerOf(row)).filter((d) => d.id !== id),
          );

    ctx.sqlite
      .prepare(
        `UPDATE drawing SET name = ?, sort_order = ?, shapes = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
      )
      .run(
        name,
        changes.order ?? row.sort_order,
        changes.scene ? JSON.stringify(changes.scene) : row.shapes,
        nowIso(),
        id,
      );

    return readDrawing(ctx, id);
  })();
}

/**
 * Wie im Prototyp verschwindet mit der Zeichnung auch `![[zeichnung:Name]]` aus
 * der Beschreibung. Damit „Rückgängig“ sie zurückholen kann, liegt sie danach
 * als Papierkorb-Eintrag vor – der erscheint aber nicht in der Papierkorb-Liste
 * (im Prototyp gibt es gelöschte Zeichnungen dort auch nicht) und läuft mit der
 * üblichen Frist ab.
 *
 * Gibt den Besitzer mit zurück, damit der Änderungs-Strom ihn nennen kann.
 */
export function removeDrawing(ctx: DbCtx, id: string): Undoable & { ownerId: string } {
  return ctx.sqlite.transaction(() => {
    const row = ctx.sqlite.prepare('SELECT * FROM drawing WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFound();
    const owner = ownerOf(row);
    const item = ctx.sqlite
      .prepare(`SELECT "desc", project_id FROM ${owner.kind} WHERE id = ?`)
      .get(owner.id) as { desc: string; project_id: string };

    const trashId = newId('x');
    ctx.sqlite
      .prepare(
        `INSERT INTO trash (id, kind, title, project_id, payload, deleted_at)
         VALUES (?, 'drawing', ?, ?, ?, ?)`,
      )
      .run(trashId, row.name, item.project_id, JSON.stringify({ kind: 'drawing', row, tasks: [] }), nowIso());
    ctx.sqlite.prepare('DELETE FROM drawing WHERE id = ?').run(id);

    const undo: Step[] = [{ op: 'untrash', trashId }];
    if (item.desc.includes(`![[zeichnung:${row.name}]]`)) {
      const desc = stripEmbed(item.desc, row.name);
      ctx.sqlite
        .prepare(`UPDATE ${owner.kind} SET "desc" = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
        .run(desc, nowIso(), owner.id);
      const { version } = ctx.sqlite.prepare(`SELECT version FROM ${owner.kind} WHERE id = ?`).get(owner.id) as {
        version: number;
      };
      undo.push({ op: 'patch', kind: owner.kind, id: owner.id, version, changes: { desc: item.desc } });
    }
    return { count: 1, undo, ownerId: owner.id };
  })();
}

/** Nimmt die Einbettung heraus, wie der Prototyp: ohne Lücke von Leerzeilen. */
export const stripEmbed = (desc: string, name: string): string =>
  desc
    .split(`![[zeichnung:${name}]]`)
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

function readDrawing(ctx: DbCtx, id: string): Drawing {
  const row = ctx.sqlite.prepare('SELECT * FROM drawing WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new NotFound();
  return toDrawing(row);
}

/** Namen müssen je Besitzer eindeutig sein, damit `![[zeichnung:Name]]` trifft. */
function uniqueName(wanted: string | undefined, existing: { name: string }[]): string {
  const base = (wanted ?? '').trim() || 'Zeichnung';
  const taken = new Set(existing.map((d) => d.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
