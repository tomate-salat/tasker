/**
 * Gepackte Zeichnungen: verlustfrei, ohne Bild im Archiv, und der Bestand
 * wird beim Start einmalig umgestellt – auch im Papierkorb.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Milestone, Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import {
  createDrawing,
  drawingPreview,
  loadDrawingMeta,
  loadDrawings,
  packStoredDrawings,
  patchDrawing,
  removeDrawing,
} from './drawings.js';
import { isPacked, pack, unpack } from './packing.js';
import { archive, create, remove, restore, restoreTrash } from './repo.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-packing-'));
const opened: DbCtx[] = [];
after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let ctx: DbCtx;
let n = 0;
beforeEach(() => {
  ctx = createDbCtx(join(dir, `p${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
});

const mkProject = () => create(ctx, 'project', { name: 'Spiel' }) as { id: string };
const mkTask = (o: Record<string, unknown>) => create(ctx, 'task', o) as Task;

/** Eine Szene, wie Excalidraw sie liefert – mit Umlauten und genug Wiederholung zum Packen. */
const scene = {
  elements: Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, type: 'rectangle', x: i * 10, y: 0, text: 'Größe ändern ✓' })),
};
const svg = `<svg xmlns="http://www.w3.org/2000/svg">${'<rect width="10" height="10"/>'.repeat(50)}</svg>`;
const raw = (id: string) =>
  ctx.sqlite.prepare('SELECT shapes, preview_svg FROM drawing WHERE id = ?').get(id) as {
    shapes: string;
    preview_svg: string | null;
  };

