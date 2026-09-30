import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakInItem, enterInList, moveLines, tabInList, type TextEdit } from './listEdit.js';

/** Text mit `|` als Schreibmarke (oder zwei `|` als Auswahl) → Ergebnis im selben Format. */
function run(src: string, f: (v: string, s: number, e: number) => TextEdit | null): string | null {
  const s = src.indexOf('|');
  const rest = src.slice(0, s) + src.slice(s + 1);
  const e2 = rest.indexOf('|');
  const value = e2 < 0 ? rest : rest.slice(0, e2) + rest.slice(e2 + 1);
  const e = e2 < 0 ? s : e2;
  const edit = f(value, s, e);
  if (!edit) return null;
  const out = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  return edit.selStart === edit.selEnd
    ? `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart)}`
    : `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart, edit.selEnd)}|${out.slice(edit.selEnd)}`;
}

const enter = (src: string) => run(src, enterInList);
const tab = (src: string) => run(src, (v, s, e) => tabInList(v, s, e, 1));
const untab = (src: string) => run(src, (v, s, e) => tabInList(v, s, e, -1));

describe('Enter in Listen', () => {
  it('setzt eine Checkliste mit leerer Checkbox fort', () => {
    assert.equal(enter('- [ ] Abc|'), '- [ ] Abc\n- [ ] |');
    assert.equal(enter('- [x] Erledigt|'), '- [x] Erledigt\n- [ ] |');
  });

  it('setzt Aufzählungen und nummerierte Listen fort', () => {
    assert.equal(enter('- Abc|'), '- Abc\n- |');
    assert.equal(enter('* Abc|'), '* Abc\n* |');
    assert.equal(enter('1. Abc|'), '1. Abc\n2. |');
    assert.equal(enter('9) Abc|'), '9) Abc\n10) |');
  });

  it('behält die Einrückung und nimmt Text hinter der Marke mit', () => {
    assert.equal(enter('- a\n  - b|'), '- a\n  - b\n  - |');
    assert.equal(enter('- Ab|c'), '- Ab\n- |c');
  });

  it('beendet die Liste in einem leeren Punkt', () => {
    assert.equal(enter('- a\n- |'), '- a\n|');
    assert.equal(enter('- [ ] a\n- [ ] |'), '- [ ] a\n|');
  });

  it('geht in einem leeren eingerückten Punkt eine Ebene hinauf', () => {
    assert.equal(enter('- a\n  - |'), '- a\n- |');
  });

  it('lässt normalen Text und Stellen vor der Marke in Ruhe', () => {
    assert.equal(enter('Abc|'), null);
    assert.equal(enter('-Abc|'), null);
    assert.equal(enter('|- Abc'), null);
    assert.equal(enter('- a|b|c'), null);
  });
});

describe('Tab in Listen', () => {
  it('rückt unter den Punkt darüber ein und wieder aus', () => {
    assert.equal(tab('- a\n- b|'), '- a\n  - b|');
    assert.equal(untab('- a\n  - b|'), '- a\n- b|');
  });

  it('rückt unter nummerierte Punkte so weit ein, wie deren Inhalt steht, und zählt neu', () => {
    assert.equal(tab('1. a\n2. b|'), '1. a\n   1. b|');
    assert.equal(untab('1. a\n   1. b|'), '1. a\n2. b|');
  });

  it('rückt alle markierten Listenpunkte ein', () => {
    assert.equal(tab('- a\n- |b\n- c|'), '- a\n  - |b\n  - c|');
  });

  it('macht außerhalb von Listen nichts', () => {
    assert.equal(tab('Abc|'), null);
    assert.equal(untab('- a|'), null);
  });

  it('behält die Checkbox', () => {
    assert.equal(tab('- [ ] a\n- [ ] b|'), '- [ ] a\n  - [ ] b|');
  });
});

const up = (src: string) => run(src, (v, s, e) => moveLines(v, s, e, -1));
const down = (src: string) => run(src, (v, s, e) => moveLines(v, s, e, 1));

describe('Zeilen verschieben', () => {
  it('tauscht die Zeile mit der darüber und nimmt die Schreibmarke mit', () => {
    assert.equal(up('- [ ] Repair\n- [ ] De|stroy'), '- [ ] De|stroy\n- [ ] Repair');
  });

  it('tauscht die Zeile mit der darunter', () => {
    assert.equal(down('- [ ] Re|pair\n- [ ] Destroy'), '- [ ] Destroy\n- [ ] Re|pair');
  });

  it('bleibt am Rand stehen', () => {
    assert.equal(up('- [ ] Re|pair\n- [ ] Destroy'), null);
    assert.equal(down('- [ ] Repair\n- [ ] De|stroy'), null);
  });

  it('nimmt eine Markierung über mehrere Zeilen als Block mit', () => {
    assert.equal(down('a\n|b\nc|\nd'), 'a\nd\n|b\nc|');
    assert.equal(up('a\n|b\nc|\nd'), '|b\nc|\na\nd');
  });

  it('kümmert sich nicht darum, was in der Zeile steht', () => {
    assert.equal(down('-----\nText|'), null);
    assert.equal(up('-----\nTe|xt'), 'Te|xt\n-----');
  });

  it('kommt mit leeren Zeilen zurecht', () => {
    assert.equal(up('a\n\nb|'), 'a\nb|\n');
    assert.equal(down('|\na'), 'a\n|');
  });
});

describe('Umschalt+Enter in Listen', () => {
  const brk = (src: string) => run(src, breakInItem);

  it('rückt die neue Zeile unter den Inhalt des Punktes', () => {
    assert.equal(brk('- [ ] test|'), '- [ ] test\n  |');
    assert.equal(brk('- abc|'), '- abc\n  |');
    assert.equal(brk('1. abc|'), '1. abc\n   |');
    assert.equal(brk('- a\n  - b|'), '- a\n  - b\n    |');
  });

  it('behält in einer Folgezeile deren Einrückung', () => {
    assert.equal(brk('- [ ] test\n  abc|'), '- [ ] test\n  abc\n  |');
    assert.equal(brk('- [ ] test\n    abc\n\n    def|'), '- [ ] test\n    abc\n\n    def\n    |');
    assert.equal(brk('- [ ] test\n  |'), '- [ ] test\n  \n  |');
  });

  it('nimmt den Text hinter der Schreibmarke mit', () => {
    assert.equal(brk('- abc|def'), '- abc\n  |def');
  });

  it('lässt normalen Text in Ruhe', () => {
    assert.equal(brk('Abc|'), null);
    assert.equal(brk('  eingerückt|'), null);
    assert.equal(brk('|- abc'), null);
    assert.equal(brk('Absatz\n  abc|'), null);
  });
});
