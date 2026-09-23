import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Milestone, Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import {
  GONE_NOTE,
  addFolder,
  deleteFolder,
  folderTree,
  getFolder,
  getImage,
  moveFolder,
  moveImages,
  imageBytes,
  imageRefs,
  listImages,
  purgeImage,
  putImage,
  trashImage,
  untrashImage,
  usage,
} from './images.js';
import { archive, create, expireTrash, loadTrash, patch, purgeTrash, remove, restoreTrash } from './repo.js';

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

const readDesc = (kind: 'task' | 'milestone', id: string): string =>
  (ctx.sqlite.prepare(`SELECT desc FROM ${kind} WHERE id = ?`).get(id) as { desc: string }).desc;

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

  it('steht im Papierkorb und kommt von dort zurück', () => {
    const bild = put('ueber den papierkorb');
    trashImage(ctx, bild.id, 'x1');

    const eintrag = loadTrash(ctx).find((e) => e.id === 'x1');
    assert.equal(eintrag?.kind, 'image');
    assert.equal(eintrag?.imageId, bild.id);
    assert.equal(eintrag?.taskCount, 0, 'ein Bild bringt keine Aufgaben mit');

    restoreTrash(ctx, 'x1');
    assert.equal(getImage(ctx, bild.id)?.deletedAt, null);
    assert.equal(loadTrash(ctx).length, 0);
  });

  it('beim Leeren fallen die Bytes – und zwar ohne Rückgängig', () => {
    const p = mkProject();
    const bild = put('faellt weg');
    const t = mkTask({ projectId: p.id, title: 'Auch weg' });
    trashImage(ctx, bild.id, 'x1');
    remove(ctx, 'task', t.id);

    const ids = loadTrash(ctx).map((e) => e.id);
    const res = purgeTrash(ctx, ids);
    assert.equal(res.count, 2);
    assert.equal(res.images, 1);
    assert.equal(getImage(ctx, bild.id), null);

    /**
     * Die Aufgabe lässt sich zurückholen, das Bild nicht – seine Bytes sind
     * fort. Deshalb steht sein Eintrag gar nicht erst in der Rückgängig-Liste.
     */
    const zurueck = res.undo[0] as { op: 'unpurge'; rows: { kind: string }[] };
    assert.equal(zurueck.op, 'unpurge');
    assert.deepEqual(zurueck.rows.map((r) => r.kind), ['task']);
  });

  it('hinterlässt in den Beschreibungen einen Hinweis', () => {
    const p = mkProject();
    const bild = put('verschwindet');
    const verweis = `![Screenshot](/api/bilder/${bild.id})`;
    const t = mkTask({ projectId: p.id, title: 'Mit Bild', desc: `Oben\n\n${verweis}\n\nUnten` });
    const m = mkMilestone({ projectId: p.id, title: 'M', desc: verweis });

    // Im Papierkorb ändert sich noch nichts – das Bild ist ja noch da.
    trashImage(ctx, bild.id, 'x1');
    assert.match(readDesc('task', t.id), /!\[Screenshot\]/);

    purgeImage(ctx, bild.id);
    assert.equal(readDesc('task', t.id), `Oben\n\n${GONE_NOTE}\n\nUnten`);
    assert.equal(readDesc('milestone', m.id), GONE_NOTE);
  });

  it('der Hinweis erreicht auch Aufgaben im Papierkorb', () => {
    const p = mkProject();
    const bild = put('auch dort');
    const t = mkTask({
      projectId: p.id,
      title: 'Liegt im Papierkorb',
      desc: `![B](/api/bilder/${bild.id})`,
    });
    remove(ctx, 'task', t.id);
    const eintrag = loadTrash(ctx)[0] as { id: string };

    purgeImage(ctx, bild.id);

    // Wiederhergestellt steht dort der Hinweis und kein kaputtes Bild.
    restoreTrash(ctx, eintrag.id);
    assert.equal(readDesc('task', t.id), GONE_NOTE);
  });

  it('ein Titelbild zählt als Verwendung und fällt beim Entfernen weg', () => {
    const p = mkProject();
    const bild = put('titel');
    const t = mkTask({ projectId: p.id, title: 'Karte' });
    const gesetzt = patch(ctx, 'task', t.id, t.version, { coverImageId: bild.id }) as Task;
    assert.equal(gesetzt.coverImageId, bild.id);
    assert.deepEqual(usage(ctx).get(bild.id)?.live.map((e) => e.id), [t.id]);

    purgeImage(ctx, bild.id);
    const row = ctx.sqlite
      .prepare('SELECT cover_image_id, version FROM task WHERE id = ?')
      .get(t.id) as { cover_image_id: string | null; version: number };
    assert.equal(row.cover_image_id, null);
    // Die Version zählt hoch, damit ein offener Tab nicht auf altem Stand speichert.
    assert.equal(row.version, gesetzt.version + 1);
  });

  it('lässt andere Bilder im selben Text unberührt', () => {
    const p = mkProject();
    const weg = put('weg');
    const bleibt = put('bleibt');
    const t = mkTask({
      projectId: p.id,
      title: 'Zwei Bilder',
      desc: `![A](/api/bilder/${weg.id}) und ![B](/api/bilder/${bleibt.id})`,
    });

    purgeImage(ctx, weg.id);
    assert.equal(readDesc('task', t.id), `${GONE_NOTE} und ![B](/api/bilder/${bleibt.id})`);
  });

  it('die Frist nimmt ein altes Bild mit', () => {
    const bild = put('zu alt');
    trashImage(ctx, bild.id, 'x1');
    ctx.sqlite
      .prepare('UPDATE trash SET deleted_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 90 * 864e5).toISOString(), 'x1');

    assert.equal(expireTrash(ctx), 1);
    assert.equal(getImage(ctx, bild.id), null);
  });
});

