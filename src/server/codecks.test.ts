import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { importCodecks, parseCsv } from './codecks.js';
import { createDbCtx, type DbCtx } from './db.js';
import { create, loadBootstrap } from './repo.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-codecks-'));
const opened: DbCtx[] = [];

after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let ctx: DbCtx;
let n = 0;

beforeEach(() => {
  ctx = createDbCtx(join(dir, `t${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
});

const HEAD =
  '"Card id";"Title";"Content";"Effort";"Priority";"Owner";"Project tags";"Workflow state";"Deck name";"Parent Card Title";"Parent Card Id";"Project name";"Milestone name";"Milestone date";"Creation date";"Upvotes";"Card link"';

const row = (o: Record<string, string>): string =>
  [
    o.id,
    o.title,
    o.content ?? o.title,
    '',
    o.prio ?? '',
    'Thomas',
    o.tags ?? '',
    o.state ?? 'unassigned',
    o.deck ?? 'Backlog',
    '',
    o.parent ?? '',
    'Spiel',
    o.milestone ?? '',
    o.date ?? '',
    '2026-08-30T09:45:02.772Z',
    '0',
    'https://x.codecks.io/card/1',
  ]
    .map((f = '') => `"${f.replace(/"/g, '""')}"`)
    .join(';');

const CSV = [
  HEAD,
  row({
    id: 'h1',
    title: 'Arena',
    content: 'Arena\n\nAls Spieler will ich; eine "Arena".\n\n- [ ] Boden',
    prio: '3',
    state: 'hero',
    deck: 'Kampf',
    milestone: 'Sprint 1',
    date: '2026-09-23',
  }),
  row({ id: 'k1', title: 'Boden modellieren', deck: 'Art', parent: 'h1', state: 'assigned', prio: '1' }),
  row({ id: 'k2', title: 'Spawn', deck: 'Game Design', parent: 'h1', tags: 'unclear' }),
  row({ id: 'b1', title: 'Absturz beim Laden', deck: 'Bugs', tags: 'bug', prio: '2' }),
  row({ id: 'l1', title: 'Irgendwann', deck: 'Backlog' }),
  row({ id: 'd1', title: 'Regeln', content: 'Regeln\n# Kampf', state: 'doc', deck: 'Docs' }),
].join('\r\n');

describe('Codecks-Import', () => {
  it('liest Felder mit Semikolon, Anführungszeichen und Zeilenumbrüchen', () => {
    const rows = parseCsv('"a";"x; ""y""\nz"\r\n"b";""');
    assert.deepEqual(rows, [
      ['a', 'x; "y"\nz'],
      ['b', ''],
    ]);
  });

  it('bildet Projekt, Decks, Hero-Cards, Milestone und Doku ab', () => {
    const summary = importCodecks(ctx, CSV);
    assert.deepEqual(summary, {
      projects: ['Spiel'],
      categories: ['Kampf', 'Bugs'],
      labels: ['art', 'game-design'],
      milestones: ['Sprint 1'],
      tasks: 3,
      subtasks: 2,
      docs: 1,
      unclear: 1,
    });

    const data = loadBootstrap(ctx);
    const task = (title: string) => data.tasks.find((t) => t.title === title)!;
    const cat = (name: string) => data.categories.find((c) => c.name === name)!.id;
    const [ms] = data.milestones;

    assert.equal(ms!.planned, true);
    assert.equal(ms!.endDate, '2026-09-23');
    assert.equal(ms!.endAuto, false);

    const arena = task('Arena');
    assert.equal(arena.milestoneId, ms!.id);
    assert.equal(arena.categoryId, cat('Kampf'));
    assert.equal(arena.prio, 1);
    assert.equal(arena.desc, 'Als Spieler will ich; eine "Arena".\n\n- [ ] Boden');

    const boden = task('Boden modellieren');
    assert.equal(boden.parentId, arena.id);
    assert.equal(boden.categoryId, null);
    assert.deepEqual(boden.tags, ['art']);
    assert.equal(boden.prio, 3);

    assert.equal(task('Spawn').status, 'unclear');
    assert.deepEqual(task('Spawn').tags, ['game-design']);

    const bug = task('Absturz beim Laden');
    assert.equal(bug.categoryId, cat('Bugs'));
    assert.deepEqual(bug.tags, ['bug']);
    assert.equal(bug.milestoneId, null);

    const loose = task('Irgendwann');
    assert.equal(loose.categoryId, null);
    assert.equal(loose.groupId, null);

    const doc = task('Regeln');
    assert.equal(doc.doc, true);
    assert.equal(doc.desc, '# Kampf');

    assert.ok(data.tasks.every((t) => t.status === 'open' || t.title === 'Spawn'));
  });

  it('schreibt bei der Vorschau nichts', () => {
    const summary = importCodecks(ctx, CSV, { dryRun: true });
    assert.equal(summary.tasks, 3);
    assert.equal(loadBootstrap(ctx).projects.length, 0);
  });

  it('bricht ab, wenn das Projekt schon existiert – ohne Reste', () => {
    create(ctx, 'project', { name: 'Spiel' });
    assert.throws(() => importCodecks(ctx, CSV), /gibt es schon/);
    assert.equal(loadBootstrap(ctx).tasks.length, 0);
  });

  it('lehnt eine Datei ohne die nötigen Spalten ab', () => {
    assert.throws(() => importCodecks(ctx, '"Title";"Content"\n"a";"b"'), /es fehlt/);
  });
});
