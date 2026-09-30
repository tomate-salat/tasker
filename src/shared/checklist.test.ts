import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checklist, convertibleItems, replaceItems, toggleChecklistItem } from './checklist.js';

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

describe('Checkboxen zu Unteraufgaben', () => {
  const codecks = [
    'Quest Generator',
    '',
    '- [ ] test',
    '    abc',
    '    def',
    '      ',
    '    gehört noch zu test',
    '- [ ] test 2',
    '      ',
    '    abc',
    '      ',
    '    def',
    '    ',
    '    gehört zu test2',
    '',
    'Danach',
  ].join('\n');

  it('nimmt alles Eingerückte mit, auch über Leerzeilen', () => {
    const items = convertibleItems(codecks);
    assert.deepEqual(
      items.map((i) => [i.title, i.desc]),
      [
        ['test', 'abc\ndef\n\ngehört noch zu test'],
        ['test 2', 'abc\n\ndef\n\ngehört zu test2'],
      ],
    );
  });

  it('ersetzt die Punkte durch Verweise und lässt den Rest stehen', () => {
    const items = convertibleItems(codecks);
    const out = replaceItems(codecks, items.map((item, i) => ({ item, ref: 123 + i })));
    assert.equal(out, 'Quest Generator\n\n- $123\n- $124\n\nDanach');
  });

  it('nimmt eingerückte Checkboxen als Inhalt mit', () => {
    const text = '- [ ] a\n  - [ ] b\n  - [x] c\n- [ ] d';
    const items = convertibleItems(text);
    assert.deepEqual(
      items.map((i) => [i.n, i.title, i.desc]),
      [
        [0, 'a', '- [ ] b\n- [x] c'],
        [3, 'd', ''],
      ],
    );
  });

  it('lässt abgehakte Punkte samt Inhalt stehen', () => {
    const text = '- [x] fertig\n  - [ ] drin\n- [ ] offen';
    assert.deepEqual(convertibleItems(text).map((i) => i.title), ['offen']);
  });

  it('wandelt einzelne Punkte um, auch eingerückte', () => {
    const text = '- [ ] a\n  - [ ] b\n    mehr\n- [ ] c';
    const items = convertibleItems(text, [1]);
    assert.deepEqual(items.map((i) => [i.title, i.desc]), [['b', 'mehr']]);
    assert.equal(replaceItems(text, [{ item: items[0]!, ref: 7 }]), '- [ ] a\n  - $7\n- [ ] c');
  });

  it('behält das Listenzeichen und überspringt leere Punkte', () => {
    const text = '1. [ ] eins\n2. [ ] \n* [ ] drei';
    const items = convertibleItems(text);
    assert.deepEqual(items.map((i) => i.title), ['eins', 'drei']);
    assert.equal(
      replaceItems(text, items.map((item, i) => ({ item, ref: i + 1 }))),
      '1. $1\n2. [ ] \n* $2',
    );
  });

  it('hält Code-Blöcke im Punkt zusammen', () => {
    const text = '- [ ] a\n  ```\nnicht eingerückt\n  ```\n- [ ] b';
    assert.deepEqual(convertibleItems(text).map((i) => [i.title, i.desc]), [
      ['a', '```\nnicht eingerückt\n```'],
      ['b', ''],
    ]);
  });
});
