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
import type { Envelope } from '../shared/events.js';
import { CLIENT_HEADER } from '../shared/events.js';
import { createDbCtx, type DbCtx } from './db.js';
import { EventBus } from './events.js';
import { dataRoutes } from './routes.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-routes-'));
const opened: DbCtx[] = [];
after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let app: Hono;
let bus: EventBus;
let seen: Envelope[];
let n = 0;

beforeEach(() => {
  const ctx = createDbCtx(join(dir, `r${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
  bus = new EventBus();
  seen = [];
  bus.subscribe((e) => seen.push(e));
  app = dataRoutes(ctx, bus);
});

const send = async (method: string, path: string, body?: unknown, client?: string) => {
  const res = await app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      'content-type': 'application/json',
      ...(client ? { [CLIENT_HEADER]: client } : {}),
    },
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
    const vorgabe = { velocity: 8, theme: 'system', imageMaxKb: 500, imageMaxEdge: 2560 };
    assert.deepEqual((await send('GET', '/settings')).body, vorgabe);
    const set = await send('PATCH', '/settings', { velocity: 12, theme: 'dark' });
    assert.deepEqual(set.body, { ...vorgabe, velocity: 12, theme: 'dark' });
    assert.equal((await send('PATCH', '/settings', { velocity: 9999 })).status, 400);
    assert.equal((await send('PATCH', '/settings', { imageMaxKb: 10 })).status, 400);
    const bild = await send('PATCH', '/settings', { imageMaxKb: 250, imageMaxEdge: 1920 });
    assert.deepEqual(bild.body, {
      ...vorgabe,
      velocity: 12,
      theme: 'dark',
      imageMaxKb: 250,
      imageMaxEdge: 1920,
    });
  });

  it('schreibt nach jeder Änderung das Burnup-Protokoll fort', async () => {
    const p = await mk('project', { name: 'P' });
    const m = await mk('milestone', { projectId: p.id, title: 'M' });
    const a = await mk('task', { projectId: p.id, title: 'A', milestoneId: m.id });
    await mk('task', { projectId: p.id, title: 'B', milestoneId: m.id });
    await send('PATCH', `/kind/task/${a.id}`, { version: a.version, changes: { status: 'done' } });

    const boot = (await send('GET', '/bootstrap')).body as {
      milestoneLog: Record<string, { at: string; s: number; dn: number }[]>;
    };
    const log = boot.milestoneLog[m.id] ?? [];
    // Je Änderung ein Eintrag mit UTC-Zeitpunkt; die Tage bildet erst der Client.
    // (Zwei Änderungen in derselben Millisekunde teilen sich einen Eintrag – der letzte Stand gilt.)
    assert.deepEqual(log[0] && [log[0].s, log[0].dn], [0, 0]);
    assert.deepEqual(log.at(-1) && [log.at(-1)!.s, log.at(-1)!.dn], [2, 1]);
    assert.ok(log.length >= 3);
    assert.ok(log.every((e) => e.at.endsWith('Z')));
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

  it('eine gelöschte Zeichnung verlässt die Beschreibung und kommt mit Rückgängig wieder', async () => {
    const p = await mk('project', { name: 'P' });
    const t = await mk('task', { projectId: p.id, title: 'Mit Skizze' });
    const d = (await send('POST', '/drawings', { taskId: t.id, name: 'Ablauf' })).body as {
      id: string;
      version: number;
    };
    const scene = { elements: [{ type: 'rectangle', id: 'a' }] };
    await send('PATCH', `/drawings/${d.id}`, { version: d.version, changes: { scene } });
    const desc = 'Vorher\n\n![[zeichnung:Ablauf]]\n\nNachher';
    const withDesc = (await send('PATCH', `/kind/task/${t.id}`, { version: 1, changes: { desc } })).body as {
      version: number;
    };
    assert.ok(withDesc.version);

    const del = await send('DELETE', `/drawings/${d.id}`);
    assert.equal(del.status, 200);
    const { undo } = del.body as { undo: unknown[] };

    const task = async () =>
      ((await send('GET', '/bootstrap')).body as { tasks: { id: string; desc: string }[] }).tasks.find(
        (x) => x.id === t.id,
      );
    assert.equal((await task())?.desc, 'Vorher\n\nNachher');
    // Im Papierkorb taucht sie nicht auf – sie liegt dort nur für die Rücknahme.
    assert.deepEqual((await send('GET', '/trash')).body, { entries: [], days: 30 });

    assert.equal((await send('POST', '/steps', { steps: undo })).status, 200);
    assert.equal((await task())?.desc, desc);
    const back = (await send('GET', `/drawings?taskId=${t.id}`)).body as {
      drawings: { id: string; name: string; scene: unknown }[];
    };
    assert.deepEqual(
      back.drawings.map((x) => [x.id, x.name, x.scene]),
      [[d.id, 'Ablauf', scene]],
    );
  });

  it('Zeichnungen an Milestones: anlegen, löschen samt Einbettung, mit dem Milestone in den Papierkorb', async () => {
    const p = await mk('project', { name: 'P' });
    const m = await mk('milestone', { projectId: p.id, title: 'M' });
    assert.equal((await send('POST', '/drawings', { name: 'X' })).status, 400, 'ohne Besitzer');
    assert.equal(
      (await send('POST', '/drawings', { taskId: m.id, milestoneId: m.id })).status,
      400,
      'nicht beides',
    );

    const d = (await send('POST', '/drawings', { milestoneId: m.id, name: 'Plan' })).body as {
      id: string;
      taskId: string | null;
      milestoneId: string;
    };
    assert.deepEqual([d.taskId, d.milestoneId], [null, m.id]);
    const list = (await send('GET', `/drawings?milestoneId=${m.id}`)).body as { drawings: { id: string }[] };
    assert.deepEqual(list.drawings.map((x) => x.id), [d.id]);

    // Löschen nimmt die Einbettung aus der Beschreibung des Milestones.
    await send('PATCH', `/kind/milestone/${m.id}`, { version: m.version, changes: { desc: '![[zeichnung:Plan]]' } });
    const del = (await send('DELETE', `/drawings/${d.id}`)).body as { undo: unknown[] };
    const ms = async () =>
      ((await send('GET', '/bootstrap')).body as { milestones: { id: string; desc: string }[] }).milestones.find(
        (x) => x.id === m.id,
      );
    assert.equal((await ms())?.desc, '');
    await send('POST', '/steps', { steps: del.undo });
    assert.equal((await ms())?.desc, '![[zeichnung:Plan]]');

    // Der gelöschte Milestone nimmt Zeichnung und Protokoll mit und bringt sie zurück.
    const { trashId } = (await send('DELETE', `/kind/milestone/${m.id}`)).body as { trashId: string };
    const boot = async () =>
      (await send('GET', '/bootstrap')).body as {
        drawings: { id: string }[];
        milestoneLog: Record<string, unknown[]>;
      };
    assert.equal((await boot()).drawings.length, 0);
    const entry = ((await send('GET', '/trash')).body as { entries: { drawingCount: number }[] }).entries[0];
    assert.equal(entry?.drawingCount, 1);
    await send('POST', `/trash/${trashId}/restore`);
    const after = await boot();
    assert.deepEqual(after.drawings.map((x) => x.id), [d.id]);
    assert.ok(after.milestoneLog[m.id]?.length);
  });

  it('meldet jede Änderung im Strom und nennt den schreibenden Tab', async () => {
    const p = await mk('project', { name: 'P' });
    seen.length = 0;

    const t = (await send('POST', '/kind/task', { projectId: p.id, title: 'A' }, 'tab-1')).body as {
      id: string;
      version: number;
    };
    await send('PATCH', `/kind/task/${t.id}`, { version: t.version, changes: { prio: 1 } }, 'tab-1');
    await send('POST', '/move', { id: t.id, version: t.version + 1, index: 0 }, 'tab-2');
    await send('PATCH', '/settings', { velocity: 11 });

    assert.deepEqual(
      seen.map((e) => [e.event.type, e.origin]),
      [
        ['upsert', 'tab-1'],
        ['upsert', 'tab-1'],
        // Verschieben rührt an Geschwistern: der andere Tab lädt neu.
        ['reload', 'tab-2'],
        ['settings', null],
      ],
    );

    const first = seen[0]?.event;
    assert.equal(first?.type === 'upsert' && (first.object as { title: string }).title, 'A');
  });

  it('gescheiterte Änderungen melden nichts', async () => {
    const p = await mk('project', { name: 'P' });
    const t = await mk('task', { projectId: p.id, title: 'A' });
    seen.length = 0;

    // Veraltete Version, unbekannte ID, ungültiger Wert – nichts davon ist passiert.
    await send('PATCH', `/kind/task/${t.id}`, { version: 99, changes: { prio: 1 } });
    await send('PATCH', '/kind/task/gibtsnicht', { version: 1, changes: { prio: 1 } });
    await send('PATCH', `/kind/task/${t.id}`, { version: 1, changes: { prio: 9 } });

    assert.deepEqual(seen, []);
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
