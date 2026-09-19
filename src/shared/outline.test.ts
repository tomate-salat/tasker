import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { outline, siblings, smartTasks, unsortedTasks, type OutlineRow } from './outline.js';
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
