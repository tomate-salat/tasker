import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { blockers, dependsOn, inheritedBlock, isBlocked, ownBlockers } from './blocking.js';
import { Builder } from './testing.js';

describe('Blockierungen', () => {
  it('eine offene Abhängigkeit blockiert', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { deps: ['t2'] })
      .task('t2', 'p1')
      .build();
    assert.equal(isBlocked(ws, ws.task('t1')!), true);
    assert.deepEqual(
      ownBlockers(ws, ws.task('t1')!).map((t) => t.id),
      ['t2'],
    );
  });

  it('eine erledigte Abhängigkeit blockiert nicht mehr', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { deps: ['t2'] })
      .task('t2', 'p1', { status: 'done' })
      .build();
    assert.equal(isBlocked(ws, ws.task('t1')!), false);
  });

  it('eine archivierte Abhängigkeit blockiert nicht mehr', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { deps: ['t2'] })
      .task('t2', 'p1', { archivedAt: '2026-01-01T00:00:00Z' })
      .build();
    assert.equal(isBlocked(ws, ws.task('t1')!), false);
  });

  it('der Status blockiert auch ohne Abhängigkeit', () => {
    const ws = new Builder().project('p1').task('t1', 'p1', { status: 'blocked' }).build();
    assert.equal(isBlocked(ws, ws.task('t1')!), true);
  });

  it('Abhängigkeiten über Projektgrenzen zählen', () => {
    const ws = new Builder()
      .project('p1')
      .project('p2')
      .task('t1', 'p1', { deps: ['t2'] })
      .task('t2', 'p2')
      .build();
    assert.equal(isBlocked(ws, ws.task('t1')!), true);
  });
});

describe('Geerbte Blockierungen', () => {
  const ws = new Builder()
    .project('p1')
    .task('parent', 'p1', { deps: ['extern'] })
    .task('kind', 'p1', { parentId: 'parent' })
    .task('enkel', 'p1', { parentId: 'kind' })
    .task('extern', 'p1')
    .build();

  it('gelten für alle Unteraufgaben', () => {
    const i = inheritedBlock(ws, ws.task('enkel')!);
    assert.deepEqual(
      i.deps.map((x) => [x.blocker.id, x.via.id]),
      [['extern', 'parent']],
    );
    assert.equal(isBlocked(ws, ws.task('enkel')!), true);
  });

  it('ein blockierter Elternteil blockiert den Ast', () => {
    const ws2 = new Builder()
      .project('p1')
      .task('parent', 'p1', { status: 'blocked' })
      .task('kind', 'p1', { parentId: 'parent' })
      .build();
    assert.equal(inheritedBlock(ws2, ws2.task('kind')!).statusVia?.id, 'parent');
    assert.equal(isBlocked(ws2, ws2.task('kind')!), true);
  });

  it('dieselbe Blockierung erscheint nicht doppelt', () => {
    const ws2 = new Builder()
      .project('p1')
      .task('parent', 'p1', { deps: ['extern'] })
      .task('kind', 'p1', { parentId: 'parent', deps: ['extern'] })
      .task('extern', 'p1')
      .build();
    assert.equal(inheritedBlock(ws2, ws2.task('kind')!).deps.length, 0);
    assert.deepEqual(
      blockers(ws2, ws2.task('kind')!).map((t) => t.id),
      ['extern'],
    );
  });

  it('nach dem Verschieben fällt die geerbte Blockierung weg', () => {
    const ws2 = new Builder()
      .project('p1')
      .task('parent', 'p1', { deps: ['extern'] })
      .task('kind', 'p1', { parentId: null })
      .task('extern', 'p1')
      .build();
    assert.equal(isBlocked(ws2, ws2.task('kind')!), false);
  });
});

describe('Kreise erkennen', () => {
  it('findet die Abhängigkeit über mehrere Stufen', () => {
    const ws = new Builder()
      .project('p1')
      .task('a', 'p1', { deps: ['b'] })
      .task('b', 'p1', { deps: ['c'] })
      .task('c', 'p1')
      .build();
    assert.equal(dependsOn(ws, ws.task('a')!, 'c'), true);
    assert.equal(dependsOn(ws, ws.task('c')!, 'a'), false);
  });

  it('läuft bei einem bestehenden Kreis nicht endlos', () => {
    const ws = new Builder()
      .project('p1')
      .task('a', 'p1', { deps: ['b'] })
      .task('b', 'p1', { deps: ['a'] })
      .build();
    assert.equal(dependsOn(ws, ws.task('a')!, 'x'), false);
  });

  it('gilt genauso für Milestones', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { deps: ['m2'] })
      .milestone('m2', 'p1', { deps: ['m3'] })
      .milestone('m3', 'p1')
      .build();
    assert.equal(dependsOn(ws, ws.milestone('m1')!, 'm3'), true);
  });
});
