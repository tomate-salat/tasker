/**
 * Der MCP-Endpunkt: Tokens und die Werkzeuge, so wie ein Client sie aufruft –
 * als JSON-RPC über HTTP, ohne Sitzung.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Envelope } from '../shared/events.js';
import type { Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import { EventBus } from './events.js';
import { handleMcp } from './mcp.js';
import { create } from './repo.js';
import { createToken, listTokens, revokeToken, tokenValid } from './tokens.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-mcp-'));
const opened: DbCtx[] = [];
after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let ctx: DbCtx;
let bus: EventBus;
let seen: Envelope[];
let projectId: string;
let n = 0;

beforeEach(() => {
  ctx = createDbCtx(join(dir, `m${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
  bus = new EventBus();
  seen = [];
  bus.subscribe((e) => seen.push(e));
  projectId = (create(ctx, 'project', { name: 'Spiel' }) as { id: string }).id;
});

let rpcId = 0;
async function call(name: string, args: Record<string, unknown> = {}) {
  const res = await handleMcp(
    ctx,
    bus,
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } }),
    }),
  );
  assert.equal(res.status, 200);
  const body = (await res.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  const text = body.result.content[0]?.text ?? '';
  return { error: !!body.result.isError, text, data: body.result.isError ? null : JSON.parse(text) };
}

describe('Tokens', () => {
  it('gilt nur als Bearer und nur bis zum Zurückziehen', () => {
    const t = createToken(ctx, 'Laptop');
    assert.match(t.token, /^tsk_/);
    assert.equal(tokenValid(ctx, `Bearer ${t.token}`), true);
    assert.equal(tokenValid(ctx, t.token), false);
    assert.equal(tokenValid(ctx, `Bearer ${t.token}x`), false);
    assert.equal(tokenValid(ctx, undefined), false);

    const listed = listTokens(ctx);
    assert.equal(listed.length, 1);
    assert.ok(listed[0]?.lastUsedAt, 'Benutzung wird vermerkt');
    assert.ok(!JSON.stringify(listed).includes(t.token), 'das Token selbst steht nirgends');

    assert.equal(revokeToken(ctx, t.id), true);
    assert.equal(tokenValid(ctx, `Bearer ${t.token}`), false);
  });
});

describe('Werkzeuge', () => {
  it('legt an, findet per Nummer und ändert', async () => {
    const made = await call('create_task', { projectId, title: 'Sprung', prio: 1, tags: ['physik'] });
    assert.equal(made.error, false);
    assert.equal(made.data.place, 'Backlog');
    assert.equal(seen.at(-1)?.event.type, 'upsert');

    const got = await call('get_task', { task: made.data.ref });
    assert.equal(got.data.title, 'Sprung');
    assert.deepEqual(got.data.tags, ['physik']);

    const done = await call('update_task', { task: made.data.id, status: 'done', desc: 'fertig' });
    assert.equal(done.data.status, 'done');
    assert.equal(done.data.desc, 'fertig');

    const open = await call('list_tasks', {});
    assert.equal(open.data.total, 0, 'Erledigtes fehlt ohne includeDone');
    const all = await call('list_tasks', { includeDone: true, query: 'sprung' });
    assert.equal(all.data.total, 1);
  });

  it('Unteraufgaben erben das Projekt, und der Ort lässt sich ändern', async () => {
    const parent = await call('create_task', { projectId, title: 'Level 1' });
    const kid = await call('create_task', { parent: parent.data.ref, title: 'Boden' });
    assert.equal(kid.data.projectId, projectId);
    assert.match(kid.data.place, /^Unteraufgabe/);

    const ms = create(ctx, 'milestone', { projectId, title: 'Alpha' }) as { id: string; ref: number };
    const moved = await call('update_task', { task: kid.data.id, milestone: `$${ms.ref}` });
    assert.equal(moved.data.milestoneId, ms.id);
    assert.equal(moved.data.parentId, null);

    const loose = await call('update_task', { task: kid.data.id, milestone: '', ready: true });
    assert.equal(loose.data.place, 'Ready');
  });

  it('meldet Fehler als Ergebnis statt abzustürzen', async () => {
    const missing = await call('get_task', { task: '$999' });
    assert.equal(missing.error, true);
    const noProject = await call('create_task', { title: 'wohin?' });
    assert.equal(noProject.error, true);
    const stale = create(ctx, 'task', { projectId, title: 'x' }) as Task;
    const conflict = await call('update_task', { task: stale.id, title: 'y', version: stale.version + 5 });
    assert.equal(conflict.error, true);
  });
});
