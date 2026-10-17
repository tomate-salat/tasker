import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { implicitStatus, parentStatusAfter } from './parentStatus.js';
import { Builder } from './testing.js';
import type { Task } from './model.js';

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

  it('„Bereit“ zählt wie Offen als noch nicht angefangen', () => {
    assert.equal(parentStatusAfter('ready', 'progress', ['progress', 'open']), 'progress');
    // Ein offenes Kind ändert am bereiten Elternteil nichts – das zeigt die Anzeige.
    assert.equal(parentStatusAfter('ready', 'open', ['open', 'ready']), null);
    assert.equal(parentStatusAfter('open', 'ready', ['ready', 'ready']), null);
  });

  it('fällt alles zurück, ist die Eltern-Aufgabe bereit, wenn alle Kinder es sind', () => {
    assert.equal(parentStatusAfter('progress', 'ready', ['ready', 'ready']), 'ready');
    assert.equal(parentStatusAfter('progress', 'ready', ['ready', 'open']), 'open');
    assert.equal(parentStatusAfter('done', 'ready', ['ready']), 'ready');
  });
});

describe('Status, den ein Task von seinen Unteraufgaben erbt', () => {
  const build = (parent: Partial<Task>, ...kids: Partial<Task>[]) => {
    const b = new Builder().project('p1').task('t', 'p1', parent);
    kids.forEach((k, i) => b.task(`k${i}`, 'p1', { parentId: k.parentId ?? 't', ...k }));
    const ws = b.build();
    return implicitStatus(ws, ws.task('t')!);
  };

  it('eine unklare Unteraufgabe macht den offenen Task unklar', () => {
    assert.equal(build({}, { status: 'unclear' }, {}), 'unclear');
  });

  it('auch tiefer verschachtelt', () => {
    assert.equal(build({}, {}, { parentId: 'k0', status: 'blocked' }), 'blocked');
  });

  it('blockiert gewinnt vor unklar', () => {
    assert.equal(build({}, { status: 'unclear' }, { status: 'blocked' }), 'blocked');
  });

  it('gilt auch für einen Task in Arbeit', () => {
    assert.equal(build({ status: 'progress' }, { status: 'unclear' }), 'unclear');
  });

  it('erledigte, blockierte und unklare Tasks behalten ihren eigenen Status', () => {
    assert.equal(build({ status: 'done' }, { status: 'blocked' }), null);
    assert.equal(build({ status: 'unclear' }, { status: 'blocked' }), null);
    assert.equal(build({ status: 'blocked' }, { status: 'unclear' }), null);
  });

  it('archivierte Unteraufgaben zählen nicht', () => {
    assert.equal(build({}, { status: 'blocked', archivedAt: '2026-01-01T00:00:00Z' }), null);
  });

  it('ein offener Task, unter dem gearbeitet wird, erscheint in Arbeit', () => {
    assert.equal(build({}, { status: 'progress' }), 'progress');
    assert.equal(build({ status: 'progress' }, { status: 'progress' }), null);
  });

  it('ein bereiter Task mit einer offenen Unteraufgabe erscheint offen', () => {
    assert.equal(build({ status: 'ready' }, { status: 'ready' }, { parentId: 'k0' }), 'open');
    assert.equal(build({ status: 'ready' }, { status: 'ready' }), null);
    // Unklar gewinnt vor offen.
    assert.equal(build({ status: 'ready' }, {}, { status: 'unclear' }), 'unclear');
    // Ein offener Task mit offenen Kindern zeigt einfach seinen eigenen Status.
    assert.equal(build({}, {}), null);
  });
});
