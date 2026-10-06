/**
 * Eine Zeichnung als PNG: die Route und der Zeichen-Prozess dahinter, mit dem
 * echten Excalidraw. Der Prozess wird dafür frisch gebaut – er läuft nie aus
 * den Quellen, sondern immer als Bündel (siehe drawingWorker.ts).
 */
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Hono } from 'hono';
import { createDbCtx, type DbCtx } from './db.js';
import { stopDrawingWorker } from './drawingImage.js';
import { EventBus } from './events.js';
import { dataRoutes } from './routes.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-zeichnung-'));
let ctx: DbCtx;
let app: Hono;

before(() => {
  execSync('npm run build:worker', { stdio: 'ignore' });
  ctx = createDbCtx(join(dir, 'z.db'));
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
  app = dataRoutes(ctx, new EventBus());
});

after(() => {
  stopDrawingWorker();
  ctx.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const json = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
  return (await res.json()) as { id: string; version: number };
};

/** Breite und Höhe stehen im PNG gleich hinter der Kennung. */
const sizeOf = (png: Buffer) => {
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

const base = {
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 1,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  seed: 1234,
  version: 1,
  versionNonce: 1,
  isDeleted: false,
  boundElements: null,
  updated: 1,
  link: null,
  locked: false,
};

// Ein rotes Pixel, als Bild in der Szene.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

const scene = {
  elements: [
    { ...base, id: 'r1', type: 'rectangle', x: 10, y: 10, width: 200, height: 100, backgroundColor: '#a5d8ff', index: 'a0' },
    { ...base, id: 'e1', type: 'ellipse', x: 260, y: 20, width: 120, height: 80, index: 'a1' },
    {
      ...base,
      id: 'a1',
      type: 'arrow',
      x: 210,
      y: 60,
      width: 50,
      height: 0,
      points: [
        [0, 0],
        [50, 0],
      ],
      lastCommittedPoint: null,
      startBinding: null,
      endBinding: null,
      startArrowhead: null,
      endArrowhead: 'arrow',
      elbowed: false,
      index: 'a2',
    },
    {
      ...base,
      id: 't1',
      type: 'text',
      x: 30,
      y: 45,
      width: 160,
      height: 25,
      text: 'Hallo Tasker äöü',
      originalText: 'Hallo Tasker äöü',
      fontSize: 20,
      fontFamily: 5,
      textAlign: 'left',
      verticalAlign: 'top',
      containerId: null,
      autoResize: true,
      lineHeight: 1.25,
      index: 'a3',
    },
    {
      ...base,
      id: 'i1',
      type: 'image',
      x: 280,
      y: 120,
      width: 60,
      height: 60,
      fileId: 'f1',
      status: 'saved',
      scale: [1, 1],
      crop: null,
      index: 'a4',
    },
  ],
  files: { f1: { id: 'f1', mimeType: 'image/png', dataURL: PIXEL, created: 1 } },
};

describe('Zeichnung als Bild', () => {
  it('liefert ein PNG, hält die Kante ein und erkennt den Stand am ETag', async () => {
    const p = await json('POST', '/kind/project', { name: 'P' });
    const t = await json('POST', '/kind/task', { projectId: p.id, title: 'Mit Skizze' });
    const d = await json('POST', '/drawings', { taskId: t.id, name: 'Ablauf Süd' });
    const url = `/zeichnungsbild?taskId=${t.id}&name=${encodeURIComponent('Ablauf Süd')}`;

    // Leer: kein Bild, aber auch kein Fehler.
    assert.equal((await app.request(url)).status, 204);

    await json('PATCH', `/drawings/${d.id}`, { version: d.version, changes: { scene } });

    const res = await app.request(url);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    const png = Buffer.from(await res.arrayBuffer());
    const full = sizeOf(png);
    // Eine kleine Zeichnung kommt in doppelter Schärfe, nicht aufgeblasen auf die Kante.
    assert.ok(full.width > 600 && full.width < 1000, `Breite ${full.width}`);

    const etag = res.headers.get('etag') as string;
    assert.match(etag, new RegExp(`^"${d.id}-2-`));
    assert.equal((await app.request(url, { headers: { 'if-none-match': etag } })).status, 304);

    const small = await app.request(`${url}&kante=200&thema=dunkel`);
    const smallPng = Buffer.from(await small.arrayBuffer());
    assert.equal(Math.max(sizeOf(smallPng).width, sizeOf(smallPng).height), 200);
    assert.notEqual(small.headers.get('etag'), etag);

    // Zum Ansehen, wenn man an der Darstellung arbeitet.
    if (process.env['TASKER_BILD_AUSGABE']) {
      writeFileSync(join(process.env['TASKER_BILD_AUSGABE'], 'hell.png'), png);
      const dark = await app.request(`${url}&thema=dunkel`);
      writeFileSync(join(process.env['TASKER_BILD_AUSGABE'], 'dunkel.png'), Buffer.from(await dark.arrayBuffer()));
    }

    // Nach einer Änderung gilt der alte Stand nicht mehr.
    await json('PATCH', `/drawings/${d.id}`, { version: 2, changes: { scene: { elements: scene.elements.slice(0, 1) } } });
    const again = await app.request(url, { headers: { 'if-none-match': etag } });
    assert.equal(again.status, 200);
    assert.ok(sizeOf(Buffer.from(await again.arrayBuffer())).width < full.width);
  });

  it('nennt Fehlendes und Unvollständiges', async () => {
    const p = await json('POST', '/kind/project', { name: 'Q' });
    const t = await json('POST', '/kind/task', { projectId: p.id, title: 'Ohne' });
    assert.equal((await app.request(`/zeichnungsbild?taskId=${t.id}&name=Nichts`)).status, 404);
    assert.equal((await app.request(`/zeichnungsbild?taskId=${t.id}`)).status, 400);
    assert.equal((await app.request('/zeichnungsbild?name=X')).status, 400);
  });
});
