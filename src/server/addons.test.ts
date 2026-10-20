/**
 * Editor-Addons am Änderungs-Strom: Anmeldung, Aufträge „In Godot verfeinern“
 * und was das Addon zurückmeldet – so, wie Web-App und Addon es benutzen.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import type { Envelope } from '../shared/events.js';
import { createDbCtx, type DbCtx } from './db.js';
import { EventBus } from './events.js';
import { dataRoutes } from './routes.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-addons-'));
const opened: DbCtx[] = [];
after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let app: Hono;
let seen: Envelope[];
let n = 0;

/** Wie in index.ts: ein Token setzt `viaToken` – hier über einen Test-Header. */
function build(times: { streamMs?: number; graceMs?: number; acceptMs?: number; finishMs?: number }): void {
  const ctx = createDbCtx(join(dir, `a${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
  const bus = new EventBus();
  seen = [];
  bus.subscribe((e) => seen.push(e));
  const outer = new Hono<{ Variables: { viaToken: boolean } }>();
  outer.use('*', async (c, next) => {
    c.set('viaToken', c.req.header('x-test-token') === '1');
    await next();
  });
  outer.route('/', dataRoutes(ctx, bus, times));
  app = outer as unknown as Hono;
}

beforeEach(() => build({ streamMs: 1500, graceMs: 100, acceptMs: 200, finishMs: 2000 }));

const send = async (method: string, path: string, body?: unknown, token = false) => {
  const res = await app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json', ...(token ? { 'x-test-token': '1' } : {}) },
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as never };
};

/** Öffnet einen Strom und sammelt, was ankommt. */
async function stream(path: string, token: boolean) {
  const res = await app.request(path, { headers: token ? { 'x-test-token': '1' } : {} });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = '';
  let done = false;
  void (async () => {
    for (;;) {
      const chunk = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    done = true;
  })();
  return {
    text: () => text,
    ended: () => done,
    close: () => reader.cancel(),
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const events = (type: string) => seen.map((e) => e.event).filter((e) => e.type === type) as Record<string, unknown>[];

describe('Editor-Addons', () => {
  it('meldet sich per Token am Strom an – ohne Token zählt es nicht', async () => {
    const p = (await send('POST', '/kind/project', { name: 'Spiel' })).body as { id: string };

    const browser = await stream(`/events?addon=godot&project=${p.id}`, false);
    await wait(50);
    assert.deepEqual(((await send('GET', '/bootstrap')).body as { addons: unknown[] }).addons, []);
    await browser.close();

    const godot = await stream(`/events?addon=godot&project=${p.id}&name=Carnage`, true);
    await wait(50);
    const boot = (await send('GET', '/bootstrap')).body as { addons: Record<string, unknown>[] };
    assert.deepEqual(
      boot.addons.map((a) => [a['projectId'], a['addon'], a['name']]),
      [[p.id, 'godot', 'Carnage']],
    );
    assert.equal(events('addons').length, 1);

    // Ein unbekanntes Projekt meldet niemanden an.
    const lost = await stream('/events?addon=godot&project=gibtsnicht', true);
    await wait(50);
    assert.equal(((await send('GET', '/bootstrap')).body as { addons: unknown[] }).addons.length, 1);
    await lost.close();

    // Kurz weg und gleich wieder da (die Erneuerung alle zehn Minuten): keine Meldung.
    await godot.close();
    await wait(20);
    const again = await stream(`/events?addon=godot&project=${p.id}&name=Carnage`, true);
    await wait(200);
    assert.equal(events('addons').length, 1);
    assert.equal(((await send('GET', '/bootstrap')).body as { addons: unknown[] }).addons.length, 1);

    // Wirklich weg: nach der Frist nicht mehr verbunden.
    await again.close();
    await wait(250);
    assert.equal(events('addons').length, 2);
    assert.deepEqual(((await send('GET', '/bootstrap')).body as { addons: unknown[] }).addons, []);
  });

  it('ein Auftrag geht an das Addon, die Rückmeldung an die Web-App', async () => {
    const p = (await send('POST', '/kind/project', { name: 'Spiel' })).body as { id: string };
    const t = (await send('POST', '/kind/task', { projectId: p.id, title: 'Keine Hose' })).body as { id: string };

    // Ohne verbundenes Godot geht nichts raus.
    assert.equal((await send('POST', '/godot/refine', { taskId: t.id, mode: 'rewrite' })).status, 409);
    assert.equal((await send('POST', '/godot/refine', { taskId: 'gibtsnicht', mode: 'rewrite' })).status, 404);
    assert.equal((await send('POST', '/godot/refine', { taskId: t.id, mode: 'rm -rf' })).status, 400);

    const godot = await stream(`/events?addon=godot&project=${p.id}`, true);
    const browser = await stream('/events', false);
    await wait(50);
    const sent = await send('POST', '/godot/refine', { taskId: t.id, mode: 'rewrite' });
    assert.equal(sent.status, 202);
    const { requestId } = sent.body as { requestId: string };
    await wait(50);

    // Nur das Addon bekommt den Auftrag, als benanntes Ereignis.
    assert.match(godot.text(), new RegExp(`event: godot-refine\\ndata: \\{"requestId":"${requestId}","taskId":"${t.id}","mode":"rewrite"\\}`));
    assert.doesNotMatch(browser.text(), /godot-refine/);

    // Mit Auftrag des Nutzers geht der Wortlaut mit.
    const asked = (await send('POST', '/godot/refine', { taskId: t.id, mode: 'rewrite', prompt: '  Hosen ergänzen ' })).body as {
      requestId: string;
    };
    await wait(50);
    assert.match(godot.text(), new RegExp(`"requestId":"${asked.requestId}","taskId":"${t.id}","mode":"rewrite","prompt":"Hosen ergänzen"`));
    assert.equal((await send('POST', '/godot/status', { requestId: asked.requestId, state: 'failed' }, true)).status, 200);
    seen = seen.filter((e) => !('requestId' in e.event) || e.event.requestId !== asked.requestId);

    for (const [state, message] of [['accepted', undefined], ['working', 'liest cell.tscn'], ['done', 'Beschreibung ergänzt']]) {
      const r = await send('POST', '/godot/status', { requestId, state, ...(message ? { message } : {}) }, true);
      assert.equal(r.status, 200, String(state));
    }
    assert.deepEqual(
      events('godot').map((e) => [e['state'], e['message'], e['taskId']]),
      [
        ['sent', null, t.id],
        ['accepted', null, t.id],
        ['working', 'liest cell.tscn', t.id],
        ['done', 'Beschreibung ergänzt', t.id],
      ],
    );
    // Fertig ist fertig.
    assert.equal((await send('POST', '/godot/status', { requestId, state: 'working' }, true)).status, 404);
    assert.equal((await send('POST', '/godot/status', { requestId: 'erfunden', state: 'done' }, true)).status, 404);
    await godot.close();
    await browser.close();
  });

  it('nimmt das Addon nicht an, meldet der Server selbst den Fehler', async () => {
    const p = (await send('POST', '/kind/project', { name: 'Spiel' })).body as { id: string };
    const t = (await send('POST', '/kind/task', { projectId: p.id, title: 'A' })).body as { id: string };
    const godot = await stream(`/events?addon=godot&project=${p.id}`, true);
    await wait(50);
    const { requestId } = (await send('POST', '/godot/refine', { taskId: t.id, mode: 'rewrite' })).body as {
      requestId: string;
    };
    await wait(300);
    assert.deepEqual(events('godot').at(-1), { type: 'godot', requestId, taskId: t.id, state: 'failed', message: 'Godot hat nicht reagiert.' });
    await godot.close();
  });

  it('zwei Editoren: der zuletzt dazugekommene bekommt den Auftrag', async () => {
    const p = (await send('POST', '/kind/project', { name: 'Spiel' })).body as { id: string };
    const t = (await send('POST', '/kind/task', { projectId: p.id, title: 'A' })).body as { id: string };
    const first = await stream(`/events?addon=godot&project=${p.id}&name=Laptop`, true);
    await wait(20);
    const second = await stream(`/events?addon=godot&project=${p.id}&name=Desktop`, true);
    await wait(50);
    await send('POST', '/godot/refine', { taskId: t.id, mode: 'rewrite' });
    await wait(50);
    assert.doesNotMatch(first.text(), /godot-refine/);
    assert.match(second.text(), /godot-refine/);
    await first.close();
    await second.close();
  });

  it('der Eingang setzt ai-created nur, wenn Claude beteiligt war', async () => {
    const p = (await send('POST', '/kind/project', { name: 'Spiel' })).body as { id: string };
    const plain = (await send('POST', '/intake/task', { projectId: p.id, title: 'Von Hand', aiCreated: false }, true)).body as {
      tags: string[];
    };
    const ai = (await send('POST', '/intake/task', { projectId: p.id, title: 'Mit Claude', aiCreated: true }, true)).body as {
      tags: string[];
    };
    const old = (await send('POST', '/intake/task', { projectId: p.id, title: 'Wie bisher' }, true)).body as { tags: string[] };
    assert.deepEqual([plain.tags, ai.tags, old.tags], [[], ['ai-created'], ['ai-created']]);
  });
});
