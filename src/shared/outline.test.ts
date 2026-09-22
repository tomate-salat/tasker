import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  categoryTasks,
  container,
  doneCandidates,
  doneInContainer,
  outline,
  siblings,
  smartTasks,
  unsortedTasks,
  type OutlineRow,
} from './outline.js';
import { Builder } from './testing.js';

/**
 * Der Backlog zeigt vorbereitete Milestones und „Ideen & Tasks“; die smarten
 * Gruppen stehen im Reiter „Ready“ – erst je Kategorie, dann je Markierung.
 * Hier wird geprüft, dass die Zeilenfolge genau das ergibt – sie ist auch die
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
    // Markiert und mit Kategorie, aber nicht ready: bleibt im Backlog.
    .task('t-bug', 'p', { markId: 'k1', categoryId: 'c1' })
    .task('r-arena', 'p', { ready: true, categoryId: 'c1' })
    .task('r-none', 'p', { ready: true })
    // Markierung gewinnt vor der Kategorie.
    .task('r-bug', 'p', { ready: true, markId: 'k1', categoryId: 'c1' })
    .build();

const backlog = (ws: ReturnType<typeof build>, collapsed: Record<string, boolean> = {}) =>
  outline(ws, { view: 'backlog', projectIds: ['p'], collapsed });

const ready = (ws: ReturnType<typeof build>, collapsed: Record<string, boolean> = {}) =>
  outline(ws, { view: 'ready', projectIds: ['p'], collapsed });

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

  it('zeigt lose Aufgaben unter Unsortiert, markierte ebenso, solange sie nicht ready sind', () => {
    const rows = backlog(build());
    const at = (title: string): number => rows.findIndex((r) => r.type === 'group' && r.title === title);
    const taskAt = (id: string): number => rows.findIndex((r) => r.id === id);

    for (const id of ['t-lose', 't-bug']) {
      assert.ok(taskAt(id) > at('Unsortiert') && taskAt(id) < at('Nice to have'), id);
    }
    // Eine markierte Aufgabe in einer eigenen Gruppe bleibt dort.
    assert.ok(taskAt('t-grp') > at('Nice to have'));
    for (const id of ['r-arena', 'r-none', 'r-bug']) assert.equal(taskAt(id), -1, id);
  });

  it('lässt den Inhalt einer zugeklappten Gruppe samt Platzhalter weg', () => {
    const rows = backlog(build(), { 'unsorted:p': true });
    assert.ok(!kinds(rows).includes('task:t-lose'));
    assert.equal(rows.filter((r) => r.type === 'empty').length, 0);
  });
});

describe('Ready-Aufbau', () => {
  it('zeigt vorbereitete Milestones, dann Kategorien, dann Markierungen', () => {
    const rows = ready(build());
    assert.deepEqual(
      rows.filter((r) => r.type === 'section').map((r) => r.title),
      ['Vorbereitete Milestones', 'Smarte Gruppen (Kategorien)', 'Smarte Gruppen (Markierungen)'],
    );
    assert.ok(kinds(rows).includes('milestone:m-draft'));
    assert.ok(!kinds(rows).includes('milestone:m-plan'));
    assert.deepEqual(titles(rows), ['Arena', 'Battle', 'Ohne Kategorie', 'Bug', 'Idee']);
  });

  it('ordnet ready-Aufgaben nach Markierung, ohne Markierung nach Kategorie', () => {
    const rows = ready(build());
    const inGroup = (title: string): string[] => {
      const i = rows.findIndex((r) => r.type === 'group' && r.title === title);
      const out: string[] = [];
      for (const r of rows.slice(i + 1)) {
        if (r.type !== 'task') break;
        out.push(r.id);
      }
      return out;
    };
    assert.deepEqual(inGroup('Arena'), ['r-arena']);
    assert.deepEqual(inGroup('Ohne Kategorie'), ['r-none']);
    assert.deepEqual(inGroup('Bug'), ['r-bug']);
    for (const id of ['t-lose', 't-bug', 't-grp']) assert.ok(!kinds(rows).includes(`task:${id}`), id);
  });

  it('setzt hinter leere Gruppen einen Platzhalter, der sagt, was er setzt', () => {
    const empty = ready(build()).filter((r) => r.type === 'empty');
    // Leer sind: „Battle“ und „Idee“.
    assert.deepEqual(
      empty.map((r) => r.place),
      [
        { ready: true, markId: null, categoryId: 'c2' },
        { ready: true, markId: 'k2' },
      ],
    );
  });

  it('eine Kategorie aus einem anderen Projekt zählt wie keine', () => {
    const ws = new Builder()
      .project('p')
      .project('q')
      .category('fremd', 'q')
      .task('x', 'p', { ready: true, categoryId: 'fremd' })
      .build();
    assert.deepEqual(categoryTasks(ws, 'p', null).map((t) => t.id), ['x']);
  });

  it('blendet beim Filtern leere Gruppen und Platzhalter aus', () => {
    const ws = build();
    const rows = outline(ws, {
      view: 'ready',
      projectIds: ['p'],
      collapsed: {},
      filter: { markId: 'k1' },
    });
    assert.deepEqual(titles(rows), ['Bug']);
    assert.equal(rows.filter((r) => r.type === 'empty').length, 0);
  });
});

describe('Behälter loser Aufgaben', () => {
  it('trennt Unsortiert, Kategorie- und Markierungs-Gruppen', () => {
    const ws = build();
    assert.deepEqual(unsortedTasks(ws, 'p').map((t) => t.id), ['t-lose', 't-bug']);
    assert.deepEqual(smartTasks(ws, 'p', 'k1').map((t) => t.id), ['r-bug']);
    assert.deepEqual(categoryTasks(ws, 'p', 'c1').map((t) => t.id), ['r-arena']);
  });

  it('nimmt als Geschwister nur die der eigenen Gruppe', () => {
    const ws = build();
    const sib = (id: string) => siblings(ws, ws.task(id)!).map((t) => t.id);
    assert.deepEqual(sib('t-bug'), ['t-lose', 't-bug']);
    assert.deepEqual(sib('r-bug'), ['r-bug']);
    assert.deepEqual(sib('r-arena'), ['r-arena']);
  });

  it('beschreibt den Platz so, wie Anlegen und Verschieben ihn erwarten', () => {
    const ws = build();
    const place = (id: string) => container(ws.task(id)!);
    assert.deepEqual(place('t-bug'), { parentId: null, milestoneId: null, groupId: null, ready: false });
    assert.deepEqual(place('r-bug'), { parentId: null, milestoneId: null, groupId: null, ready: true, markId: 'k1' });
    assert.deepEqual(place('r-arena'), {
      parentId: null,
      milestoneId: null,
      groupId: null,
      ready: true,
      markId: null,
      categoryId: 'c1',
    });
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
      .task('fertigReady', 'p', { status: 'done', ready: true })
      .task('seite', 'p', { doc: true, status: 'done' })
      .build();

  it('nimmt im Plan nur eingeplante Milestones und ihre erledigten Aufgaben', () => {
    const found = doneCandidates(ws(), { view: 'plan', projectIds: ['p'] });
    assert.deepEqual(found.milestones.map((m) => m.id), ['fertig']);
    // „imFertigen“ geht mit seinem Milestone mit und zählt nicht doppelt.
    assert.deepEqual(found.tasks.map((t) => t.id), ['imLaufenden']);
  });

  it('nimmt im Backlog die vorbereiteten Milestones und alles Lose, was nicht ready ist', () => {
    const found = doneCandidates(ws(), { view: 'backlog', projectIds: ['p'] });
    assert.deepEqual(found.milestones.map((m) => m.id), ['entwurf']);
    assert.deepEqual(found.tasks.map((t) => t.id), ['lose']);
  });

  it('nimmt in „Ready“ die vorbereiteten Milestones und die ready-Aufgaben', () => {
    const found = doneCandidates(ws(), { view: 'ready', projectIds: ['p'] });
    assert.deepEqual(found.milestones.map((m) => m.id), ['entwurf']);
    assert.deepEqual(found.tasks.map((t) => t.id), ['fertigReady']);
  });

  it('lässt Dokumentationsseiten in Ruhe', () => {
    for (const view of ['plan', 'ready', 'backlog'] as const) {
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
      doneInContainer(w, 'p', { ready: false }).map((t) => t.id),
      ['lose'],
    );
  });
});
