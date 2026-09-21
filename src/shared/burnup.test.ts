import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { backfillLog, burnupData, monotonePath, withNow } from './burnup.js';
import { Builder } from './testing.js';

const NOW = new Date('2026-09-21T09:00:00');
/** Ein Zeitpunkt mittags in Ortszeit, als UTC-String wie vom Server. */
const noonOf = (day: string): string => new Date(`${day}T12:00:00`).toISOString();

describe('backfillLog', () => {
  it('nimmt den Umfang von heute und das Erledigte aus den Abschlusszeitpunkten', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { startDate: '2026-09-10' })
      .task('a', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-15T10:00:00.000Z' })
      .task('b', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-12T10:00:00.000Z' })
      .task('c', 'p', { milestoneId: 'm', status: 'done', doneAt: null })
      .task('d', 'p', { milestoneId: 'm' })
      .build();
    assert.deepEqual(backfillLog(ws, ws.milestone('m')!), [
      { at: '1970-01-01T00:00:00.000Z', s: 4, dn: 1 },
      { at: '2026-09-12T10:00:00.000Z', s: 4, dn: 2 },
      { at: '2026-09-15T10:00:00.000Z', s: 4, dn: 3 },
    ]);
  });
});

describe('withNow', () => {
  const log = [{ at: '2026-09-10T08:00:00.000Z', s: 3, dn: 0 }];

  it('lässt das Protokoll ohne Änderung stehen und hängt sonst an', () => {
    assert.equal(withNow(log, 3, 0, '2026-09-21T08:00:00.000Z'), log);
    assert.deepEqual(withNow(log, 4, 1, '2026-09-21T08:00:00.000Z').at(-1), {
      at: '2026-09-21T08:00:00.000Z',
      s: 4,
      dn: 1,
    });
  });
});

describe('burnupData', () => {
  it('gibt es erst ab einem Startdatum, das nicht in der Zukunft liegt', () => {
    const ws = new Builder()
      .project('p')
      .milestone('ohne', 'p')
      .milestone('bald', 'p', { startDate: '2026-10-01' })
      .build();
    assert.equal(burnupData(ws.milestone('ohne')!, [], 2, NOW), null);
    assert.equal(burnupData(ws.milestone('bald')!, [], 2, NOW), null);
  });

  it('verteilt die Zeitpunkte auf Tage, füllt Lücken und rechnet die Prognose', () => {
    const ws = new Builder().project('p').milestone('m', 'p', { startDate: '2026-09-17' }).build();
    const d = burnupData(
      ws.milestone('m')!,
      [
        { at: noonOf('2026-09-17'), s: 4, dn: 0 },
        { at: new Date('2026-09-19T09:00:00').toISOString(), s: 6, dn: 1 },
        // Am selben Tag gilt der letzte Stand.
        { at: new Date('2026-09-19T18:00:00').toISOString(), s: 6, dn: 2 },
        { at: noonOf('2026-09-20'), s: 5, dn: 2 },
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
    const d = burnupData(ws.milestone('m')!, [{ at: noonOf('2026-09-17'), s: 2, dn: 2 }], 2, NOW)!;
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
