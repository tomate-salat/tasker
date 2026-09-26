import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Milestone, Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import { create, duplicate, loadBootstrap, remove, restoreTrash } from './repo.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-refs-'));
const opened: DbCtx[] = [];
let n = 0;

after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const open = (migrations = 'db/migrations'): DbCtx => {
  const ctx = createDbCtx(join(dir, `r${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: migrations });
  return ctx;
};

/**
 * Ein Projekt auf einem alten Stand: `create` legt heute Markierungen mit an,
 * die es dort noch nicht je Projekt gibt.
 */
function oldProject(ctx: DbCtx): { id: string } {
  const id = `p${n++}`;
  ctx.sqlite.prepare('INSERT INTO project (id, name) VALUES (?, ?)').run(id, 'Spiel');
  return { id };
}

/** Die Migrationen bis einschließlich `last` – für den Stand vor den Verweis-Nummern. */
function migrationsUpTo(last: number): string {
  const target = join(dir, `migrations-${last}`);
  cpSync('db/migrations', target, { recursive: true });
  const journalPath = join(target, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { idx: number }[] };
  journal.entries = journal.entries.filter((e) => e.idx <= last);
  writeFileSync(journalPath, JSON.stringify(journal));
  return target;
}

describe('Verweis-Nummern', () => {
  it('Aufgaben und Milestones teilen sich eine fortlaufende Folge', () => {
    const ctx = open();
    const p = create(ctx, 'project', { name: 'Spiel' }) as { id: string };
    const a = create(ctx, 'task', { projectId: p.id, title: 'A' }) as Task;
    const m = create(ctx, 'milestone', { projectId: p.id, title: 'M' }) as Milestone;
    const b = create(ctx, 'task', { projectId: p.id, title: 'B' }) as Task;
    assert.deepEqual([a.ref, m.ref, b.ref], [1, 2, 3]);
  });

  it('eine Kopie bekommt eine neue Nummer, auch ihre Unteraufgaben', () => {
    const ctx = open();
    const p = create(ctx, 'project', { name: 'Spiel' }) as { id: string };
    const a = create(ctx, 'task', { projectId: p.id, title: 'A' }) as Task;
    create(ctx, 'task', { projectId: p.id, parentId: a.id, title: 'Kind' });
    duplicate(ctx, a.id);
    const refs = loadBootstrap(ctx).tasks.map((t) => t.ref);
    assert.deepEqual([...refs].sort((x, y) => x - y), [1, 2, 3, 4]);
  });

  it('aus dem Papierkorb zurückgeholt behält die Nummer; gelöschte Nummern kommen nicht wieder', () => {
    const ctx = open();
    const p = create(ctx, 'project', { name: 'Spiel' }) as { id: string };
    const a = create(ctx, 'task', { projectId: p.id, title: 'A' }) as Task;
    const { trashId } = remove(ctx, 'task', a.id);
    const b = create(ctx, 'task', { projectId: p.id, title: 'B' }) as Task;
    assert.equal(b.ref, 2);
    restoreTrash(ctx, trashId);
    const back = loadBootstrap(ctx).tasks.find((t) => t.id === a.id);
    assert.equal(back?.ref, 1);
  });

  it('die Migration nummeriert Bestehendes nach dem Anlegen und ändert sonst nichts', () => {
    const ctx = open(migrationsUpTo(4));
    const p = oldProject(ctx);
    const stamp = (table: string, id: string, at: string) =>
      ctx.sqlite.prepare(`UPDATE ${table} SET created_at = ? WHERE id = ?`).run(at, id);
    const m = create(ctx, 'milestone', { projectId: p.id, title: 'M' }) as { id: string };
    const a = create(ctx, 'task', { projectId: p.id, title: 'A', desc: 'Text', tags: ['x'] }) as {
      id: string;
    };
    const b = create(ctx, 'task', { projectId: p.id, parentId: a.id, title: 'B' }) as { id: string };
    stamp('task', a.id, '2026-01-01T00:00:00.000Z');
    stamp('milestone', m.id, '2026-01-02T00:00:00.000Z');
    stamp('task', b.id, '2026-01-03T00:00:00.000Z');
    const before = ctx.sqlite.prepare('SELECT * FROM task ORDER BY id').all();

    migrate(ctx.db, { migrationsFolder: 'db/migrations' });

    const refOf = (table: string, id: string) =>
      (ctx.sqlite.prepare(`SELECT ref FROM ${table} WHERE id = ?`).get(id) as { ref: number }).ref;
    assert.deepEqual([refOf('task', a.id), refOf('milestone', m.id), refOf('task', b.id)], [1, 2, 3]);

    const after = (ctx.sqlite.prepare('SELECT * FROM task ORDER BY id').all() as Record<string, unknown>[]).map(
      // `ready` und `cover_image_id` kommen mit späteren Migrationen dazu.
      ({ ref: _ref, ready: _ready, cover_image_id: _cover, ...rest }) => rest,
    );
    assert.deepEqual(after, before);

    const c = create(ctx, 'task', { projectId: p.id, title: 'C' }) as Task;
    assert.equal(c.ref, 4);
  });
});

describe('Migration „ready“', () => {
  it('was in einer smarten Gruppe stand, steht danach in „Ready“ – sonst bleibt alles im Backlog', () => {
    const ctx = open(migrationsUpTo(6));
    const p = oldProject(ctx);
    // Vor Migration 0014 gelten Markierungen für alle Projekte.
    const k = { id: 'k1' };
    ctx.sqlite.prepare("INSERT INTO mark (id, emoji, name) VALUES ('k1', '🐛', 'Bug')").run();
    const g = create(ctx, 'group', { projectId: p.id, title: 'G' }) as { id: string };
    const task = (o: Record<string, unknown>) => (create(ctx, 'task', { projectId: p.id, ...o }) as Task).id;
    const smart = task({ title: 'smart', markId: k.id });
    const plain = task({ title: 'lose' });
    const grouped = task({ title: 'in Gruppe', groupId: g.id, markId: k.id });
    const child = task({ title: 'Kind', parentId: smart, markId: k.id });
    const page = task({ title: 'Seite', doc: true, markId: k.id });

    migrate(ctx.db, { migrationsFolder: 'db/migrations' });

    const readyOf = (id: string) =>
      (ctx.sqlite.prepare('SELECT ready FROM task WHERE id = ?').get(id) as { ready: number }).ready;
    assert.deepEqual(
      [smart, plain, grouped, child, page].map(readyOf),
      [1, 0, 0, 0, 0],
    );
  });
});
