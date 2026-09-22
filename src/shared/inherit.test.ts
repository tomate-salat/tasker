import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveCategory, effectiveTags, projectTags } from './inherit.js';
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
