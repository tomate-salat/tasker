import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { releaseGroups, releaseLabel, releaseStatus } from './release.js';
import { schedule } from './schedule.js';
import { Builder } from './testing.js';

const AT = '2026-10-10T12:00:00.000Z';

describe('Release', () => {
  it('ohne Milestones und Kanäle ist es geplant', () => {
    const ws = new Builder().project('p').release('r', 'p').build();
    assert.equal(releaseStatus(ws, ws.release('r')!), 'planned');
  });

  it('in Arbeit, sobald ein Milestone läuft oder fertig ist', () => {
    const ws = new Builder()
      .project('p')
      .release('r', 'p')
      .release('r2', 'p')
      .milestone('m1', 'p', { releaseId: 'r', status: 'progress' })
      .milestone('m2', 'p', { releaseId: 'r' })
      .milestone('m3', 'p', { releaseId: 'r2', status: 'done' })
      .milestone('m4', 'p', { releaseId: 'r2' })
      .build();
    assert.equal(releaseStatus(ws, ws.release('r')!), 'progress');
    assert.equal(releaseStatus(ws, ws.release('r2')!), 'progress');
    assert.deepEqual(ws.releaseMilestones('r').map((m) => m.id), ['m1', 'm2']);
  });

  it('bereit, wenn alle Milestones fertig sind – auch über erledigte Aufgaben', () => {
    const ws = new Builder()
      .project('p')
      .release('r', 'p')
      .stage('itch', 'r')
      .milestone('m1', 'p', { releaseId: 'r', status: 'done' })
      .milestone('m2', 'p', { releaseId: 'r' })
      .task('t', 'p', { milestoneId: 'm2', status: 'done' })
      .build();
    assert.equal(releaseStatus(ws, ws.release('r')!), 'ready');
  });

  it('veröffentlicht erst, wenn alle Kanäle abgehakt sind', () => {
    const some = new Builder()
      .project('p')
      .release('r', 'p')
      .stage('itch', 'r', AT)
      .stage('steam', 'r')
      .milestone('m1', 'p', { releaseId: 'r', status: 'done' })
      .build();
    assert.equal(releaseStatus(some, some.release('r')!), 'ready');

    const all = new Builder().project('p').release('r', 'p').stage('itch', 'r', AT).stage('steam', 'r', AT).build();
    assert.equal(releaseStatus(all, all.release('r')!), 'released');
  });

  it('ein archivierter Milestone zählt nicht mehr mit', () => {
    const ws = new Builder()
      .project('p')
      .release('r', 'p')
      .milestone('m1', 'p', { releaseId: 'r', status: 'done' })
      .milestone('m2', 'p', { releaseId: 'r', archivedAt: AT })
      .build();
    assert.equal(releaseStatus(ws, ws.release('r')!), 'ready');
  });

  it('zählt archivierte Milestones mit, wenn sie genannt werden', () => {
    const ws = new Builder().project('p').release('r', 'p').build();
    assert.equal(releaseStatus(ws, ws.release('r')!, 2), 'ready');
    const open = new Builder().project('p').release('r', 'p').milestone('m', 'p', { releaseId: 'r' }).build();
    assert.equal(releaseStatus(open, open.release('r')!, 1), 'progress');
  });

  it('gruppiert den Zeitplan nach Release – ohne Release steht je Projekt am Schluss', () => {
    const b = new Builder()
      .project('p')
      .project('q')
      .release('r1', 'p')
      .release('r2', 'p')
      .milestone('lose', 'p', { planned: true, qorder: 0 })
      .milestone('a', 'p', { planned: true, qorder: 1, releaseId: 'r2' })
      .milestone('b', 'p', { planned: true, qorder: 2, releaseId: 'r1' })
      .milestone('c', 'p', { planned: true, qorder: 3, releaseId: 'r2' })
      .milestone('fremd', 'q', { planned: true, qorder: 0 });
    for (const m of ['lose', 'a', 'b', 'c', 'fremd']) {
      for (let i = 0; i < 4; i++) b.task(`${m}${i}`, m === 'fremd' ? 'q' : 'p', { milestoneId: m });
    }
    const ws = b.build();
    const groups = releaseGroups(ws, schedule(ws, { velocity: 4 }).list);
    assert.deepEqual(
      groups.map((g) => [g.projectId, g.release?.id ?? null, g.rows.map((x) => x.milestone.id)]),
      [
        ['p', 'r2', ['a', 'c']],
        ['p', 'r1', ['b']],
        ['p', null, ['lose']],
        ['q', null, ['fremd']],
      ],
    );
    // Vier Aufgaben je Milestone bei Tempo vier: je eine Woche, nacheinander.
    const r2 = groups[0]!;
    assert.deepEqual([r2.start, r2.end, r2.done], [1, 4, false]);
  });

  it('nennt Version und Titel, soweit vorhanden', () => {
    assert.equal(releaseLabel({ name: '0.4.0', title: 'Zirkus' }), '0.4.0 · Zirkus');
    assert.equal(releaseLabel({ name: '', title: 'Zirkus' }), 'Zirkus');
    assert.equal(releaseLabel({ name: '', title: '' }), 'Ohne Version');
  });
});
