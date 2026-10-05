import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Builder } from './testing.js';
import { Workspace } from './workspace.js';
import {
  activeMilestone,
  doneRefusal,
  doneShelf,
  playRefusal,
  progressLockedBy,
  stackReady,
  tischLayout,
  weekStart,
} from './tisch.js';

const ids = (list: { id: string }[]): string[] => list.map((x) => x.id);

describe('Tisch', () => {
  it('aktiv ist der Milestone auf In Progress, bei mehreren der oberste im Plan', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m1', 'p', { planned: true, qorder: 2, status: 'progress' })
      .milestone('m2', 'p', { planned: true, qorder: 1, status: 'progress' })
      .milestone('m3', 'p', { status: 'progress' })
      .build();
    assert.equal(activeMilestone(ws, 'p')?.id, 'm2');
    assert.equal(progressLockedBy(ws, ws.milestone('m1')!)?.id, 'm2');
  });

  it('ohne anderen aktiven Milestone ist In Progress frei', () => {
    const ws = new Builder()
      .project('p')
      .project('q')
      .milestone('m1', 'p', { status: 'progress' })
      .milestone('m2', 'q')
      .milestone('m3', 'p', { status: 'progress', archivedAt: '2026-01-01T00:00:00Z' })
      .build();
    assert.equal(progressLockedBy(ws, ws.milestone('m2')!), null);
    assert.equal(progressLockedBy(ws, ws.milestone('m1')!), null);
  });

  it('verteilt die Karten auf die Zonen', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { status: 'progress' })
      .task('frei', 'p', { milestoneId: 'm' })
      .task('unklar', 'p', { milestoneId: 'm', status: 'unclear' })
      .task('wartet', 'p', { milestoneId: 'm', deps: ['frei'] })
      .task('blockiert', 'p', { milestoneId: 'm', status: 'blocked' })
      .task('läuft', 'p', { milestoneId: 'm', status: 'progress', deps: ['frei'] })
      .task('fertig', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-01T00:00:00Z' })
      .build();
    const l = tischLayout(ws, ws.milestone('m')!);
    assert.deepEqual(ids(l.open), ['frei', 'unklar']);
    assert.deepEqual(ids(l.locked), ['wartet', 'blockiert']);
    assert.deepEqual(ids(l.play), ['läuft']);
    assert.deepEqual(ids(l.pile), ['fertig']);
  });

  it('ein Stapel bleibt in der Mitte, seine Unteraufgaben kommen ins Spiel', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { status: 'progress' })
      .task('stapel', 'p', { milestoneId: 'm', status: 'progress' })
      .task('a', 'p', { parentId: 'stapel', status: 'progress' })
      .task('b', 'p', { parentId: 'stapel' })
      .task('unter', 'p', { parentId: 'stapel', status: 'progress' })
      .task('c', 'p', { parentId: 'unter', status: 'progress' })
      .build();
    const l = tischLayout(ws, ws.milestone('m')!);
    assert.deepEqual(ids(l.open), ['stapel']);
    assert.deepEqual(ids(l.play), ['a', 'c']);
  });

  it('im Spiel gilt die Reihenfolge von Hand, bei Gleichstand die des Baums', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { status: 'progress' })
      .task('a', 'p', { milestoneId: 'm', status: 'progress', playOrder: 2 })
      .task('stapel', 'p', { milestoneId: 'm' })
      .task('b', 'p', { parentId: 'stapel', status: 'progress', playOrder: 1 })
      .task('c', 'p', { milestoneId: 'm', status: 'progress', playOrder: 2 })
      .build();
    assert.deepEqual(ids(tischLayout(ws, ws.milestone('m')!).play), ['b', 'a', 'c']);
  });

  it('der Erledigt-Stapel zeigt das zuletzt Erledigte zuerst, jeder Ebene', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { status: 'progress' })
      .task('alt', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-01T00:00:00Z' })
      .task('stapel', 'p', { milestoneId: 'm' })
      .task('neu', 'p', { parentId: 'stapel', status: 'done', doneAt: '2026-09-03T00:00:00Z' })
      .build();
    assert.deepEqual(ids(tischLayout(ws, ws.milestone('m')!).pile), ['neu', 'alt']);
  });

  it('gerade erst erledigt (noch ohne Zeitpunkt) liegt obenauf', () => {
    const ws = new Builder()
      .project('p')
      .milestone('m', 'p', { status: 'progress' })
      .task('alt', 'p', { milestoneId: 'm', status: 'done', doneAt: '2026-09-01T00:00:00Z' })
      .task('eben', 'p', { milestoneId: 'm', status: 'done', doneAt: null })
      .build();
    assert.deepEqual(ids(tischLayout(ws, ws.milestone('m')!).pile), ['eben', 'alt']);
  });

  it('gesperrte und Stapel dürfen nicht ins Spiel', () => {
    const ws = new Builder()
      .project('p')
      .task('a', 'p')
      .task('b', 'p', { deps: ['a'] })
      .task('stapel', 'p')
      .task('kind', 'p', { parentId: 'stapel' })
      .build();
    assert.equal(playRefusal(ws, ws.task('a')!), null);
    assert.ok(playRefusal(ws, ws.task('b')!));
    assert.ok(playRefusal(ws, ws.task('stapel')!));
  });

  it('ein Stapel darf erst auf den Erledigt-Stapel, wenn alles darunter erledigt ist', () => {
    const ws = new Builder()
      .project('p')
      .task('offen', 'p')
      .task('k1', 'p', { parentId: 'offen', status: 'done' })
      .task('k2', 'p', { parentId: 'offen' })
      .task('fertig', 'p')
      .task('k3', 'p', { parentId: 'fertig', status: 'done' })
      .task('liste', 'p', { desc: '- [x] eins\n- [ ] zwei' })
      .build();
    assert.ok(doneRefusal(ws, ws.task('offen')!));
    assert.equal(doneRefusal(ws, ws.task('fertig')!), null);
    assert.ok(doneRefusal(ws, ws.task('liste')!));
    assert.equal(stackReady(ws, ws.task('fertig')!), true);
    assert.equal(stackReady(ws, ws.task('offen')!), false);
  });

  describe('Ablage', () => {
    // Mittwoch, 07.10.2026 – die Woche beginnt am Montag, 05.10. Zeiten zur Mittagszeit, damit die Zeitzone egal ist.
    const now = new Date(2026, 9, 7, 12);
    const on = (month: number, d: number, h = 12): string => new Date(2026, month - 1, d, h).toISOString();

    it('die Woche beginnt am Montag, auch am Sonntag und über den Monatswechsel', () => {
      assert.equal(weekStart(now), '2026-10-05');
      assert.equal(weekStart(new Date(2026, 9, 4, 23)), '2026-09-28');
      assert.equal(weekStart(new Date(2026, 9, 5, 0)), '2026-10-05');
    });

    it('legt Erledigtes je Woche ab, das Jüngste zuerst, und zählt nur Karten ohne Unteraufgaben', () => {
      const ws = new Builder()
        .project('p')
        .milestone('m', 'p', { status: 'progress' })
        .task('offen', 'p', { milestoneId: 'm' })
        .task('stapel', 'p', { milestoneId: 'm', status: 'done', doneAt: on(10, 6, 15) })
        .task('k1', 'p', { parentId: 'stapel', status: 'done', doneAt: on(10, 6, 14) })
        .task('k2', 'p', { parentId: 'stapel', status: 'done', doneAt: on(9, 30) })
        .task('alt', 'p', { milestoneId: 'm', status: 'done', doneAt: on(9, 29) })
        .task('älter', 'p', { milestoneId: 'm', status: 'done', doneAt: on(9, 15) })
        .task('eben', 'p', { milestoneId: 'm', status: 'done', doneAt: null })
        .build();
      const s = doneShelf(ws, ws.milestone('m')!, now);
      assert.deepEqual(
        s.weeks.map((w) => [w.start, ids(w.cards), w.count, w.current, w.best]),
        [
          ['2026-10-05', ['eben', 'stapel', 'k1'], 2, true, true],
          ['2026-09-28', ['k2', 'alt'], 2, false, false],
          ['2026-09-14', ['älter'], 1, false, false],
        ],
      );
      assert.equal(s.thisWeek, 2);
      // 05.10. und 28.09. – die Woche ab 21.09. ist leer.
      assert.equal(s.streak, 2);
    });

    it('die laufende Woche bricht die Serie nicht, und erledigt Archiviertes bleibt liegen', () => {
      const raw = new Builder()
        .project('p')
        .milestone('m', 'p', { status: 'progress' })
        .task('a', 'p', { milestoneId: 'm', status: 'done', doneAt: on(9, 29) })
        .task('b', 'p', { milestoneId: 'm', status: 'done', doneAt: on(9, 22) })
        .raw();
      const archiviert = { ...raw.tasks[1]!, id: 'weg', title: 'weg', doneAt: on(9, 23), archivedAt: on(10, 1) };
      const ws = new Workspace({ ...raw, archivedTasks: [archiviert] });
      const s = doneShelf(ws, ws.milestone('m')!, now);
      assert.deepEqual(s.weeks.map((w) => ids(w.cards)), [['a'], ['weg', 'b']]);
      assert.equal(s.weeks[1]!.best, true);
      assert.equal(s.thisWeek, 0);
      assert.equal(s.streak, 2);
    });
  });
});
