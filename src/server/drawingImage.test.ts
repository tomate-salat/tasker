/**
 * Eine Zeichnung als PNG: das SVG, das die Web-App neben die Szene legt, und
 * die Route, die daraus das Bild macht.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Hono } from 'hono';
import { createDbCtx, type DbCtx } from './db.js';
import { EventBus } from './events.js';
import { dataRoutes } from './routes.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-zeichnung-'));
let ctx: DbCtx;
let app: Hono;

before(() => {
  ctx = createDbCtx(join(dir, 'z.db'));
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
  app = dataRoutes(ctx, new EventBus());
});

after(() => {
  ctx.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

const send = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: { 'content-type': 'application/json' },
  });
  return { status: res.status, body: (await res.json()) as never };
};
const json = async (method: string, path: string, body?: unknown) =>
  (await send(method, path, body)).body as { id: string; version: number };

const image = async (path: string, headers?: Record<string, string>) => {
  const res = await app.request(path, { ...(headers ? { headers } : {}) });
  return { status: res.status, etag: res.headers.get('etag'), type: res.headers.get('content-type'), png: Buffer.from(await res.arrayBuffer()) };
};

/** Breite und Höhe stehen im PNG gleich hinter der Kennung. */
const sizeOf = (png: Buffer) => {
  assert.equal(png.subarray(1, 4).toString('latin1'), 'PNG');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
};

// Ein rotes Pixel, als Bild in der Zeichnung.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

/**
 * So kommt es aus Excalidraws `exportToSvg` (0.18, hell, ohne eingebettete
 * Schriften): ein Rechteck, ein Text und ein Bild, 300 × 120.
 */
const SVG =
  '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 120" width="300" height="120"><!-- svg-source:excalidraw --><metadata></metadata>' +
  `<defs><symbol id="image-f1"><image href="${PIXEL}" preserveAspectRatio="none" width="100%" height="100%"></image></symbol><style class="style-fonts">\n      </style></defs>` +
  '<g stroke-linecap="round" transform="translate(10 10) rotate(0 100 50)"><path d="M0.9 0.49 L201.62 -0.73 L201.13 101.1 L-1.66 99.13" stroke="none" stroke-width="0" fill="#a5d8ff"></path>' +
  '<path d="M0 0 C40.99 1.15, 81.7 2.88, 200 0 M0 0 C47.24 1.6, 95.51 0.93, 200 0 M200 0 C197.72 34.68, 199.77 72.57, 200 100 M200 0 C201.46 28.89, 200.58 58.52, 200 100 M200 100 C140.36 102.23, 75.44 100.16, 0 100 M200 100 C143.3 100.91, 87.84 101.89, 0 100 M0 100 C-1.2 78.63, 1.49 56.89, 0 0 M0 100 C0.65 62.35, 0.12 24.28, 0 0" stroke="#1e1e1e" stroke-width="2" fill="none"></path></g>' +
  '<g transform="translate(30 45) rotate(0 80 12.5)"><text x="0" y="17.619999999999997" font-family="Excalifont, Xiaolai, Segoe UI Emoji" font-size="20px" fill="#1e1e1e" text-anchor="start" style="white-space: pre;" direction="ltr" dominant-baseline="alphabetic">Hallo Tasker äöü</text></g>' +
  '<g transform="translate(230 20) rotate(0 30 30)"><use href="#image-f1" width="60" height="60" opacity="1"></use></g></svg>';

const scene = { elements: [{ type: 'rectangle', id: 'a' }] };

const setup = async (name: string) => {
  const p = await json('POST', '/kind/project', { name: 'P' });
  const t = await json('POST', '/kind/task', { projectId: p.id, title: 'Mit Skizze' });
  const d = await json('POST', '/drawings', { taskId: t.id, name });
  return { t, d, url: `/zeichnungsbild?taskId=${t.id}&name=${encodeURIComponent(name)}` };
};

