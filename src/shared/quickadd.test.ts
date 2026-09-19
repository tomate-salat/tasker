import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseQuickAdd, quickAddInput, targetLabel } from './quickadd.js';
import { Builder } from './testing.js';

/** Derselbe Bestand für alle Fälle: zwei Projekte, ein Milestone, eine Gruppe. */
function ws() {
  const b = new Builder()
    .project('p1', 'Dungeon-Spiel')
    .project('p2', 'Portfolio-Website')
    .category('c1', 'p1', 'Player')
    .group('g1', 'p1', 'Ideen')
    .milestone('m1', 'p1', { title: 'Vertical Slice', planned: true })
    .milestone('m2', 'p1', { title: 'Alte Demo', planned: true, archivedAt: '2024-01-01' })
    .task('t1', 'p1', { title: 'Kampfsystem', milestoneId: 'm1' })
    .task('t2', 'p1', { title: 'Nahkampf', parentId: 't1' })
    .task('t3', 'p2', { title: 'Kontaktformular' });
  b.raw().marks.push({ id: 'k1', version: 1, emoji: '🐞', name: 'Bug', order: 0 });
  return b.build();
}

const parse = (text: string, projectId = 'p1') => parseQuickAdd(ws(), text, projectId);

describe('Schnell-Erfassung', () => {
  it('nimmt die einfachen Zeichen auseinander', () => {
    const r = parse('Kombo-System #code #ui !1 ~progress');
    assert.equal(r.title, 'Kombo-System');
    assert.deepEqual(r.tags, ['code', 'ui']);
    assert.equal(r.prio, 1);
    assert.equal(r.status, 'progress');
  });

  it('lässt stehen, was keine gültige Angabe ist', () => {
    // !7 gibt es nicht, ~xyz auch nicht – beides bleibt Text statt zu verschwinden.
    const r = parse('Preis !7 senken ~xyz');
    assert.equal(r.title, 'Preis !7 senken ~xyz');
    assert.equal(r.prio, 0);
    assert.equal(r.status, null);
  });

  it('findet Milestone, Gruppe und Aufgabe als Ziel', () => {
    assert.deepEqual(
      [parse('A >"Vertical Slice"').target?.kind, parse('B >Ideen').target?.kind, parse('C >Nahkampf').target?.kind],
      ['milestone', 'group', 'task'],
    );
    assert.equal(targetLabel(parse('A >vertical').target), '◆ Vertical Slice');
    assert.equal(targetLabel(null), 'Backlog › Unsortiert');
  });

  it('übergeht archivierte Milestones und meldet, was fehlt', () => {
    const r = parse('A >"Alte Demo"');
    assert.equal(r.target, null);
    assert.deepEqual(r.missing, [{ field: 'Ort', query: 'Alte Demo' }]);
  });

  it('wechselt mit + das Projekt', () => {
    const r = parse('Impressum +portfolio');
    assert.equal(r.projectId, 'p2');
    assert.equal(r.title, 'Impressum');
    assert.deepEqual(parse('X +gibtsnicht').missing, [{ field: 'Projekt', query: 'gibtsnicht' }]);
  });

  it('übernimmt das Projekt des Ziels', () => {
    // Ohne `+` darf ein Ziel aus einem anderen Projekt gefunden werden.
    const r = parse('Feld prüfen >Kontaktformular');
    assert.equal(r.projectId, 'p2');
    assert.equal(r.target?.kind, 'task');
  });

  it('erkennt Markierung, Kategorie und Abhängigkeit', () => {
    const r = parse('Absturz %Bug &Player @nach:Nahkampf');
    assert.equal(r.mark?.id, 'k1');
    assert.equal(r.category?.id, 'c1');
    assert.equal(r.dep?.id, 't2');
    assert.equal(r.title, 'Absturz');
  });

  it('nimmt ein führendes Emoji als Markierung', () => {
    const r = parse('🐞 Spieler fällt durch den Boden');
    assert.equal(r.mark?.id, 'k1');
    assert.equal(r.title, 'Spieler fällt durch den Boden');
  });

  it('baut daraus die Eingabe für die API', () => {
    const r = parse('Kombo #code !2 >"Vertical Slice" %Bug @nach:Nahkampf');
    assert.deepEqual(quickAddInput(r), {
      projectId: 'p1',
      title: 'Kombo',
      milestoneId: 'm1',
      prio: 2,
      markId: 'k1',
      tags: ['code'],
      deps: ['t2'],
    });
    // Ohne Angaben bleibt die Eingabe schlank.
    assert.deepEqual(quickAddInput(parse('Nur ein Titel')), {
      projectId: 'p1',
      title: 'Nur ein Titel',
    });
  });
});
