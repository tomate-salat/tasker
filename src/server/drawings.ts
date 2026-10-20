import type { Step, Undoable } from '../shared/api.js';
import type { DbCtx } from './db.js';
import { newId } from './ids.js';
import { isPacked, pack, unpack } from './packing.js';
import { Conflict, NotFound } from './repo.js';

/**
 * Zeichnungen gehören wie im Prototyp zu einer Aufgabe oder einem Milestone und
 * werden mit Excalidraw bearbeitet. Gespeichert wird die Szene als JSON – die
 * Elemente werden nie einzeln abgefragt, immer nur als Ganzes.
 *
 * Der Bestand liefert beim Start nur die Namen (`DrawingMeta`); die Szene
 * selbst holt erst der Editor. Eine Zeichnung ist schnell ein paar hundert
 * Kilobyte groß und hat im Startpaket nichts zu suchen.
 *
 * Neben der Szene liegt ihr Bild als SVG (`preview_svg`), gezeichnet von der
 * Web-App beim Speichern – der Server kann Excalidraw nicht selbst zeichnen.
 * Es gilt nur für genau diese Szene: wer die Szene ohne SVG ändert, leert es.
 *
 * Szene und SVG liegen gepackt in der Datenbank (`packing.ts`). Beim
 * Archivieren fällt das SVG weg – es braucht nur das Godot-Addon, und die
 * Web-App zeichnet es nach, sobald der Eintrag zurückkommt und geöffnet wird
 * (`preview` sagt ihr, wo es fehlt).
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
  /** Liegt ein Bild für Godot vor? Sonst zeichnet die Web-App es nach. */
  preview: boolean;
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
  preview_svg: string | null;
  updated_at: string;
  /** Aus der Abfrage: ob `preview_svg` gesetzt ist, ohne es zu laden. */
  has_preview: number;
};

/** Alle Spalten und dazu, ob ein Bild da ist. */
const COLUMNS = '*, preview_svg IS NOT NULL AS has_preview';

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
  preview: !!r.has_preview,
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

const toDrawing = (r: Row): Drawing => ({ ...toMeta(r), scene: toScene(unpack(r.shapes)) });

/** Nur die Namen – das reicht dem Startpaket für die Anzeige in der Liste. */
export const loadDrawingMeta = (ctx: DbCtx): DrawingMeta[] =>
  (
    ctx.sqlite
      .prepare(
        `SELECT id, version, task_id, milestone_id, name, sort_order, updated_at,
                preview_svg IS NOT NULL AS has_preview FROM drawing ORDER BY sort_order`,
      )
      .all() as Row[]
  ).map(toMeta);

export const loadDrawings = (ctx: DbCtx, owner: Owner): Drawing[] =>
  (
    ctx.sqlite
      .prepare(`SELECT ${COLUMNS} FROM drawing WHERE ${COLUMN[owner.kind]} = ? ORDER BY sort_order`)
      .all(owner.id) as Row[]
  ).map(toDrawing);

/**
 * Das gespeicherte Bild einer Zeichnung, gefunden wie im Text: über den
 * Besitzer und den Namen aus `![[zeichnung:Name]]`. Die Szene bleibt dabei
 * in der Datenbank.
 */
