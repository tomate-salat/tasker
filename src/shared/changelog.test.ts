import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildChangelog,
  changelogMarkdown,
  changelogState,
  reorderChangelog,
  type ChangelogTask,
} from './changelog.js';
import type { ReleaseHeading } from './model.js';

let ref = 1;
const task = (id: string, o: Partial<ChangelogTask> = {}): ChangelogTask => ({
  id,
  ref: ref++,
  version: 1,
  parentId: null,
  milestoneId: 'm',
  title: id,
  status: 'done',
  changelog: '',
  changelogSkip: false,
  changelogOrder: 0,
  archived: false,
  ...o,
});
const heading = (id: string, order: number, title = id): ReleaseHeading => ({
  id,
  version: 1,
  releaseId: 'r',
  title,
  order,
});
const ids = (list: { id: string }[]): string[] => list.map((x) => x.id);

describe('Changelog', () => {
  it('kennt drei Zustände – „kein Eintrag“ schlägt einen stehengebliebenen Text', () => {
    assert.equal(changelogState({ changelog: '', changelogSkip: false }), 'open');
    assert.equal(changelogState({ changelog: '  ', changelogSkip: false }), 'open');
    assert.equal(changelogState({ changelog: 'Neu', changelogSkip: false }), 'entry');
    assert.equal(changelogState({ changelog: 'Neu', changelogSkip: true }), 'none');
  });

  it('ordnet Einträge und Überschriften gemeinsam, auch Offenes und Archiviertes', () => {
    const { items } = buildChangelog(
      [
        task('a', { changelog: 'Clowns', changelogOrder: 3 }),
        task('b', { changelog: 'Boss', changelogOrder: 5, status: 'progress' }),
        task('c', { changelog: 'Messer', changelogOrder: 1, archived: true }),
        task('d', { changelogSkip: true, changelog: 'egal', changelogOrder: 2 }),
      ],
      [heading('h1', 2), heading('h2', 4)],
    );
    assert.deepEqual(ids(items), ['c', 'h1', 'a', 'h2', 'b']);
    assert.deepEqual(
      items.filter((x) => x.kind === 'entry').map((x) => x.kind === 'entry' && x.done),
      [true, true, false],
    );
  });

  it('listet Erledigtes ohne Entscheidung – Unteraufgaben erben, entschiedene Kinder decken ab', () => {
    const { undecided } = buildChangelog(
      [
        task('offen'),
        task('läuft', { status: 'progress' }),
        task('technisch', { changelogSkip: true }),
        // Die Eltern-Aufgabe hat entschieden: die Kinder fragen nicht mehr.
        task('eltern', { changelog: 'Neu' }),
        task('kind', { parentId: 'eltern' }),
        task('enkel', { parentId: 'kind' }),
        // Alle Kinder sind entschieden: die Aufgabe darüber fragt nicht mehr.
        task('stapel'),
        task('s1', { parentId: 'stapel', changelog: 'A' }),
        task('s2', { parentId: 'stapel', changelogSkip: true }),
        // Eines fehlt noch: beide fragen.
        task('halb'),
        task('h1', { parentId: 'halb', changelog: 'A' }),
        task('h2', { parentId: 'halb' }),
      ],
      [],
    );
    assert.deepEqual(ids(undecided), ['offen', 'halb', 'h2']);
  });

  it('gibt als Markdown nur Erledigtes aus und lässt leere Überschriften weg', () => {
    const { items } = buildChangelog(
      [
        task('a', { changelog: 'Lose Zeile', changelogOrder: 1 }),
        task('b', { changelog: 'Drei Gegner', changelogOrder: 3 }),
        task('c', { changelog: 'Boss', changelogOrder: 4, status: 'open' }),
        task('d', { changelog: 'Noch offen', changelogOrder: 6, status: 'open' }),
        task('e', { changelog: 'Clowns hängen nicht mehr', changelogOrder: 8 }),
      ],
      [heading('h1', 2, 'Neu'), heading('h2', 5, 'Geplant'), heading('h3', 7, 'Behoben')],
    );
    assert.equal(
      changelogMarkdown({ name: '0.4.0', title: 'Zirkus', desc: 'Manege frei.\n' }, items),
      [
        '## 0.4.0 · Zirkus',
        '',
        'Manege frei.',
        '',
        '- Lose Zeile',
        '',
        '### Neu',
        '',
        '- Drei Gegner',
        '',
        '### Behoben',
        '',
        '- Clowns hängen nicht mehr',
        '',
      ].join('\n'),
    );
  });

  it('verschiebt in der Liste und meldet nur geänderte Plätze', () => {
    const { items } = buildChangelog(
      [
        task('a', { changelog: 'A', changelogOrder: 10 }),
        task('b', { changelog: 'B', changelogOrder: 20 }),
        task('c', { changelog: 'C', changelogOrder: 40 }),
      ],
      [heading('h', 30)],
    );
    const moved = reorderChangelog(items, 'h', 'a');
    assert.deepEqual(
      moved.map((x) => [x.item.id, x.order]),
      [['h', 10], ['a', 20], ['b', 30]],
    );
    assert.deepEqual(
      reorderChangelog(items, 'a', null).map((x) => [x.item.id, x.order]),
      [['b', 10], ['h', 20], ['c', 30], ['a', 40]],
    );
    assert.deepEqual(reorderChangelog(items, 'a', 'b'), []);
    assert.deepEqual(reorderChangelog(items, 'a', 'a'), []);
  });

  it('nummeriert neu, wenn Plätze doppelt vergeben sind', () => {
    const { items } = buildChangelog(
      [task('a', { changelog: 'A' }), task('b', { changelog: 'B' }), task('c', { changelog: 'C' })],
      [],
    );
    assert.deepEqual(
      reorderChangelog(items, 'c', 'a').map((x) => [x.item.id, x.order]),
      [['c', 1], ['a', 2], ['b', 3]],
    );
  });
});
