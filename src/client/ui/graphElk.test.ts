import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { edgeKey, elkLayout, fitRoute, roundedPath } from './graphElk.js';

// Das Beispiel aus dem Quest-Milestone: ein Milestone ohne Pfeile, zwei
// Modelle links, darauf aufbauend UI, Generator, Controller und Board.
const W = 142;
const H = 176;
const ids = ['ms', 'questModel', 'boardModel', 'boardUi', 'generator', 'playerSupport', 'controller', 'questBoard'];
const links = [
  { source: 'questModel', target: 'boardUi' },
  { source: 'questModel', target: 'generator' },
  { source: 'questModel', target: 'playerSupport' },
  { source: 'boardModel', target: 'controller' },
  { source: 'boardUi', target: 'controller' },
  { source: 'generator', target: 'controller' },
  { source: 'generator', target: 'questBoard' },
];

describe('Anordnung mit ELK', async () => {
  const layout = await elkLayout(
    ids.map((id) => ({ id, width: W, height: H })),
    links,
  );

  it('setzt jeden Knoten, ohne dass sich zwei überdecken', () => {
    assert.equal(Object.keys(layout.nodes).length, ids.length);
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        const p = layout.nodes[a]!;
        const q = layout.nodes[b]!;
        const apart = p.x + W <= q.x || q.x + W <= p.x || p.y + H <= q.y || q.y + H <= p.y;
        assert.ok(apart, `${a} und ${b} überdecken sich`);
      }
    }
  });

  it('legt, was benötigt wird, links von dem, was darauf wartet', () => {
    for (const l of links) assert.ok(layout.nodes[l.source]!.x < layout.nodes[l.target]!.x, edgeKey(l.source, l.target));
  });

  it('führt jeden Pfeil von der Mitte rechts zur Mitte links', () => {
    for (const l of links) {
      const route = layout.edges[edgeKey(l.source, l.target)]!;
      const s = layout.nodes[l.source]!;
      const t = layout.nodes[l.target]!;
      assert.deepEqual(route[0], { x: s.x + W, y: s.y + H / 2 });
      assert.deepEqual(route[route.length - 1], { x: t.x, y: t.y + H / 2 });
    }
  });

  it('lässt Pfeile aus verschiedenen Karten nicht aufeinander laufen', () => {
    // Senkrechte Teilstücke: x, von y bis y, Quelle.
    const vertical: { x: number; y1: number; y2: number; source: string }[] = [];
    for (const l of links) {
      const r = layout.edges[edgeKey(l.source, l.target)]!;
      for (let i = 1; i < r.length; i++) {
        if (r[i - 1]!.x === r[i]!.x && r[i - 1]!.y !== r[i]!.y) {
          const [y1, y2] = [r[i - 1]!.y, r[i]!.y].sort((a, b) => a - b);
          vertical.push({ x: r[i]!.x, y1: y1!, y2: y2!, source: l.source });
        }
      }
    }
    for (const a of vertical) {
      for (const b of vertical) {
        if (a.source === b.source || a.x !== b.x) continue;
        const overlap = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1);
        assert.ok(overlap <= 0, `Pfeile aus ${a.source} und ${b.source} laufen bei x=${a.x} aufeinander`);
      }
    }
  });
});

describe('Pfeilverlauf', () => {
  it('bleibt an beiden Enden waagerecht, auch wenn die Karte etwas anders sitzt', () => {
    const route = [
      { x: 0, y: 50 },
      { x: 40, y: 50 },
      { x: 40, y: 150 },
      { x: 100, y: 150 },
    ];
    const fitted = fitRoute(route, { x: 0, y: 52 }, { x: 100, y: 149 });
    assert.deepEqual(fitted, [
      { x: 0, y: 52 },
      { x: 40, y: 52 },
      { x: 40, y: 149 },
      { x: 100, y: 149 },
    ]);
  });

  it('rundet die Ecken ab', () => {
    const d = roundedPath([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 100 },
    ]);
    assert.equal(d, 'M 0 0 L 32 0 Q 40 0 40 8 L 40 100');
  });
});
