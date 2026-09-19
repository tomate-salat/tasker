import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Envelope } from '../shared/events.js';
import { EventBus } from './events.js';

describe('Änderungs-Verteiler', () => {
  it('schickt an alle Zuhörer, nummeriert durch und nennt den Absender', () => {
    const bus = new EventBus();
    const a: Envelope[] = [];
    const b: Envelope[] = [];
    const stopA = bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.publish({ type: 'reload', reason: 'Test' }, 'tab-1');
    stopA();
    bus.publish({ type: 'reload', reason: 'Zweitens' }, null);

    assert.equal(a.length, 1, 'nach dem Abmelden kommt nichts mehr an');
    assert.equal(a[0]?.origin, 'tab-1');
    assert.deepEqual(
      b.map((e) => e.id),
      [1, 2],
    );
    assert.equal(bus.count, 1);
  });

  it('ein stolpernder Zuhörer reißt die anderen nicht mit', () => {
    // Sonst würde ein hängender Tab das Schreiben scheitern lassen.
    const bus = new EventBus();
    const seen: number[] = [];
    bus.subscribe(() => {
      throw new Error('kaputt');
    });
    bus.subscribe((e) => seen.push(e.id));

    bus.publish({ type: 'reload', reason: 'Test' });
    assert.deepEqual(seen, [1]);
  });
});
