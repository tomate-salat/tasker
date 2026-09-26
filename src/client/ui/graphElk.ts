/**
 * „Neu anordnen“ im Abhängigkeits-Board: ELK (Eclipse Layout Kernel), Verfahren
 * „layered“. Es legt die Knoten in Stufen von links nach rechts, sortiert sie
 * so, dass sich möglichst wenige Pfeile kreuzen, und führt jeden Pfeil
 * rechtwinklig auf einer eigenen Bahn – Pfeile aus derselben Karte teilen sich
 * einen Stamm, andere laufen nicht aufeinander.
 *
 * Jeder Knoten hat genau einen Anschluss links (was er benötigt) und einen
 * rechts (was auf ihn wartet), jeweils mittig – wie die Punkte der Karten.
 */
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js';
import type { Pos } from '@shared/graphLayout.js';

export type Sized = { id: string; width: number; height: number };
export type Layout = { nodes: Record<string, Pos>; edges: Record<string, Pos[]> };

export const edgeKey = (source: string, target: string): string => `${source}>${target}`;

const elk = new ELK();

const OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  // Möglichst gerade Pfeile statt kompakter Stapel.
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  // Bei gleicher Güte bleibt die bisherige Reihenfolge – ein zweites
  // „Neu anordnen“ wirft nicht alles durcheinander.
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.spacing.nodeNodeBetweenLayers': '100',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
  'elk.spacing.nodeNode': '40',
  'elk.spacing.edgeEdge': '16',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.componentComponent': '80',
};

export async function elkLayout(
  nodes: Sized[],
  links: { source: string; target: string }[],
): Promise<Layout> {
  const ids = new Set(nodes.map((n) => n.id));
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: OPTIONS,
    children: nodes.map((n) => ({
      id: n.id,
      width: n.width,
      height: n.height,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        { id: `${n.id}:in`, x: 0, y: n.height / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'WEST' } },
        { id: `${n.id}:out`, x: n.width, y: n.height / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': 'EAST' } },
      ],
    })),
    edges: links
      .filter((l) => ids.has(l.source) && ids.has(l.target))
      .map((l) => ({ id: edgeKey(l.source, l.target), sources: [`${l.source}:out`], targets: [`${l.target}:in`] })),
  };
  const res = await elk.layout(graph);

  const out: Layout = { nodes: {}, edges: {} };
  for (const c of res.children ?? []) out.nodes[c.id] = { x: Math.round(c.x ?? 0), y: Math.round(c.y ?? 0) };
  for (const e of (res.edges ?? []) as ElkExtendedEdge[]) {
    const s = e.sections?.[0];
    if (!s) continue;
    out.edges[e.id] = [s.startPoint, ...(s.bendPoints ?? []), s.endPoint].map((p) => ({
      x: Math.round(p.x),
      y: Math.round(p.y),
    }));
  }
  return out;
}

/**
 * Ein rechtwinkliger Linienzug mit abgerundeten Ecken als SVG-Pfad. Die Enden
 * kommen von React Flow (die echten Anschlusspunkte), die Knicke von ELK; das
 * erste und letzte Teilstück bleiben dabei waagerecht.
 */
export function roundedPath(points: Pos[], radius = 8): string {
  if (points.length < 2) return '';
  let d = `M ${points[0]!.x} ${points[0]!.y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [a, b, c] = [points[i - 1]!, points[i]!, points[i + 1]!];
    const r = Math.min(radius, dist(a, b) / 2, dist(b, c) / 2);
    const p1 = toward(b, a, r);
    const p2 = toward(b, c, r);
    d += ` L ${p1.x} ${p1.y} Q ${b.x} ${b.y} ${p2.x} ${p2.y}`;
  }
  const last = points[points.length - 1]!;
  return `${d} L ${last.x} ${last.y}`;
}

const dist = (a: Pos, b: Pos): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Der Punkt, der `r` weit von `from` in Richtung `to` liegt. */
const toward = (from: Pos, to: Pos, r: number): Pos => {
  const l = dist(from, to) || 1;
  return { x: from.x + ((to.x - from.x) / l) * r, y: from.y + ((to.y - from.y) / l) * r };
};

/** Die ELK-Knicke zwischen die echten Enden setzen – waagerecht an beiden Enden. */
export function fitRoute(route: Pos[], source: Pos, target: Pos): Pos[] {
  const bends = route.slice(1, -1).map((p) => ({ ...p }));
  if (bends.length) {
    bends[0]!.y = source.y;
    bends[bends.length - 1]!.y = target.y;
  }
  return [source, ...bends, target];
}
