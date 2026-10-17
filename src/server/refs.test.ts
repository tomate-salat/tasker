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
      // `cover_image_id`, `play_order` und die Changelog-Spalten kommen mit späteren Migrationen dazu
      // (`ready` kam und ging wieder).
      ({ ref: _ref, ready: _ready, cover_image_id: _cover, play_order: _play, changelog: _cl, changelog_skip: _cs, changelog_order: _co, ...rest }) => rest,
    );
    assert.deepEqual(after, before);

    const c = create(ctx, 'task', { projectId: p.id, title: 'C' }) as Task;
    assert.equal(c.ref, 4);
  });
});

describe('Migration „Bereit“', () => {
  it('was ready war, steht danach unter Unsortiert auf Bereit; Offenes in aktiven Milestones ebenso', () => {
    const ctx = open(migrationsUpTo(19));
    const p = create(ctx, 'project', { name: 'Spiel' }) as { id: string };
    const task = (o: Record<string, unknown>) => (create(ctx, 'task', { projectId: p.id, ...o }) as Task).id;
    const ms = (title: string) => (create(ctx, 'milestone', { projectId: p.id, title }) as Milestone).id;
    const aktiv = ms('aktiv');
    const alt = ms('archiviert');
    ctx.sqlite.prepare("UPDATE milestone SET archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(alt);

    const war = task({ title: 'war ready' });
    const warUnklar = task({ title: 'war ready, unklar', status: 'unclear' });
    ctx.sqlite.prepare('UPDATE task SET ready = 1 WHERE id IN (?, ?)').run(war, warUnklar);
    const lose = task({ title: 'lose' });
    const wurzel = task({ title: 'Wurzel', milestoneId: aktiv });
    const kind = task({ title: 'Kind', parentId: wurzel });
    const unklar = task({ title: 'unklar', parentId: wurzel, status: 'unclear' });
    const fertig = task({ title: 'fertig', milestoneId: aktiv, status: 'done' });
    const imArchiv = task({ title: 'im Archiv', milestoneId: alt });

    migrate(ctx.db, { migrationsFolder: 'db/migrations' });

    const statusOf = (id: string) =>
      (ctx.sqlite.prepare('SELECT status FROM task WHERE id = ?').get(id) as { status: string }).status;
    assert.deepEqual(
      [war, warUnklar, lose, wurzel, kind, unklar, fertig, imArchiv].map(statusOf),
      ['ready', 'unclear', 'open', 'ready', 'ready', 'unclear', 'done', 'open'],
    );
    const columns = (ctx.sqlite.prepare('PRAGMA table_info(task)').all() as { name: string }[]).map((c) => c.name);
    assert.equal(columns.includes('ready'), false);
  });
});
