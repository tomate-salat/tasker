import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  categoriesOf,
  categoryColorIndex,
  container,
  doneCandidates,
  doneInContainer,
  outline,
  siblings,
  unsortedTasks,
  type OutlineRow,
} from './outline.js';
import { Builder } from './testing.js';

/**
 * Der Backlog zeigt vorbereitete Milestones und „Ideen & Tasks“ – smarte
 * Gruppen gibt es nicht. Hier wird geprüft, dass die Zeilenfolge genau das ergibt – sie ist auch die
 * Grundlage der Tastatur.
 */

const kinds = (rows: OutlineRow[]): string[] =>
  rows.map((r) => (r.type === 'task' ? `task:${r.id}` : `${r.type}:${r.id}`));

const titles = (rows: OutlineRow[]): string[] =>
  rows.filter((r) => r.type === 'group').map((r) => r.title);

const build = () =>
  new Builder()
    .project('p')
    .category('c1', 'p', 'Arena')
    .category('c2', 'p', 'Battle')
    .mark('k1', '🐛', 'Bug')
    .mark('k2', '💡', 'Idee')
    .group('g1', 'p', 'Nice to have')
    .milestone('m-plan', 'p', { planned: true })
    .milestone('m-draft', 'p', { planned: false })
    .task('t-plan', 'p', { milestoneId: 'm-plan' })
    .task('t-draft', 'p', { milestoneId: 'm-draft' })
    .task('t-grp', 'p', { groupId: 'g1', markId: 'k1' })
    .task('t-lose', 'p')
    // Markiert und mit Kategorie: bleibt trotzdem unter „Unsortiert“.
    .task('t-bug', 'p', { markId: 'k1', categoryId: 'c1' })
    // Bereit ändert am Ort nichts.
    .task('r-bug', 'p', { status: 'ready', markId: 'k1' })
    .build();

const backlog = (ws: ReturnType<typeof build>, collapsed: Record<string, boolean> = {}) =>
  outline(ws, { view: 'backlog', projectIds: ['p'], collapsed });

describe('Kategorien', () => {
  const ws = new Builder()
    .project('p1')
    .project('p2')
    .category('c1', 'p1', 'Arena')
    .category('c2', 'p1', 'battle')
    .category('c3', 'p1', 'Cell')
    .category('c4', 'p1', 'Actors')
    .category('c5', 'p2', 'Zoo')
    .build();

  it('stehen alphabetisch, ohne Rücksicht auf Groß- und Kleinschreibung', () => {
    assert.deepEqual(
      categoriesOf(ws, 'p1').map((c) => c.name),
      ['Actors', 'Arena', 'battle', 'Cell'],
    );
  });

  it('behalten ihre Farbe aus der Anlage-Reihenfolge', () => {
    assert.deepEqual(
      categoriesOf(ws, 'p1').map((c) => categoryColorIndex(ws, c)),
      [3, 0, 1, 2],
    );
    assert.equal(categoryColorIndex(ws, ws.category('c5')!), 0);
  });
});

describe('Backlog-Aufbau', () => {
  it('teilt in Abschnitte und zeigt jede Gruppe genau einmal', () => {
    const rows = backlog(build());
    assert.deepEqual(
      rows.filter((r) => r.type === 'section').map((r) => r.title),
      ['Vorbereitete Milestones', 'Ideen & Tasks'],
    );
    assert.deepEqual(titles(rows), ['Unsortiert', 'Nice to have']);
  });

  it('zeigt nur vorbereitete Milestones, der Plan nur eingeplante', () => {
    const ws = build();
    assert.ok(kinds(backlog(ws)).includes('milestone:m-draft'));
    assert.ok(!kinds(backlog(ws)).includes('milestone:m-plan'));

    const plan = outline(ws, { view: 'plan', projectIds: ['p'], collapsed: {} });
    assert.deepEqual(
      plan.filter((r) => r.type === 'milestone').map((r) => r.id),
      ['m-plan'],
    );
  });

  it('zeigt lose Aufgaben unter Unsortiert – markierte und bereite ebenso', () => {
    const rows = backlog(build());
    const at = (title: string): number => rows.findIndex((r) => r.type === 'group' && r.title === title);
    const taskAt = (id: string): number => rows.findIndex((r) => r.id === id);

    for (const id of ['t-lose', 't-bug', 'r-bug']) {
      assert.ok(taskAt(id) > at('Unsortiert') && taskAt(id) < at('Nice to have'), id);
    }
    // Eine markierte Aufgabe in einer eigenen Gruppe bleibt dort.
    assert.ok(taskAt('t-grp') > at('Nice to have'));
  });

  it('lässt den Inhalt einer zugeklappten Gruppe samt Platzhalter weg', () => {
    const rows = backlog(build(), { 'unsorted:p': true });
    assert.ok(!kinds(rows).includes('task:t-lose'));
    assert.equal(rows.filter((r) => r.type === 'empty').length, 0);
  });

  it('blendet beim Filtern leere Gruppen und Platzhalter aus', () => {
    const rows = outline(build(), { view: 'backlog', projectIds: ['p'], collapsed: {}, filter: { markId: 'k1' } });
    assert.deepEqual(titles(rows), ['Unsortiert', 'Nice to have']);
    assert.equal(rows.filter((r) => r.type === 'empty').length, 0);
  });
});