describe('Zeichnung als Bild', () => {
  it('liefert ein PNG, hält die Kante ein und erkennt den Stand am ETag', async () => {
    const { d, url } = await setup('Ablauf Süd');

    // Frisch angelegt: kein Bild, aber auch kein Fehler.
    assert.equal((await image(url)).status, 204);

    await json('PATCH', `/drawings/${d.id}`, { version: 1, changes: { scene, svg: SVG } });

    const light = await image(url);
    assert.equal(light.status, 200);
    assert.equal(light.type, 'image/png');
    // Eine kleine Zeichnung kommt in doppelter Schärfe, nicht aufgeblasen auf die Kante.
    assert.deepEqual(sizeOf(light.png), { width: 600, height: 240 });
    assert.match(light.etag as string, new RegExp(`^"${d.id}-2-`));
    assert.equal((await image(url, { 'if-none-match': light.etag as string })).status, 304);

    const small = await image(`${url}&kante=150`);
    assert.deepEqual(sizeOf(small.png), { width: 150, height: 60 });
    assert.notEqual(small.etag, light.etag);

    // Dunkel ist dasselbe Bild mit anderen Farben.
    const dark = await image(`${url}&thema=dunkel`);
    assert.deepEqual(sizeOf(dark.png), sizeOf(light.png));
    assert.notDeepEqual(dark.png, light.png);

    // Zum Ansehen, wenn man an der Darstellung arbeitet.
    const out = process.env['TASKER_BILD_AUSGABE'];
    if (out) {
      writeFileSync(join(out, 'hell.png'), light.png);
      writeFileSync(join(out, 'dunkel.png'), dark.png);
    }
  });

  it('das Bild gehört zur Szene: ohne neues SVG ist es weg, ein neuer Name lässt es stehen', async () => {
    const { t, d, url } = await setup('Plan');
    await json('PATCH', `/drawings/${d.id}`, { version: 1, changes: { scene, svg: SVG } });

    // Umbenennen ändert die Szene nicht.
    await json('PATCH', `/drawings/${d.id}`, { version: 2, changes: { name: 'Plan B' } });
    const renamed = `/zeichnungsbild?taskId=${t.id}&name=${encodeURIComponent('Plan B')}`;
    assert.equal((await image(url)).status, 404);
    assert.equal((await image(renamed)).status, 200);

    // Die Szene liefert ihr Bild nicht mit aus – es ist nur für die Route da.
    const list = (await send('GET', `/drawings?taskId=${t.id}`)).body as { drawings: Record<string, unknown>[] };
    assert.deepEqual(Object.keys(list.drawings[0] ?? {}).filter((k) => /svg/i.test(k)), []);

    // Ein Bild allein gilt der Szene, die schon da ist.
    await json('PATCH', `/drawings/${d.id}`, { version: 3, changes: { svg: SVG.replace('#a5d8ff', '#ffc9c9') } });
    assert.equal((await image(renamed)).status, 200);

    // Eine neue Szene ohne Bild: das alte passt nicht mehr.
    await json('PATCH', `/drawings/${d.id}`, { version: 4, changes: { scene: { elements: [] } } });
    assert.equal((await image(renamed)).status, 204);
  });

  it('das Bild übersteht Löschen und Zurückholen', async () => {
    const { d, url } = await setup('Skizze');
    await json('PATCH', `/drawings/${d.id}`, { version: 1, changes: { scene, svg: SVG } });

    const removed = (await send('DELETE', `/drawings/${d.id}`)).body as { undo: unknown[] };
    assert.equal((await image(url)).status, 404);
    assert.equal((await send('POST', '/steps', { steps: removed.undo })).status, 200);
    assert.equal((await image(url)).status, 200);
  });

  it('zeichnet nur, was eingebettet ist', async () => {
    const { d, url } = await setup('Fremd');
    const foreign = SVG.replace(PIXEL, '/etc/hostname');
    await json('PATCH', `/drawings/${d.id}`, { version: 1, changes: { scene, svg: foreign } });
    assert.equal((await image(url)).status, 204);
  });

  it('nennt Fehlendes und Unvollständiges', async () => {
    const { t } = await setup('Da');
    assert.equal((await image(`/zeichnungsbild?taskId=${t.id}&name=Nichts`)).status, 404);
    assert.equal((await image(`/zeichnungsbild?taskId=${t.id}`)).status, 400);
    assert.equal((await image('/zeichnungsbild?name=X')).status, 400);
  });
});
