import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Milestone, Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import {
  getImage,
  imageBytes,
  imageRefs,
  listImages,
  purgeImage,
  putImage,
  trashImage,
  untrashImage,
  usage,
} from './images.js';
import { archive, create, remove } from './repo.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-bilder-'));
const opened: DbCtx[] = [];

after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let ctx: DbCtx;
let n = 0;

beforeEach(() => {
  ctx = createDbCtx(join(dir, `b${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
});

const mkProject = () => create(ctx, 'project', { name: 'Spiel' }) as { id: string };
const mkTask = (o: Record<string, unknown>) => create(ctx, 'task', o) as Task;
const mkMilestone = (o: Record<string, unknown>) => create(ctx, 'milestone', o) as Milestone;

const put = (bytes: string, o: { projectId?: string | null; name?: string } = {}) =>
  putImage(ctx, {
    projectId: o.projectId ?? null,
    name: o.name ?? 'Screenshot',
    mime: 'image/webp',
    width: 100,
    height: 60,
    bytes: Buffer.from(bytes),
    thumb: Buffer.from('klein-' + bytes),
  });

describe('Bilder ablegen', () => {
  it('legt ein Bild an und liefert seine Bytes zurück', () => {
    const m = put('inhalt');
    assert.match(m.id, /^b/);
    assert.equal(m.size, Buffer.from('inhalt').length);
    assert.equal(imageBytes(ctx, m.id, 'gross')?.bytes.toString(), 'inhalt');
    assert.equal(imageBytes(ctx, m.id, 'klein')?.bytes.toString(), 'klein-inhalt');
  });

  it('derselbe Inhalt landet nur einmal in der Datenbank', () => {
    const erst = put('gleich', { name: 'Erster Name' });
    const nochmal = put('gleich', { name: 'Zweiter Name' });
    assert.equal(nochmal.id, erst.id);
    // Der erste Name bleibt – es ist dieselbe Zeile, nicht eine zweite.
    assert.equal(nochmal.name, 'Erster Name');
    assert.equal(listImages(ctx).length, 1);
  });

  it('ein gelöschtes Bild kommt beim erneuten Einfügen zurück', () => {
    const m = put('wieder');
    trashImage(ctx, m.id, 'x1');
    assert.ok(getImage(ctx, m.id)?.deletedAt);

    const nochmal = put('wieder');
    assert.equal(nochmal.deletedAt, null);
    // Und der Eintrag im Papierkorb ist mitgegangen, sonst stünde dort ein Geist.
    const rest = ctx.sqlite
      .prepare("SELECT COUNT(*) AS n FROM trash WHERE kind = 'image'")
      .get() as { n: number };
    assert.equal(rest.n, 0);
  });
});

describe('Verweise im Text', () => {
  it('findet die Bilder in einer Beschreibung', () => {
    const text = 'Vorher ![Eins](/api/bilder/bAAA) und ![Zwei](/api/bilder/bBBB) danach.';
    assert.deepEqual(imageRefs(text), ['bAAA', 'bBBB']);
  });

  it('lässt fremde Adressen in Ruhe', () => {
    assert.deepEqual(imageRefs('![X](https://example.com/bild.png) ![Y](/api/drawings/d1)'), []);
  });
});

describe('Verwendungen nachsehen', () => {
  it('unterscheidet lebend, archiviert und Papierkorb', () => {
    const p = mkProject();
    const bild = put('geteilt');
    const verweis = `![B](/api/bilder/${bild.id})`;

    const lebt = mkTask({ projectId: p.id, title: 'Lebt', desc: verweis });
    const alt = mkTask({ projectId: p.id, title: 'Alt', desc: verweis });
    const weg = mkTask({ projectId: p.id, title: 'Weg', desc: verweis });
    archive(ctx, 'task', alt.id);
    remove(ctx, 'task', weg.id);

    const u = usage(ctx).get(bild.id);
    assert.deepEqual(u?.live.map((e) => e.id), [lebt.id]);
    assert.deepEqual(u?.archived.map((e) => e.id), [alt.id]);
    assert.deepEqual(u?.trashed.map((e) => e.id), [weg.id]);
  });

  it('findet auch Milestones', () => {
    const p = mkProject();
    const bild = put('ms');
    const m = mkMilestone({ projectId: p.id, title: 'M', desc: `![B](/api/bilder/${bild.id})` });
    const u = usage(ctx).get(bild.id);
    assert.deepEqual(u?.live, [{ kind: 'milestone', id: m.id, title: 'M' }]);
  });

  it('ein Bild ohne Verweis taucht gar nicht auf', () => {
    const bild = put('einsam');
    assert.equal(usage(ctx).get(bild.id), undefined);
    // Im Bestand steht es trotzdem – die Galerie zeigt es als ungenutzt.
    assert.equal(listImages(ctx).length, 1);
  });
});

describe('Bilder löschen', () => {
  it('geht über den Papierkorb und ist umkehrbar', () => {
    const bild = put('weg damit');
    const meta = trashImage(ctx, bild.id, 'x9');
    assert.ok(meta?.deletedAt);

    const eintrag = ctx.sqlite
      .prepare("SELECT title, kind FROM trash WHERE id = 'x9'")
      .get() as { title: string; kind: string };
    assert.equal(eintrag.kind, 'image');
    assert.equal(eintrag.title, 'Screenshot');
    // Die Bytes liegen noch da – frei wird der Platz erst beim Leeren.
    assert.equal(imageBytes(ctx, bild.id, 'gross')?.bytes.toString(), 'weg damit');

    assert.equal(untrashImage(ctx, bild.id), true);
    assert.equal(getImage(ctx, bild.id)?.deletedAt, null);
  });

  it('zweimal löschen legt keinen zweiten Eintrag an', () => {
    const bild = put('doppelt');
    assert.ok(trashImage(ctx, bild.id, 'x1'));
    assert.equal(trashImage(ctx, bild.id, 'x2'), null);
  });

  it('endgültig entfernt ist wirklich weg', () => {
    const bild = put('endgueltig');
    trashImage(ctx, bild.id, 'x1');
    purgeImage(ctx, bild.id);
    assert.equal(getImage(ctx, bild.id), null);
    assert.equal(imageBytes(ctx, bild.id, 'gross'), null);
  });
});