describe('Zeichnungen gepackt', () => {
  it('packt verlustfrei und liest Ungepacktes wie bisher', () => {
    const text = JSON.stringify(scene);
    const packed = pack(text);
    assert.ok(isPacked(packed));
    assert.ok(packed.length < text.length / 3);
    assert.equal(unpack(packed), text);
    assert.equal(unpack(text), text);
    // Zu klein zum Packen: bleibt, wie es ist.
    assert.equal(pack('{"elements":[]}'), '{"elements":[]}');
  });

  it('speichert gepackt und liefert Szene und Bild unverändert aus', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'Spieler' });
    const d = createDrawing(ctx, { kind: 'task', id: t.id });
    assert.equal(d.preview, false);
    const saved = patchDrawing(ctx, d.id, d.version, { scene, svg });
    assert.equal(saved.preview, true);
    assert.ok(isPacked(raw(d.id).shapes) && isPacked(raw(d.id).preview_svg!));
    assert.deepEqual(loadDrawings(ctx, { kind: 'task', id: t.id })[0]!.scene, scene);
    assert.equal(drawingPreview(ctx, { kind: 'task', id: t.id }, d.name)!.svg, svg);
  });

  it('Archivieren nimmt das Bild, nicht die Szene; zurückgeholt fehlt es, bis es neu kommt', () => {
    const p = mkProject();
    const ms = create(ctx, 'milestone', { projectId: p.id, title: 'Gear' }) as Milestone;
    const t = mkTask({ projectId: p.id, title: 'Spieler', milestoneId: ms.id });
    const kid = mkTask({ projectId: p.id, title: 'Hose', parentId: t.id });
    const other = mkTask({ projectId: p.id, title: 'Bleibt' });
    const draw = (owner: { kind: 'task' | 'milestone'; id: string }) => {
      const d = createDrawing(ctx, owner);
      return patchDrawing(ctx, d.id, d.version, { scene, svg });
    };
    const onMs = draw({ kind: 'milestone', id: ms.id });
    const onKid = draw({ kind: 'task', id: kid.id });
    const onOther = draw({ kind: 'task', id: other.id });

    archive(ctx, 'milestone', ms.id);
    const meta = new Map(loadDrawingMeta(ctx).map((m) => [m.id, m]));
    assert.equal(meta.get(onMs.id)!.preview, false);
    assert.equal(meta.get(onKid.id)!.preview, false);
    assert.equal(meta.get(onOther.id)!.preview, true);
    // Die Szene bleibt, und die Version auch – ein offener Editor gerät nicht in Konflikt.
    assert.deepEqual(loadDrawings(ctx, { kind: 'task', id: kid.id })[0]!.scene, scene);
    assert.equal(meta.get(onKid.id)!.version, onKid.version);

    restore(ctx, 'milestone', ms.id);
    assert.equal(loadDrawingMeta(ctx).find((m) => m.id === onKid.id)!.preview, false);
    // Die Web-App schickt das Bild nach.
    assert.equal(patchDrawing(ctx, onKid.id, onKid.version, { svg }).preview, true);
  });

  it('Papierkorb und Wiederherstellen reichen die gepackten Zeilen weiter', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'Spieler' });
    const d = createDrawing(ctx, { kind: 'task', id: t.id });
    patchDrawing(ctx, d.id, d.version, { scene, svg });
    const gone = removeDrawing(ctx, d.id);
    const payload = (ctx.sqlite.prepare("SELECT payload FROM trash WHERE kind = 'drawing'").get() as { payload: string })
      .payload;
    assert.ok(payload.includes('"shapes":"br:'));
    const step = gone.undo[0] as { op: 'untrash'; trashId: string };
    restoreTrash(ctx, step.trashId);
    assert.deepEqual(loadDrawings(ctx, { kind: 'task', id: t.id })[0]!.scene, scene);

    remove(ctx, 'task', t.id);
    const entry = ctx.sqlite.prepare("SELECT id FROM trash WHERE kind = 'task'").get() as { id: string };
    restoreTrash(ctx, entry.id);
    assert.equal(drawingPreview(ctx, { kind: 'task', id: t.id }, d.name)!.svg, svg);
  });

  it('stellt den Bestand einmalig um – auch im Papierkorb und im Archiv', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'Spieler' });
    const old = mkTask({ projectId: p.id, title: 'Alt' });
    const gone = mkTask({ projectId: p.id, title: 'Weg' });
    // Zeilen wie vor dem Packen: Text, wie er ist.
    const put = (owner: string, name: string) =>
      ctx.sqlite
        .prepare(
          `INSERT INTO drawing (id, task_id, name, sort_order, shapes, preview_svg, created_at, updated_at, version)
           VALUES (?, ?, ?, 0, ?, ?, '2026-01-01', '2026-01-01', 1)`,
        )
        .run(`d${name}`, owner, name, JSON.stringify(scene), svg);
    put(t.id, 'Aktiv');
    put(old.id, 'Archiv');
    put(gone.id, 'Papierkorb');
    ctx.sqlite.prepare("UPDATE task SET archived_at = '2026-01-02' WHERE id = ?").run(old.id);
    // Der Papierkorb-Eintrag entsteht noch aus der ungepackten Zeile.
    remove(ctx, 'task', gone.id);
    assert.ok(!raw('dAktiv').shapes.startsWith('br:'));

    const first = packStoredDrawings(ctx);
    assert.deepEqual(first, { drawings: 3, trash: 1 });
    assert.ok(isPacked(raw('dAktiv').shapes) && isPacked(raw('dAktiv').preview_svg!));
    assert.equal(raw('dArchiv').preview_svg, null);
    assert.ok(isPacked(raw('dArchiv').shapes));
    const payload = (ctx.sqlite.prepare("SELECT payload FROM trash WHERE kind = 'task'").get() as { payload: string })
      .payload;
    assert.ok(payload.includes('"shapes":"br:') && payload.includes('"preview_svg":"br:'));

    // Nichts verloren.
    assert.deepEqual(loadDrawings(ctx, { kind: 'task', id: t.id })[0]!.scene, scene);
    assert.equal(drawingPreview(ctx, { kind: 'task', id: t.id }, 'Aktiv')!.svg, svg);
    // Ein zweiter Start ändert nichts mehr.
    assert.deepEqual(packStoredDrawings(ctx), { drawings: 0, trash: 0 });
  });
});
