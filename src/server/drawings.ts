import type { Step, Undoable } from '../shared/api.js';
import type { DbCtx } from './db.js';
import { newId } from './ids.js';
import { Conflict, NotFound } from './repo.js';

/**
 * Zeichnungen gehören zu einer Aufgabe und werden mit Excalidraw bearbeitet.
 * Gespeichert wird die Szene als JSON – die Elemente werden nie einzeln
 * abgefragt, immer nur als Ganzes.
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

export type DrawingMeta = {
  id: string;
  version: number;
  taskId: string;
  name: string;
  order: number;
  updatedAt: string;
};

export type Drawing = DrawingMeta & { scene: Scene };

type Row = {
  id: string;
  version: number;
  task_id: string;
  name: string;
  sort_order: number;
  shapes: string;
  updated_at: string;
};

const nowIso = (): string => new Date().toISOString();

const toMeta = (r: Row): DrawingMeta => ({
  id: r.id,
  version: r.version,
  taskId: r.task_id,
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

/** Nur die Namen – das reicht dem Startpaket für die Anzeige am Task. */
export const loadDrawingMeta = (ctx: DbCtx): DrawingMeta[] =>
  (
    ctx.sqlite
      .prepare('SELECT id, version, task_id, name, sort_order, updated_at FROM drawing ORDER BY sort_order')
      .all() as Row[]
  ).map(toMeta);

export const loadDrawings = (ctx: DbCtx, taskId: string): Drawing[] =>
  (
    ctx.sqlite.prepare('SELECT * FROM drawing WHERE task_id = ? ORDER BY sort_order').all(taskId) as Row[]
  ).map(toDrawing);

export function createDrawing(ctx: DbCtx, taskId: string, name?: string): Drawing {
  return ctx.sqlite.transaction(() => {
    const task = ctx.sqlite.prepare('SELECT id FROM task WHERE id = ?').get(taskId);
    if (!task) throw new NotFound();

    const existing = loadDrawings(ctx, taskId);
    const id = newId('d');
    ctx.sqlite
      .prepare(
        `INSERT INTO drawing (id, task_id, name, sort_order, shapes, created_at, updated_at, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(id, taskId, uniqueName(name, existing), existing.length, '{"elements":[]}', nowIso(), nowIso());

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
            loadDrawings(ctx, row.task_id).filter((d) => d.id !== id),
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
 * Gibt die Aufgabe mit zurück, damit der Änderungs-Strom sie nennen kann.
 */
export function removeDrawing(ctx: DbCtx, id: string): Undoable & { taskId: string } {
  return ctx.sqlite.transaction(() => {
    const row = ctx.sqlite.prepare('SELECT * FROM drawing WHERE id = ?').get(id) as Row | undefined;
    if (!row) throw new NotFound();
    const task = ctx.sqlite.prepare('SELECT "desc", project_id FROM task WHERE id = ?').get(row.task_id) as {
      desc: string;
      project_id: string;
    };

    const trashId = newId('x');
    ctx.sqlite
      .prepare(
        `INSERT INTO trash (id, kind, title, project_id, payload, deleted_at)
         VALUES (?, 'drawing', ?, ?, ?, ?)`,
      )
      .run(trashId, row.name, task.project_id, JSON.stringify({ kind: 'drawing', row, tasks: [] }), nowIso());
    ctx.sqlite.prepare('DELETE FROM drawing WHERE id = ?').run(id);

    const undo: Step[] = [{ op: 'untrash', trashId }];
    if (task.desc.includes(`![[zeichnung:${row.name}]]`)) {
      const desc = stripEmbed(task.desc, row.name);
      ctx.sqlite
        .prepare('UPDATE task SET "desc" = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(desc, nowIso(), row.task_id);
      const { version } = ctx.sqlite.prepare('SELECT version FROM task WHERE id = ?').get(row.task_id) as {
        version: number;
      };
      undo.push({ op: 'patch', kind: 'task', id: row.task_id, version, changes: { desc: task.desc } });
    }
    return { count: 1, undo, taskId: row.task_id };
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

/** Namen müssen je Aufgabe eindeutig sein, damit `![[zeichnung:Name]]` trifft. */
function uniqueName(wanted: string | undefined, existing: { name: string }[]): string {
  const base = (wanted ?? '').trim() || 'Zeichnung';
  const taken = new Set(existing.map((d) => d.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
