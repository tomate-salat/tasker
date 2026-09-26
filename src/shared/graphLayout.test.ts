import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dependencyScope } from './graphLayout.js';

describe('Ausschnitt um einen Eintrag', () => {
  // a → b → c → d, x → c, b → y, z → w (unverbunden)
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'c' },
    { source: 'c', target: 'd' },
    { source: 'x', target: 'c' },
    { source: 'b', target: 'y' },
    { source: 'z', target: 'w' },
  ];

  it('nimmt Vorgänger und Nachfolger in jeder Tiefe mit', () => {
    assert.deepEqual([...dependencyScope(['b'], edges)].sort(), ['a', 'b', 'c', 'd', 'y']);
  });

  it('lässt aus, was nur über einen gemeinsamen Vorgänger daneben hängt', () => {
    const scope = dependencyScope(['c'], edges);
    assert.ok(scope.has('x') && scope.has('a'));
    assert.ok(!scope.has('y'), 'y wartet auf b, hat mit c aber nichts zu tun');
    assert.ok(!scope.has('w') && !scope.has('z'));
  });

  it('geht von mehreren Ausgangspunkten aus', () => {
    assert.deepEqual([...dependencyScope(['d', 'z'], edges)].sort(), ['a', 'b', 'c', 'd', 'w', 'x', 'z']);
  });
});