describe('Behälter loser Aufgaben', () => {
  it('fasst alle losen Wurzeln unter Unsortiert zusammen', () => {
    const ws = build();
    assert.deepEqual(unsortedTasks(ws, 'p').map((t) => t.id), ['t-lose', 't-bug', 'r-bug']);
    assert.deepEqual(siblings(ws, ws.task('r-bug')!).map((t) => t.id), ['t-lose', 't-bug', 'r-bug']);
  });

  it('beschreibt den Platz so, wie Anlegen und Verschieben ihn erwarten', () => {
    const ws = build();
    assert.deepEqual(container(ws.task('r-bug')!), { parentId: null, milestoneId: null, groupId: null });
    assert.deepEqual(container(ws.task('t-grp')!), { parentId: null, milestoneId: null, groupId: 'g1' });
  });
});

describe('Erledigte archivieren', () => {
  const ws = () =>
    new Builder()
      .project('p')
      .milestone('fertig', 'p', { planned: true, status: 'done' })
      .milestone('laeuft', 'p', { planned: true })
      .milestone('entwurf', 'p', { planned: false, status: 'done' })
      .task('imFertigen', 'p', { milestoneId: 'fertig', status: 'done' })
      .task('imLaufenden', 'p', { milestoneId: 'laeuft', status: 'done' })
      .task('offen', 'p', { milestoneId: 'laeuft' })
      .task('lose', 'p', { status: 'done' })
      .task('seite', 'p', { doc: true, status: 'done' })
      .build();

  it('nimmt im Plan nur eingeplante Milestones und ihre erledigten Aufgaben', () => {
    const found = doneCandidates(ws(), { view: 'plan', projectIds: ['p'] });
    assert.deepEqual(found.milestones.map((m) => m.id), ['fertig']);
    // „imFertigen“ geht mit seinem Milestone mit und zählt nicht doppelt.
    assert.deepEqual(found.tasks.map((t) => t.id), ['imLaufenden']);
  });

  it('nimmt im Backlog die vorbereiteten Milestones und alles Lose', () => {
    const found = doneCandidates(ws(), { view: 'backlog', projectIds: ['p'] });
    assert.deepEqual(found.milestones.map((m) => m.id), ['entwurf']);
    assert.deepEqual(found.tasks.map((t) => t.id), ['lose']);
  });

  it('lässt Dokumentationsseiten in Ruhe', () => {
    for (const view of ['plan', 'backlog'] as const) {
      const found = doneCandidates(ws(), { view, projectIds: ['p'] });
      assert.equal(found.tasks.some((t) => t.doc), false);
    }
  });

  it('zählt eine Aufgabe mit, deren Unteraufgaben alle erledigt sind', () => {
    const w = new Builder()
      .project('p')
      .task('eltern', 'p')
      .task('kind', 'p', { parentId: 'eltern', status: 'done' })
      .build();
    const found = doneCandidates(w, { view: 'backlog', projectIds: ['p'] });
    assert.deepEqual(found.tasks.map((t) => t.id), ['eltern']);
  });

  it('nimmt für einen einzelnen Behälter nur dessen erledigte Wurzeln', () => {
    const w = ws();
    assert.deepEqual(
      doneInContainer(w, 'p', { milestoneId: 'laeuft' }).map((t) => t.id),
      ['imLaufenden'],
    );
    // „Unsortiert“ ist ein eigener Behälter – der Milestone zählt hier nicht mit.
    assert.deepEqual(
      doneInContainer(w, 'p', {}).map((t) => t.id),
      ['lose'],
    );
  });
});
