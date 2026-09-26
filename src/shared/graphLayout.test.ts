import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { COL_GAP, dependencyScope, layerLayout } from './graphLayout.js';

describe('Anordnung des Abhängigkeitsgraphen', () => {
  it('setzt jede Stufe eine Spalte weiter nach rechts', () => {
    const pos = layerLayout(
      ['c', 'b', 'a'],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
      ],
    );
    assert.equal(pos['a']!.x, 0);
    assert.equal(pos['b']!.x, COL_GAP);
    assert.equal(pos['c']!.x, 2 * COL_GAP);
  });

  it('richtet sich nach der längsten Kette', () => {
    const pos = layerLayout(
      ['a', 'b', 'c'],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'c' },
        { source: 'a', target: 'c' },
      ],
    );
    assert.equal(pos['c']!.x, 2 * COL_GAP);
  });

  it('bleibt bei einem Kreis nicht hängen', () => {
    const pos = layerLayout(
      ['a', 'b'],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    );
    assert.equal(Object.keys(pos).length, 2);
  });

  it('übergeht Pfeile zu Knoten, die nicht dabei sind', () => {
    const pos = layerLayout(['a'], [{ source: 'x', target: 'a' }]);
    assert.deepEqual(pos['a'], { x: 0, y: 0 });
  });
});

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
