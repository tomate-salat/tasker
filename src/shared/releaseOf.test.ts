import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { effectiveReleases, type ReleaseMember } from './releaseOf.js';
import { releaseStatus } from './release.js';
import { Builder } from './testing.js';

const m = (id: string, releaseId: string | null, deps: string[] = [], projectId = 'p'): ReleaseMember => ({
  id,
  projectId,
  releaseId,
  deps,
});
const r = (id: string, order: number, projectId = 'p') => ({ id, projectId, order });
const of = (map: Map<string, string>) => Object.fromEntries([...map].sort());

describe('Zugehörigkeit zum Release', () => {
  it('was ein Milestone des Releases benötigt, zählt mit – über die ganze Kette', () => {
    const map = effectiveReleases(
      [m('ziel', 'r1', ['mitte']), m('mitte', null, ['anfang']), m('anfang', null), m('daneben', null)],
      [r('r1', 0)],
    );
    assert.deepEqual(of(map), { anfang: 'r1', mitte: 'r1', ziel: 'r1' });
  });

  it('die ausdrückliche Zuordnung geht vor, und an ihr endet die Kette', () => {
    const map = effectiveReleases(
      [m('spät', 'r2', ['früh']), m('früh', 'r1', ['davor']), m('davor', null)],
      [r('r1', 0), r('r2', 1)],
    );
    assert.deepEqual(of(map), { davor: 'r1', früh: 'r1', spät: 'r2' });
  });

  it('von zwei Releases gebraucht zählt er zum früheren', () => {
    const list = [m('a', 'r2', ['geteilt']), m('b', 'r1', ['geteilt']), m('geteilt', null)];
    assert.equal(effectiveReleases(list, [r('r1', 0), r('r2', 1)]).get('geteilt'), 'r1');
    assert.equal(effectiveReleases(list, [r('r1', 5), r('r2', 1)]).get('geteilt'), 'r2');
  });

  it('über die Projektgrenze und im Kreis zählt nichts doppelt', () => {
    const map = effectiveReleases(
      [m('a', 'r1', ['b', 'fremd']), m('b', null, ['a']), m('fremd', null, [], 'q')],
      [r('r1', 0)],
    );
    assert.deepEqual(of(map), { a: 'r1', b: 'r1' });
  });

  it('der Workspace rechnet damit: Milestones und Status des Releases', () => {
    const ws = new Builder()
      .project('p')
      .release('r', 'p')
      .milestone('ziel', 'p', { releaseId: 'r', qorder: 1, status: 'done', deps: ['davor'] })
      .milestone('davor', 'p', { qorder: 0 })
      .milestone('lose', 'p', { qorder: 2 })
      .build();
    assert.deepEqual(ws.releaseMilestones('r').map((x) => x.id), ['davor', 'ziel']);
    assert.equal(ws.releaseOf(ws.milestone('davor')!)?.id, 'r');
    assert.equal(ws.releaseOf(ws.milestone('lose')!), null);
    // Solange der mitgezählte Milestone offen ist, ist das Release nicht bereit.
    assert.equal(releaseStatus(ws, ws.release('r')!), 'progress');
  });
});
