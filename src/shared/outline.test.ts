import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { doneCandidates, doneInContainer, outline, siblings, smartTasks, unsortedTasks, type OutlineRow } from './outline.js';
import { Builder } from './testing.js';

/**
 * Der Backlog ist im Prototyp dreigeteilt: vorbereitete Milestones,
 * „Ideen & Tasks“ und die smarten Gruppen. Hier wird geprüft, dass die
 * Zeilenfolge genau das ergibt – sie ist auch die Grundlage der Tastatur.
 */

const kinds = (rows: OutlineRow[]): string[] =>
  rows.map((r) => (r.type === 'task' ? `task:${r.id}` : `${r.type}:${r.id}`));

const titles = (rows: OutlineRow[]): string[] =>
  rows.filter((r) => r.type === 'group').map((r) => r.title);

const build = () =>
  new Builder()
    .project('p')
    .mark('k1', '🐛', 'Bug')
    .mark('k2', '💡', 'Idee')
    .group('g1', 'p', 'Nice to have')
    .milestone('m-plan', 'p', { planned: true })
    .milestone('m-draft', 'p', { planned: false })
    .task('t-plan', 'p', { milestoneId: 'm-plan' })
    .task('t-draft', 'p', { milestoneId: 'm-draft' })
    .task('t-grp', 'p', { groupId: 'g1' })
    .task('t-lose', 'p')
    .task('t-bug', 'p', { markId: 'k1' })
    .build();

const backlog = (ws: ReturnType<typeof build>, collapsed: Record<string, boolean> = {}) =>
  outline(ws, { view: 'backlog', projectIds: ['p'], collapsed });

describe('Backlog-Aufbau', () => {
  it('teilt in Abschnitte und zeigt jede Gruppe genau einmal', () => {
    const rows = backlog(build());
    assert.deepEqual(
      rows.filter((r) => r.type === 'section').map((r) => r.title),
      ['Vorbereitete Milestones', 'Ideen & Tasks', 'Smarte Gruppen'],
    );
    assert.deepEqual(titles(rows), ['Unsortiert', 'Nice to have', 'Bug', 'Idee']);
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

  it('ordnet lose Aufgaben nach Markierung in Unsortiert oder die smarte Gruppe', () => {
    const rows = backlog(build());
    const at = (title: string): number => rows.findIndex((r) => r.type === 'group' && r.title === title);
    const taskAt = (id: string): number => rows.findIndex((r) => r.id === id);

    assert.ok(taskAt('t-lose') > at('Unsortiert') && taskAt('t-lose') < at('Nice to have'));
    assert.ok(taskAt('t-bug') > at('Bug') && taskAt('t-bug') < at('Idee'));
  });

  it('setzt hinter eine leere Gruppe einen Platzhalter zum Hineinziehen', () => {
    const rows = backlog(build());
    const empty = rows.filter((r) => r.type === 'empty');
    // Leer sind: die smarte Gruppe „Idee“ – alle anderen haben eine Aufgabe.
    assert.equal(empty.length, 1);
    assert.deepEqual(empty[0]?.place, { markId: 'k2' });
  });

  it('lässt den Inhalt einer zugeklappten Gruppe samt Platzhalter weg', () => {
    const rows = backlog(build(), { 'unsorted:p': true, 'smart:k2:p': true });
    assert.ok(!kinds(rows).includes('task:t-lose'));
    assert.equal(rows.filter((r) => r.type === 'empty').length, 0);
  });

  it('blendet beim Filtern leere Gruppen und Platzhalter aus', () => {
    const ws = build();
    const rows = outline(ws, {
      view: 'backlog',
      projectIds: ['p'],
      collapsed: {},
      filter: { markId: 'k1' },
    });
    assert.deepEqual(titles(rows), ['Bug']);
    assert.equal(rows.filter((r) => r.type === 'empty').length, 0);
  });
});

describe('Behälter loser Aufgaben', () => {
  it('trennt Unsortiert und smarte Gruppe', () => {
    const ws = build();
    assert.deepEqual(
      unsortedTasks(ws, 'p').map((t) => t.id),
      ['t-lose'],
    );
    assert.deepEqual(
      smartTasks(ws, 'p', 'k1').map((t) => t.id),
      ['t-bug'],
    );
  });

  it('nimmt als Geschwister nur die der eigenen smarten Gruppe', () => {
    const ws = build();
    const bug = ws.task('t-bug');
    assert.ok(bug);
    assert.deepEqual(
      siblings(ws, bug).map((t) => t.id),
      ['t-bug'],
    );
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
      doneInContainer(w, 'p', { markId: null }).map((t) => t.id),
      ['lose'],
    );
  });
});
