import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { enterInList, tabInList, type TextEdit } from './listEdit.js';

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
