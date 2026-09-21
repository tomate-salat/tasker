import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backfillLog, burnupData, monotonePath, withToday } from './burnup.js';
import { Builder } from './testing.js';

const NOW = new Date('2026-09-21T09:00:00');

describe('backfillLog', () => {
  it('nimmt den Umfang von heute und das Erledigte aus den Abschlussdaten', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { startDate: '2026-09-10' })
      .task('a', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-12T10:00:00' })
      .task('b', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-15T10:00:00' })
      .task('c', 'p', { milestoneId: 'm' })
      .build();
    assert.deepEqual(backfillLog(ws, ws.milestone('m')!, '2026-09-21'), [
      { d: '2026-09-10', s: 3, dn: 0 },
      { d: '2026-09-12', s: 3, dn: 1 },
      { d: '2026-09-15', s: 3, dn: 2 },
    ]);
  });

  it('beginnt ohne Startdatum heute', () => {
    const ws = new Builder().project('p').milestone('m', 'p').task('a', 'p', { milestoneId: 'm' }).build();
    assert.deepEqual(backfillLog(ws, ws.milestone('m')!, '2026-09-21'), [{ d: '2026-09-21', s: 1, dn: 0 }]);
  });
});

describe('withToday', () => {
  const log = [{ d: '2026-09-10', s: 3, dn: 0 }];

  it('lässt das Protokoll ohne Änderung stehen', () => {
    assert.equal(withToday(log, 3, 0, '2026-09-21'), log);
  });

  it('hängt einen neuen Tag an und überschreibt denselben Tag', () => {
    const next = withToday(log, 4, 1, '2026-09-21');
    assert.deepEqual(next.at(-1), { d: '2026-09-21', s: 4, dn: 1 });
    assert.deepEqual(withToday(next, 5, 1, '2026-09-21'), [log[0], { d: '2026-09-21', s: 5, dn: 1 }]);
  });
});

describe('burnupData', () => {
  const b = new Builder().project('p');

  it('gibt es erst ab einem Startdatum, das nicht in der Zukunft liegt', () => {
    b.milestone('ohne', 'p').milestone('bald', 'p', { startDate: '2026-10-01' });
    const ws = b.build();
    assert.equal(burnupData(ws.milestone('ohne')!, [], 2, NOW), null);
    assert.equal(burnupData(ws.milestone('bald')!, [], 2, NOW), null);
  });

  it('füllt Tage ohne Eintrag mit dem letzten Stand und rechnet die Prognose', () => {
    const ws = new Builder().project('p').milestone('m', 'p', { startDate: '2026-09-17' }).build();
    const d = burnupData(
      ws.milestone('m')!,
      [
        { d: '2026-09-17', s: 4, dn: 0 },
        { d: '2026-09-19', s: 6, dn: 2 },
        { d: '2026-09-20', s: 5, dn: 2 },
      ],
      2,
      NOW,
    )!;
    assert.deepEqual(d.scope, [4, 4, 6, 5, 5]);
    assert.deepEqual(d.doneS, [0, 0, 2, 2, 2]);
    assert.equal(d.todayI, 4);
    // 3 offen bei 2 pro Woche: anderthalb Wochen nach heute.
    assert.equal(d.fcI, 4 + 10.5);
    assert.equal(d.added, 2);
    assert.equal(d.removed, 1);
  });

  it('endet bei einem erledigten Milestone am Enddatum, ohne Prognose', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { startDate: '2026-09-17', endDate: '2026-09-19', status: 'done' })
      .build();
    const d = burnupData(ws.milestone('m')!, [{ d: '2026-09-17', s: 2, dn: 2 }], 2, NOW)!;
    assert.equal(d.endI, 2);
    assert.equal(d.fcI, null);
  });
});

describe('monotonePath', () => {
  it('bleibt auf Plateaus flach', () => {
    assert.equal(monotonePath([[0, 5]]), 'M0,5');
    assert.equal(monotonePath([[0, 5], [3, 5]]), 'M0,5C1,5 2,5 3,5');
  });
});
