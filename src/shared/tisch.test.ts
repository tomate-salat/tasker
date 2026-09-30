import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Builder } from './testing.js';
import { activeMilestone, doneRefusal, playRefusal, progressLockedBy, stackReady, tischLayout } from './tisch.js';

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
});
