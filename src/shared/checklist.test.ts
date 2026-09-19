import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checklist, toggleChecklistItem } from './checklist.js';

describe('Checklisten in Markdown', () => {
  it('erkennt die üblichen Schreibweisen', () => {
    assert.deepEqual(checklist('- [ ] a\n* [x] b\n+ [X] c\n1. [ ] d\n2) [x] e'), {
      total: 5,
      done: 3,
    });
  });

  it('ignoriert Zeilen in Code-Blöcken', () => {
    const text = ['- [x] echt', '```', '- [ ] nur Beispiel', '```', '- [ ] echt'].join('\n');
    assert.deepEqual(checklist(text), { total: 2, done: 1 });
  });

  it('kommt mit ~~~ als Zaun zurecht', () => {
    const text = ['~~~', '- [ ] drin', '~~~', '- [x] draußen'].join('\n');
    assert.deepEqual(checklist(text), { total: 1, done: 1 });
  });

  it('zählt Fließtext mit Klammern nicht mit', () => {
    assert.deepEqual(checklist('Das ist [ ] kein Punkt\nund - kein [x] Punkt'), {
      total: 0,
      done: 0,
    });
  });

  it('leere und fehlende Beschreibung ergeben null Punkte', () => {
    assert.deepEqual(checklist(''), { total: 0, done: 0 });
    assert.deepEqual(checklist(null), { total: 0, done: 0 });
  });

  it('schaltet den n-ten Punkt um und lässt den Rest in Ruhe', () => {
    const text = '# Titel\n- [ ] a\n- [x] b';
    assert.equal(toggleChecklistItem(text, 0), '# Titel\n- [x] a\n- [x] b');
    assert.equal(toggleChecklistItem(text, 1), '# Titel\n- [ ] a\n- [ ] b');
    assert.equal(toggleChecklistItem(text, 9), text);
  });

  it('behält die Einrückung beim Umschalten', () => {
    assert.equal(toggleChecklistItem('  - [ ] tief', 0), '  - [x] tief');
  });
});