export function drawingPreview(
  ctx: DbCtx,
  owner: Owner,
  name: string,
): { id: string; version: number; svg: string | null } | null {
  const row = ctx.sqlite
    .prepare(`SELECT id, version, preview_svg FROM drawing WHERE ${COLUMN[owner.kind]} = ? AND name = ?`)
    .get(owner.id, name) as Pick<Row, 'id' | 'version' | 'preview_svg'> | undefined;
  return row ? { id: row.id, version: row.version, svg: row.preview_svg && unpack(row.preview_svg) } : null;
}

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
  changes: { name?: string; scene?: Scene; svg?: string; order?: number },
): Drawing {
  return ctx.sqlite.transaction(() => {
    const row = ctx.sqlite.prepare(`SELECT ${COLUMNS} FROM drawing WHERE id = ?`).get(id) as Row | undefined;
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
        `UPDATE drawing SET name = ?, sort_order = ?, shapes = ?, preview_svg = ?, updated_at = ?, version = version + 1
         WHERE id = ?`,
      )
      .run(
        name,
        changes.order ?? row.sort_order,
        changes.scene ? pack(JSON.stringify(changes.scene)) : row.shapes,
        // Eine neue Szene ohne Bild macht das alte ungültig; ein Bild allein
        // gilt der Szene, die schon da ist (die Version ist geprüft).
        changes.svg ? pack(changes.svg) : changes.scene ? null : row.preview_svg,
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
  const row = ctx.sqlite.prepare(`SELECT ${COLUMNS} FROM drawing WHERE id = ?`).get(id) as Row | undefined;
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

/**
 * Archivieren: die Bilder der Zeichnungen fallen weg, die Szenen bleiben. Ohne
 * neue Version – das Bild hängt nur an der Szene, und ein offener Editor soll
 * deshalb nicht in einen Konflikt laufen.
 */
export function dropPreviews(ctx: DbCtx, owners: { taskIds: string[]; milestoneIds: string[] }): void {
  const drop = (column: string, ids: string[]): void => {
    for (let i = 0; i < ids.length; i += 500) {
      const part = ids.slice(i, i + 500);
      ctx.sqlite
        .prepare(`UPDATE drawing SET preview_svg = NULL WHERE ${column} IN (${part.map(() => '?').join(',')})`)
        .run(...part);
    }
  };
  drop('task_id', owners.taskIds);
  drop('milestone_id', owners.milestoneIds);
}

/** Packt die Zeichnungen einer Zeile, wie sie im Papierkorb steckt. */
function packRow(row: Record<string, unknown>): boolean {
  let changed = false;
  for (const key of ['shapes', 'preview_svg']) {
    const v = row[key];
    if (typeof v === 'string' && !isPacked(v)) {
      const packed = pack(v);
      if (packed !== v) {
        row[key] = packed;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Einmalig beim Start, und danach ohne Wirkung: packt, was noch ungepackt
 * liegt – auch die Zeichnungen im Papierkorb –, nimmt archivierten Einträgen
 * das Bild und gibt den frei gewordenen Platz an das Dateisystem zurück.
 * Gibt zurück, wie viele Zeichnungen und Papierkorb-Einträge es angefasst hat.
 */
export function packStoredDrawings(ctx: DbCtx): { drawings: number; trash: number } {
  const result = ctx.sqlite.transaction(() => {
    let drawings = 0;
    const rows = ctx.sqlite.prepare('SELECT id, shapes, preview_svg FROM drawing').all() as Pick<
      Row,
      'id' | 'shapes' | 'preview_svg'
    >[];
    const update = ctx.sqlite.prepare('UPDATE drawing SET shapes = ?, preview_svg = ? WHERE id = ?');
    for (const r of rows) {
      const row: Record<string, unknown> = { ...r };
      if (packRow(row)) {
        update.run(row['shapes'], row['preview_svg'], r.id);
        drawings++;
      }
    }

    // Was schon im Archiv liegt, braucht sein Bild ebenso wenig.
    drawings += ctx.sqlite
      .prepare(
        `UPDATE drawing SET preview_svg = NULL WHERE preview_svg IS NOT NULL AND (
           task_id IN (SELECT id FROM task WHERE archived_at IS NOT NULL OR hidden_by IS NOT NULL)
           OR milestone_id IN (SELECT id FROM milestone WHERE archived_at IS NOT NULL))`,
      )
      .run().changes;

    let trash = 0;
    const entries = ctx.sqlite
      .prepare("SELECT id, payload FROM trash WHERE payload LIKE '%\"shapes\"%'")
      .all() as { id: string; payload: string }[];
    for (const e of entries) {
      const p = JSON.parse(e.payload) as { kind: string; row?: Record<string, unknown>; drawings?: Record<string, unknown>[] };
      let changed = p.kind === 'drawing' && p.row ? packRow(p.row) : false;
      for (const d of p.drawings ?? []) changed = packRow(d) || changed;
      if (changed) {
        ctx.sqlite.prepare('UPDATE trash SET payload = ? WHERE id = ?').run(JSON.stringify(p), e.id);
        trash++;
      }
    }
    return { drawings, trash };
  })();
  if (result.drawings || result.trash) {
    ctx.sqlite.exec('VACUUM');
    // Sonst bliebe die Datei der Änderungen so groß, wie das Neupacken sie gemacht hat.
    ctx.sqlite.pragma('wal_checkpoint(TRUNCATE)');
  }
  return result;
}
