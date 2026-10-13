import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deepLinkPath } from './deeplink.js';

describe('Verweise von außen', () => {
  it('führen zu Projekt und Aufgabe, Groß- und Kleinschreibung der Kennungen bleibt', () => {
    assert.equal(deepLinkPath('web+tasker://pvjOOi4mDZrAy/tAt3hh6fRBQFY'), '/pvjOOi4mDZrAy/tAt3hh6fRBQFY');
    assert.equal(deepLinkPath('web+tasker://p_1-x/m3/'), '/p_1-x/m3');
    assert.equal(deepLinkPath('web+tasker:all/t1'), '/all/t1');
    assert.equal(deepLinkPath('WEB+TASKER://p1/t%5F1'), '/p1/t_1');
  });

  it('alles andere führt nirgends hin', () => {
    for (const link of [
      '',
      'web+tasker://p1',
      'web+tasker://p1/t1/mehr',
      'web+tasker://p1/t1?x=1',
      'web+tasker://p1/..',
      'web+tasker://p1/%2F%2Fboese.example',
      'web+tasker://p1/t1%',
      'https://boese.example/p1/t1',
      'javascript:alert(1)',
      '//boese.example/p1',
    ]) {
      assert.equal(deepLinkPath(link), null, link);
    }
  });
});
