import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveCategory, effectiveCover, effectiveTags, projectTags } from './inherit.js';
import { Builder } from './testing.js';

describe('Kategorien vererben nach unten', () => {
  const ws = new Builder()
    .project('p1')
    .category('c1', 'p1', 'Player')
    .category('c2', 'p1', 'Gegner')
    .task('t1', 'p1', { categoryId: 'c1' })
    .task('t2', 'p1', { parentId: 't1' })
    .task('t3', 'p1', { parentId: 't2', categoryId: 'c2' })
    .task('t4', 'p1')
    .build();

  it('eigene Kategorie kommt ohne Herkunft', () => {
    const e = effectiveCategory(ws, ws.task('t1')!);
    assert.equal(e?.category.id, 'c1');
    assert.equal(e?.from, null);
  });

  it('ohne eigene gilt die des nächsten Elternteils', () => {
    const e = effectiveCategory(ws, ws.task('t2')!);
    assert.equal(e?.category.id, 'c1');
    assert.equal(e?.from?.id, 't1');
  });

  it('eine eigene Kategorie sticht die geerbte', () => {
    assert.equal(effectiveCategory(ws, ws.task('t3')!)?.category.id, 'c2');
  });

  it('ohne Kategorie im ganzen Ast gibt es keine', () => {
    assert.equal(effectiveCategory(ws, ws.task('t4')!), null);
  });
});

describe('Titelbilder: Projekt → Kategorie → Markierung → Task → Unteraufgabe', () => {
  const build = (covers: { p?: string; k?: string; c?: string; t1?: string; t2?: string }) => {
    const b = new Builder()
      .project('p1')
      .mark('k1')
      .category('c1', 'p1')
      .task('t1', 'p1', { markId: 'k1', categoryId: 'c1', coverImageId: covers.t1 ?? null })
      .task('t2', 'p1', { parentId: 't1', coverImageId: covers.t2 ?? null })
      .task('t3', 'p1', { parentId: 't2' })
      .task('t4', 'p1');
    const raw = b.raw();
    raw.projects[0]!.coverImageId = covers.p ?? null;
    raw.marks[0]!.coverImageId = covers.k ?? null;
    raw.categories[0]!.coverImageId = covers.c ?? null;
    return b.build();
  };
  const cover = (ws: ReturnType<typeof build>, id: string) => {
    const e = effectiveCover(ws, ws.task(id)!);
    return e && [e.imageId, e.from.kind];
  };

  it('ohne irgendein Bild gibt es keins', () => {
    assert.equal(cover(build({}), 't3'), null);
  });

  it('das Projekt ist die letzte Vorgabe – auch für Aufgaben ohne Markierung und Kategorie', () => {
    const ws = build({ p: 'bp' });
    assert.deepEqual(cover(ws, 't3'), ['bp', 'project']);
    assert.deepEqual(cover(ws, 't4'), ['bp', 'project']);
  });

  it('die Kategorie sticht das Projekt, auch geerbt', () => {
    assert.deepEqual(cover(build({ p: 'bp', c: 'bc' }), 't3'), ['bc', 'category']);
  });

  it('die Markierung sticht die Kategorie', () => {
    assert.deepEqual(cover(build({ p: 'bp', k: 'bk', c: 'bc' }), 't3'), ['bk', 'mark']);
  });

  it('ein Task sticht jede Vorgabe, der nächste Vorfahr gewinnt', () => {
    assert.deepEqual(cover(build({ p: 'bp', k: 'bk', c: 'bc', t1: 'b1' }), 't3'), ['b1', 'task']);
    assert.deepEqual(cover(build({ c: 'bc', t1: 'b1', t2: 'b2' }), 't3'), ['b2', 'task']);
    assert.deepEqual(cover(build({ c: 'bc', t1: 'b1', t2: 'b2' }), 't1'), ['b1', 'task']);
  });
});

describe('Labels vererben nach oben', () => {
  const ws = new Builder()
    .project('p1')
    .task('t1', 'p1', { tags: ['code'] })
    .task('t2', 'p1', { parentId: 't1', tags: ['ui'] })
    .task('t3', 'p1', { parentId: 't2', tags: ['ui', 'audio'] })
    .build();

  it('der Elternteil zeigt eigene und geerbte Labels', () => {
    const e = effectiveTags(ws, ws.task('t1')!);
    assert.deepEqual(e.own, ['code']);
    assert.deepEqual(e.tags, ['code', 'ui', 'audio']);
  });

  it('jedes geerbte Label kennt seine Herkunft', () => {
    const e = effectiveTags(ws, ws.task('t1')!);
    assert.deepEqual(
      e.extra.map((x) => [x.tag, x.from.id]),
      [
        ['ui', 't2'],
        ['audio', 't3'],
      ],
    );
  });

  it('Labels wandern nicht nach unten', () => {
    assert.deepEqual(effectiveTags(ws, ws.task('t3')!).tags, ['ui', 'audio']);
  });

  it('doppelte Labels erscheinen nur einmal', () => {
    const e = effectiveTags(ws, ws.task('t2')!);
    assert.deepEqual(e.tags, ['ui', 'audio']);
  });

  it('archivierte Unteraufgaben vererben nichts', () => {
    const ws2 = new Builder()
      .project('p1')
      .task('t1', 'p1', { tags: ['code'] })
      .task('t2', 'p1', { parentId: 't1', tags: ['weg'], archivedAt: '2026-01-01T00:00:00Z' })
      .build();
    assert.deepEqual(effectiveTags(ws2, ws2.task('t1')!).tags, ['code']);
  });
});

describe('Label-Vorschläge', () => {
  const ws = new Builder()
    .project('p1')
    .project('p2')
    .task('t1', 'p1', { tags: ['ui', 'code'] })
    .task('t2', 'p1', { tags: ['code'] })
    .task('t3', 'p2', { tags: ['garten'] })
    .build();

  it('nur die Labels des eigenen Projekts, sortiert und einmal', () => {
    assert.deepEqual(projectTags(ws, ['p1']), ['code', 'ui']);
  });

  it('bei mehreren Projekten deren Labels zusammen', () => {
    assert.deepEqual(projectTags(ws, ['p1', 'p2']), ['code', 'garten', 'ui']);
  });
});
