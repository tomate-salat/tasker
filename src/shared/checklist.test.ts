import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checklist,
  convertibleItems,
  convertibleSections,
  headingSections,
  replaceItems,
  toggleChecklistItem,
} from './checklist.js';

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

  describe('Überschriften', () => {
    const text = [
      'Vorweg',
      '',
      '### Implementation',
      '- [ ] Implement Weight-Based Probability Calculation',
      '',
      '### Apply',
      '- [ ] Magazines: High',
      '#### Details',
      'mehr',
      '',
      '## Danach',
      'Ende',
    ].join('\n');

    it('nimmt alles bis zur nächsten gleichen oder höheren Überschrift mit', () => {
      assert.deepEqual(
        headingSections(text).map((h) => [h.n, h.level, h.title, h.desc]),
        [
          [0, 3, 'Implementation', '- [ ] Implement Weight-Based Probability Calculation'],
          [1, 3, 'Apply', '- [ ] Magazines: High\n#### Details\nmehr'],
          [2, 4, 'Details', 'mehr'],
          [3, 2, 'Danach', 'Ende'],
        ],
      );
    });

    it('ersetzt den Abschnitt durch einen Verweis und lässt die Leerzeile stehen', () => {
      const made = convertibleSections(text, [0, 1]).map((item, i) => ({ item, ref: 5 + i }));
      assert.equal(replaceItems(text, made), 'Vorweg\n\n- $5\n\n- $6\n\n## Danach\nEnde');
    });

    it('eine tiefere Überschrift geht mit der gewählten höheren', () => {
      assert.deepEqual(convertibleSections(text, [1, 2]).map((h) => h.title), ['Apply']);
    });

    it('zählt Überschriften in Code-Blöcken und ohne Text nicht', () => {
      const code = '```\n# nur Beispiel\n```\n#\n# echt ##\n#kein';
      assert.deepEqual(headingSections(code).map((h) => h.title), ['', 'echt']);
      assert.deepEqual(convertibleSections(code, [0, 1]).map((h) => h.title), ['echt']);
    });
  });

  it('hält Code-Blöcke im Punkt zusammen', () => {
    const text = '- [ ] a\n  ```\nnicht eingerückt\n  ```\n- [ ] b';
    assert.deepEqual(convertibleItems(text).map((i) => [i.title, i.desc]), [
      ['a', '```\nnicht eingerückt\n```'],
      ['b', ''],
    ]);
  });
});
