import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseQuery, searchWorkspace, splitMatches } from './search.js';
import { Builder } from './testing.js';

const world = () =>
  new Builder()
    .project('hafen')
    .project('web')
    .milestone('ms', 'hafen', { title: 'Ankerplatz ausbauen' }) // $1
    .task('anim', 'hafen', { title: 'Anker-Animation', milestoneId: 'ms', tags: ['Animation'] }) // $2
    .task('kai', 'hafen', { title: 'Kollision am Kai', desc: 'Das Schiff bleibt\nam Anker hängen.', tags: ['bug'] }) // $3
    .task('kette', 'hafen', { title: 'Ankerkette', status: 'done' }) // $4
    .task('alt', 'hafen', { title: 'Anker-Sound', archivedAt: '2026-03-01T00:00:00Z' }) // $5
    .task('doku', 'hafen', { title: 'Regeln', doc: true }) // $6
    .task('seite', 'hafen', { title: 'Anker werfen', parentId: 'doku' }) // $7
    .task('links', 'web', { title: 'Anker-Links reparieren', tags: ['bug'] }) // $8
    .build();

const find = (raw: string, o: { projectId?: string | null; all?: boolean } = {}): string[] =>
  searchWorkspace(world(), parseQuery(raw), { projectId: o.projectId ?? 'hafen', all: o.all ?? false }).map(
    (h) => h.id,
  );

describe('Suche', () => {
  it('findet in Titel und Beschreibung, Erledigtes zuletzt, Archiviertes nicht', () => {
    assert.deepEqual(find('anker'), ['seite', 'anim', 'ms', 'kai', 'kette']);
  });

  it('ohne Eingabe gibt es keine Treffer', () => {
    assert.deepEqual(find('  '), []);
  });

  it('bleibt im Projekt – über alle Projekte steht das eigene zuerst', () => {
    assert.deepEqual(find('links'), []);
    assert.deepEqual(find('anker', { all: true }).at(-1), 'links');
    assert.equal(find('anker', { all: true, projectId: 'web' })[0], 'links');
  });

  it('alle Wörter müssen vorkommen, die Reihenfolge ist gleich', () => {
    assert.deepEqual(find('kai anker'), ['kai']);
    assert.deepEqual(find('kai segel'), []);
  });

  it('ein Treffer in der Beschreibung bringt den Ausschnitt mit', () => {
    const [hit] = searchWorkspace(world(), parseQuery('hängen'), { projectId: 'hafen', all: false });
    assert.equal(hit?.id, 'kai');
    assert.equal(hit?.snippet, 'Das Schiff bleibt am Anker hängen.');
  });

  it('Nummern: mit $ nur die Nummer, ohne auch der Text', () => {
    assert.deepEqual(find('$3'), ['kai']);
    assert.deepEqual(find('3'), ['kai']);
    assert.deepEqual(find('$99'), []);
  });

  it('#Label grenzt ein und lässt sich mit Text verbinden', () => {
    assert.deepEqual(find('#bug', { all: true }), ['kai', 'links']);
    assert.deepEqual(find('#ani'), ['anim']);
    assert.deepEqual(find('#bug repar', { all: true }), ['links']);
  });

  it('erkennt Dokumente an der Wurzel', () => {
    const hits = searchWorkspace(world(), parseQuery('werfen'), { projectId: 'hafen', all: false });
    assert.equal(hits[0]?.doc, true);
  });

  it('zerlegt an den Fundstellen', () => {
    assert.deepEqual(splitMatches('Anker am Kai', ['anker', 'kai']), ['', 'Anker', ' am ', 'Kai', '']);
    assert.deepEqual(splitMatches('C++ (neu)', ['c++']), ['', 'C++', ' (neu)']);
    assert.deepEqual(splitMatches('Titel', []), ['Titel']);
  });
});
