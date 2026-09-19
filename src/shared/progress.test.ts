import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  allDone,
  doneCount,
  milestoneProgressPct,
  milestoneStats,
  progressPct,
  statusSegments,
  total,
} from './progress.js';
import { Builder } from './testing.js';

/** Baum: t1 → (t2 → (t3, t4), t5) */
function tree() {
  return new Builder()
    .project('p1')
    .task('t1', 'p1')
    .task('t2', 'p1', { parentId: 't1' })
    .task('t3', 'p1', { parentId: 't2' })
    .task('t4', 'p1', { parentId: 't2' })
    .task('t5', 'p1', { parentId: 't1' })
    .build();
}

describe('Aufgaben zählen', () => {
  it('zählt Blätter, nicht Knoten', () => {
    const ws = tree();
    assert.equal(total(ws, ws.task('t1')!), 3);
    assert.equal(total(ws, ws.task('t2')!), 2);
    assert.equal(total(ws, ws.task('t3')!), 1);
  });

  it('erledigte Unteraufgaben summieren sich nach oben', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1')
      .task('t2', 'p1', { parentId: 't1', status: 'done' })
      .task('t3', 'p1', { parentId: 't1' })
      .build();
    assert.equal(doneCount(ws, ws.task('t1')!), 1);
    assert.equal(progressPct(ws, ws.task('t1')!), 50);
  });

  it('ein erledigter Elternteil zählt seinen ganzen Teilbaum', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { status: 'done' })
      .task('t2', 'p1', { parentId: 't1' })
      .task('t3', 'p1', { parentId: 't1' })
      .build();
    assert.equal(doneCount(ws, ws.task('t1')!), 2);
    assert.equal(progressPct(ws, ws.task('t1')!), 100);
  });

  it('archivierte Unteraufgaben zählen nicht mit', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1')
      .task('t2', 'p1', { parentId: 't1' })
      .task('t3', 'p1', { parentId: 't1', archivedAt: '2026-01-01T00:00:00Z' })
      .build();
    assert.equal(total(ws, ws.task('t1')!), 1);
  });

  it('allDone gilt auch ohne eigenen Status', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1')
      .task('t2', 'p1', { parentId: 't1', status: 'done' })
      .task('t3', 'p1', { parentId: 't1', status: 'done' })
      .build();
    assert.equal(allDone(ws, ws.task('t1')!), true);
    assert.equal(ws.task('t1')!.status, 'open');
  });
});

describe('Checkliste im Fortschritt', () => {
  it('eine offene Aufgabe zählt anteilig nach ihrer Checkliste', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { desc: '- [x] a\n- [x] b\n- [ ] c\n- [ ] d' })
      .build();
    assert.equal(progressPct(ws, ws.task('t1')!), 50);
  });

  it('die Checkliste eines Elternteils zählt nicht doppelt', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { desc: '- [x] a' })
      .task('t2', 'p1', { parentId: 't1' })
      .build();
    // t1 hat eine Unteraufgabe, also zählt nur diese
    assert.equal(progressPct(ws, ws.task('t1')!), 0);
  });
});

describe('Milestone-Kennzahlen', () => {
  const ws = new Builder()
    .project('p1')
    .milestone('m1', 'p1', { planned: true })
    .task('t1', 'p1', { milestoneId: 'm1', status: 'done' })
    .task('t2', 'p1', { milestoneId: 'm1' })
    .task('t3', 'p1', { milestoneId: 'm1', parentId: null })
    .build();

  it('summiert über die Wurzelaufgaben', () => {
    const s = milestoneStats(ws, ws.milestone('m1')!);
    assert.deepEqual(
      { total: s.total, done: s.done, open: s.open, count: s.count },
      { total: 3, done: 1, open: 2, count: 3 },
    );
  });

  it('ein manuell erledigter Milestone hat nichts Offenes mehr', () => {
    const done = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, status: 'done' })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .build();
    const s = milestoneStats(done, done.milestone('m1')!);
    assert.equal(s.open, 0);
    assert.equal(s.isDone, true);
    assert.equal(milestoneProgressPct(done, done.milestone('m1')!), 100);
  });

  it('tasksDone ist unabhängig vom Status', () => {
    const ws2 = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true })
      .task('t1', 'p1', { milestoneId: 'm1', status: 'done' })
      .build();
    const s = milestoneStats(ws2, ws2.milestone('m1')!);
    assert.equal(s.tasksDone, true);
    assert.equal(s.isDone, false);
  });
});

describe('Segmente für den Fortschrittsbalken', () => {
  it('ein Segment je Checklisten-Punkt und je Blatt-Aufgabe', () => {
    const ws = new Builder()
      .project('p1')
      .task('t1', 'p1', { desc: '- [x] a\n- [ ] b' })
      .task('t2', 'p1', { parentId: 't1', status: 'progress' })
      .task('t3', 'p1', { parentId: 't1' })
      .task('t4', 'p1', { parentId: 't3', status: 'blocked' })
      .build();

    assert.deepEqual(statusSegments(ws, ws.task('t1')!), [
      { kind: 'checklist', done: true },
      { kind: 'checklist', done: false },
      { kind: 'task', status: 'progress' },
      { kind: 'task', status: 'blocked' },
    ]);
  });

  it('funktioniert genauso für Milestones', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, desc: '- [ ] offen' })
      .task('t1', 'p1', { milestoneId: 'm1', status: 'unclear' })
      .build();

    assert.deepEqual(statusSegments(ws, ws.milestone('m1')!), [
      { kind: 'checklist', done: false },
      { kind: 'task', status: 'unclear' },
    ]);
  });
});