describe('Ordner der Galerie', () => {
  const folder = (name: string, o: { projectId?: string | null; parentId?: string | null } = {}) =>
    addFolder(ctx, {
      id: 'o' + name,
      projectId: o.projectId ?? null,
      parentId: o.parentId ?? null,
      name,
    });

  it('legt Ordner ineinander und findet die Kette wieder', () => {
    const oben = folder('Screenshots');
    const drin = folder('2025', { parentId: oben.id });
    assert.equal(drin.parentId, oben.id);
    assert.deepEqual(folderTree(ctx, oben.id).sort(), [drin.id, oben.id].sort());
  });

  it('ein hochgeladenes Bild landet im mitgegebenen Ordner', () => {
    const o = folder('Karten');
    const m = putImage(ctx, {
      projectId: null,
      folderId: o.id,
      name: 'karte.webp',
      mime: 'image/webp',
      width: 10,
      height: 10,
      bytes: Buffer.from('karte'),
      thumb: Buffer.from('k'),
    });
    assert.equal(m.folderId, o.id);
    assert.equal(getImage(ctx, m.id)?.folderId, o.id);
  });

  it('sortiert Bilder ein und wieder heraus', () => {
    const o = folder('Karten');
    const a = put('a');
    const b = put('b');
    assert.equal(moveImages(ctx, [a.id, b.id], o.id), 2);
    assert.equal(getImage(ctx, a.id)?.folderId, o.id);
    assert.equal(moveImages(ctx, [a.id], null), 1);
    assert.equal(getImage(ctx, a.id)?.folderId, null);
  });

  it('ein Bild nimmt beim Einsortieren das Projekt des Ordners an', () => {
    const p = mkProject();
    const o = folder('Spielkram', { projectId: p.id });
    const bild = put('ohne projekt');
    moveImages(ctx, [bild.id], o.id);
    assert.equal(getImage(ctx, bild.id)?.projectId, p.id);
  });

  it('auflösen wirft nichts weg: der Inhalt rückt eine Ebene höher', () => {
    const oben = folder('Oben');
    const unten = folder('Unten', { parentId: oben.id });
    const bild = put('inhalt');
    moveImages(ctx, [bild.id], unten.id);

    assert.deepEqual(deleteFolder(ctx, unten.id), { images: 0 });
    assert.equal(getFolder(ctx, unten.id), null);
    assert.equal(getImage(ctx, bild.id)?.folderId, oben.id);

    // Und eine Ebene weiter: ganz oben ist `null`, nicht verloren.
    assert.deepEqual(deleteFolder(ctx, oben.id), { images: 0 });
    assert.equal(getImage(ctx, bild.id)?.folderId, null);
  });

  it('mit Inhalt gelöscht landen die Bilder des ganzen Astes im Papierkorb', () => {
    const oben = folder('Oben');
    const unten = folder('Unten', { parentId: oben.id });
    const a = put('oben drin');
    const b = put('unten drin');
    moveImages(ctx, [a.id], oben.id);
    moveImages(ctx, [b.id], unten.id);

    const res = deleteFolder(ctx, oben.id, { withContents: true, trashId: () => 'x' + n++ });
    assert.deepEqual(res, { images: 2 });
    assert.equal(getFolder(ctx, oben.id), null);
    assert.equal(getFolder(ctx, unten.id), null);

    // Nicht endgültig: die Bytes sind noch da, der Papierkorb hält sie.
    assert.ok(getImage(ctx, a.id)?.deletedAt);
    assert.ok(getImage(ctx, b.id)?.deletedAt);
    assert.equal(loadTrash(ctx).filter((e) => e.imageId).length, 2);

    // Und von dort einzeln zurück.
    untrashImage(ctx, a.id);
    assert.equal(getImage(ctx, a.id)?.deletedAt, null);
  });

  it('ein Ordner kann nicht in sich selbst wandern', () => {
    const oben = folder('Oben');
    const unten = folder('Unten', { parentId: oben.id });
    assert.equal(moveFolder(ctx, oben.id, unten.id), null);
    assert.equal(moveFolder(ctx, oben.id, oben.id), null);
    assert.equal(getFolder(ctx, oben.id)?.parentId, null);
  });

  it('umgehängt gilt das neue Projekt für den ganzen Ast', () => {
    const a = mkProject();
    const b = create(ctx, 'project', { name: 'Anderes' }) as { id: string };
    const ziel = folder('Ziel', { projectId: b.id });
    const oben = folder('Oben', { projectId: a.id });
    const unten = folder('Unten', { projectId: a.id, parentId: oben.id });
    const bild = put('wandert');
    moveImages(ctx, [bild.id], unten.id);

    moveFolder(ctx, oben.id, ziel.id);
    assert.equal(getFolder(ctx, unten.id)?.projectId, b.id);
    assert.equal(getImage(ctx, bild.id)?.projectId, b.id);
  });

  it('ein Ordner ändert nichts an den Verwendungen', () => {
    const p = mkProject();
    const o = folder('Egal', { projectId: p.id });
    const bild = put('benutzt');
    moveImages(ctx, [bild.id], o.id);
    const t = mkTask({ projectId: p.id, title: 'Mit Bild', desc: `![x](/api/bilder/${bild.id})` });
    assert.deepEqual(
      usage(ctx).get(bild.id)?.live.map((e) => e.id),
      [t.id],
    );
  });
});
