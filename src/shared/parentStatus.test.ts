import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parentStatusAfter } from './parentStatus.js';

describe('Status der Eltern-Aufgabe folgt den Unteraufgaben', () => {
  it('eine Unteraufgabe in Arbeit macht die offene Eltern-Aufgabe „In Progress“', () => {
    assert.equal(parentStatusAfter('open', 'progress', ['progress', 'open']), 'progress');
  });

  it('eine erledigte Unteraufgabe ebenso', () => {
    assert.equal(parentStatusAfter('open', 'done', ['done', 'open']), 'progress');
  });

  it('alle wieder offen: die Eltern-Aufgabe auch', () => {
    assert.equal(parentStatusAfter('progress', 'open', ['open', 'open']), 'open');
    assert.equal(parentStatusAfter('done', 'open', ['open']), 'open');
  });

  it('alle erledigt: die Eltern-Aufgabe bleibt in Arbeit', () => {
    assert.equal(parentStatusAfter('progress', 'done', ['done', 'done']), null);
  });

  it('eine wieder aufgemachte Unteraufgabe zieht die Eltern-Aufgabe aus „Erledigt“', () => {
    assert.equal(parentStatusAfter('done', 'progress', ['progress', 'done']), 'progress');
    assert.equal(parentStatusAfter('done', 'open', ['open', 'done']), 'progress');
  });

  it('eine erledigte Eltern-Aufgabe bleibt es, wenn noch eine Unteraufgabe fertig wird', () => {
    assert.equal(parentStatusAfter('done', 'done', ['done', 'done']), null);
  });

  it('„Unklar“ und „Blockiert“ bleiben stehen', () => {
    assert.equal(parentStatusAfter('unclear', 'progress', ['progress']), null);
    assert.equal(parentStatusAfter('blocked', 'open', ['open']), null);
  });
});
