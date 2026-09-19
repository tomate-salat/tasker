/**
 * Prüft die Routen selbst. Die erste Fassung hatte die Objektrouten direkt
 * unter `/:kind` und damit `/move`, `/trash` und `/settings` verschluckt;
 * seitdem liegen sie unter `/kind/<typ>` und können sich nicht mehr
 * überschneiden.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Hono } from 'hono';
import { createDbCtx, type DbCtx } from './db.js';
import { dataRoutes } from './routes.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-routes-'));
const opened: DbCtx[] = [];
after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let app: Hono;
let n = 0;

beforeEach(() => {
  const ctx = createDbCtx(join(dir, `r${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
  app = dataRoutes(ctx);
});

const send = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    ...(body === undefined
      ? {}
      : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as never };
};

const mk = async (kind: string, input: unknown) => (await send('POST', `/kind/${kind}`, input)).body as { id: string; version: number };

describe('Routen', () => {
  it('feste Pfade und Objektrouten überschneiden sich nicht', async () => {
    const p = await mk('project', { name: 'P' });
    const a = await mk('task', { projectId: p.id, title: 'A' });
    const b = await mk('task', { projectId: p.id, title: 'B' });

    const moved = await send('POST', '/move', { id: b.id, version: b.version, parentId: a.id });
    assert.equal(moved.status, 200, 'POST /move darf nicht als Typ „move“ gelesen werden');
    assert.equal((moved.body as { parentId: string }).parentId, a.id);

    assert.equal((await send('GET', '/settings')).status, 200);
    assert.equal((await send('GET', '/trash')).status, 200);

    // Ohne Präfix gibt es keine Objektroute mehr – und mit Präfix kein Gedränge.
    assert.equal((await send('POST', '/task', { projectId: p.id })).status, 404);
    assert.equal((await send('POST', '/kind/move', {})).status, 404, 'kein Typ namens „move“');
  });

  it('legt an, ändert und meldet Konflikte', async () => {
    const p = await mk('project', { name: 'P' });
    const created = await send('POST', '/kind/task', { projectId: p.id, title: 'A' });
    assert.equal(created.status, 201);

    const t = created.body as { id: string; version: number };
    assert.equal((await send('PATCH', `/kind/task/${t.id}`, { version: 1, changes: { prio: 2 } })).status, 200);

    const stale = await send('PATCH', `/kind/task/${t.id}`, { version: 1, changes: { prio: 3 } });
    assert.equal(stale.status, 409);
    assert.equal((stale.body as { current: { prio: number } }).current.prio, 2);

    const bad = await send('PATCH', `/kind/task/${t.id}`, { version: 2, changes: { prio: 7 } });
    assert.equal(bad.status, 400);
    assert.equal((await send('PATCH', '/kind/task/weg', { version: 1, changes: {} })).status, 404);
  });

  it('Papierkorb: auflisten, wiederherstellen, endgültig löschen', async () => {
    const p = await mk('project', { name: 'P' });
    const t = await mk('task', { projectId: p.id, title: 'Weg damit' });
    await send('PATCH', `/kind/task/${t.id}`, { version: 1, changes: { tags: ['code'] } });
    await mk('task', { projectId: p.id, title: 'Kind', parentId: t.id });

    await send('DELETE', `/kind/task/${t.id}`);
    const list = (await send('GET', '/trash')).body as {
      entries: { id: string; title: string; taskCount: number }[];
    };
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0]?.taskCount, 2);

    const back = await send('POST', `/trash/${list.entries[0]!.id}/restore`);
    assert.equal(back.status, 200);

    const boot = (await send('GET', '/bootstrap')).body as {
      tasks: { title: string; tags: string[] }[];
    };
    assert.equal(boot.tasks.length, 2, 'Eltern und Kind sind zurück');
    assert.deepEqual(boot.tasks.find((x) => x.title === 'Weg damit')?.tags, ['code']);
    assert.equal(((await send('GET', '/trash')).body as { entries: [] }).entries.length, 0);

    // Endgültig löschen
    const t2 = await mk('task', { projectId: p.id, title: 'Auch weg' });
    await send('DELETE', `/kind/task/${t2.id}`);
    const again = (await send('GET', '/trash')).body as { entries: { id: string }[] };
    assert.equal((await send('DELETE', `/trash/${again.entries[0]!.id}`)).status, 200);
    assert.equal(((await send('GET', '/trash')).body as { entries: [] }).entries.length, 0);
  });

  it('Einstellungen werden begrenzt und bleiben erhalten', async () => {
    assert.deepEqual((await send('GET', '/settings')).body, { velocity: 8, theme: 'system' });
    const set = await send('PATCH', '/settings', { velocity: 12, theme: 'dark' });
    assert.deepEqual(set.body, { velocity: 12, theme: 'dark' });
    assert.equal((await send('PATCH', '/settings', { velocity: 9999 })).status, 400);
    assert.deepEqual((await send('GET', '/settings')).body, { velocity: 12, theme: 'dark' });
  });

  it('Zeichnungen: anlegen, speichern, umbenennen, löschen', async () => {
    const p = await mk('project', { name: 'P' });
    const t = await mk('task', { projectId: p.id, title: 'Mit Skizze' });

    const created = await send('POST', '/drawings', { taskId: t.id, name: 'Ablauf' });
    assert.equal(created.status, 201);
    const d = created.body as { id: string; version: number; name: string };

    // Das Startpaket nennt nur den Namen, nicht die Szene.
    const boot = (await send('GET', '/bootstrap')).body as {
      drawings: { id: string; name: string; scene?: unknown }[];
    };
    assert.deepEqual(
      boot.drawings.map((x) => [x.name, 'scene' in x]),
      [['Ablauf', false]],
    );

    const scene = { elements: [{ type: 'rectangle', id: 'a' }] };
    const saved = await send('PATCH', `/drawings/${d.id}`, { version: d.version, changes: { scene } });
    assert.equal(saved.status, 200);

    const list = (await send('GET', `/drawings?taskId=${t.id}`)).body as {
      drawings: { scene: { elements: unknown[] }; version: number }[];
    };
    assert.deepEqual(list.drawings[0]?.scene, scene);

    // Ein zweiter gleicher Name bekommt eine Nummer, damit Verweise eindeutig bleiben.
    const zwei = (await send('POST', '/drawings', { taskId: t.id, name: 'Ablauf' })).body as {
      name: string;
    };
    assert.equal(zwei.name, 'Ablauf 2');

    // Veraltete Version: dieselbe Behandlung wie überall.
    assert.equal(
      (await send('PATCH', `/drawings/${d.id}`, { version: d.version, changes: { name: 'X' } })).status,
      409,
    );

    assert.equal((await send('DELETE', `/drawings/${d.id}`)).status, 200);
    assert.equal((await send('DELETE', `/drawings/${d.id}`)).status, 404);
  });

  it('Archiv wird gesondert geholt und ist durchsuchbar', async () => {
    const p = await mk('project', { name: 'P' });
    const a = await mk('task', { projectId: p.id, title: 'Engine auswählen' });
    const b = await mk('task', { projectId: p.id, title: 'Sound aufräumen' });
    await send('POST', `/kind/task/${a.id}/archive`);
    await send('POST', `/kind/task/${b.id}/archive`);

    assert.equal(((await send('GET', '/bootstrap')).body as { tasks: [] }).tasks.length, 0);
    assert.equal(((await send('GET', '/archive')).body as { total: number }).total, 2);
    const found = (await send('GET', '/archive?q=engine')).body as {
      total: number;
      entries: { title: string }[];
    };
    assert.equal(found.total, 1);
    assert.equal(found.entries[0]?.title, 'Engine auswählen');

    await send('POST', `/kind/task/${a.id}/restore`);
    assert.equal(((await send('GET', '/bootstrap')).body as { tasks: [] }).tasks.length, 1);
  });
});
