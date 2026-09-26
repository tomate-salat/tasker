import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ligatureAt } from './ligatures.js';

/** Text mit `|` als Schreibmarke → Ergebnis im selben Format, `null` ohne Ersetzung. */
function run(src: string): string | null {
  const caret = src.indexOf('|');
  const value = src.slice(0, caret) + src.slice(caret + 1);
  const edit = ligatureAt(value, caret);
  if (!edit) return null;
  const out = value.slice(0, edit.from) + edit.text + value.slice(edit.to);
  return `${out.slice(0, edit.selStart)}|${out.slice(edit.selStart)}`;
}

describe('ligatureAt', () => {
  it('ersetzt Pfeile', () => {
    assert.equal(run('a ->| b'), 'a →| b');
    assert.equal(run('a <-|'), 'a ←|');
    assert.equal(run('a =>|'), 'a ⇒|');
    assert.equal(run('a <=>|'), 'a ⇔|');
  });

  it('macht aus ← und > einen Doppelpfeil', () => {
    assert.equal(run('a ←>|'), 'a ↔|');
  });

  it('ersetzt drei Punkte', () => {
    assert.equal(run('und dann...|'), 'und dann…|');
  });

  it('setzt den Gedankenstrich erst mit dem Leerzeichen', () => {
    assert.equal(run('a --|'), null);
    assert.equal(run('a -- |'), 'a – |');
    assert.equal(run('---|'), null);
    assert.equal(run('-- |'), null);
  });

  it('lässt Code in Ruhe', () => {
    assert.equal(run('`a ->|'), null);
    assert.equal(run('`a` ->|'), '`a` →|');
    assert.equal(run('```\nx ->|'), null);
    assert.equal(run('```\nx\n```\ny ->|'), '```\nx\n```\ny →|');
  });

  it('ersetzt nur, was direkt vor der Schreibmarke steht', () => {
    assert.equal(run('a -> b|'), null);
  });
});
