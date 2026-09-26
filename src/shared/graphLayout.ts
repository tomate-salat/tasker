/** Ein Punkt auf dem Abhängigkeits-Board. */
export type Pos = { x: number; y: number };

/**
 * Was zu einem Ausgangspunkt gehört: alles, was er – direkt oder über Umwege –
 * benötigt, und alles, was auf ihn wartet. Was nur über einen gemeinsamen
 * Vorgänger daneben hängt, gehört nicht dazu.
 */
export function dependencyScope(
  seeds: string[],
  edges: { source: string; target: string }[],
): Set<string> {
  const out = new Set(seeds);
  const walk = (from: 'source' | 'target', to: 'source' | 'target'): void => {
    const next = new Map<string, string[]>();
    for (const e of edges) {
      const list = next.get(e[from]) ?? [];
      list.push(e[to]);
      next.set(e[from], list);
    }
    const seen = new Set<string>(seeds);
    const queue = [...seeds];
    while (queue.length) {
      for (const id of next.get(queue.pop()!) ?? []) {
        if (seen.has(id)) continue;
        seen.add(id);
        out.add(id);
        queue.push(id);
      }
    }
  };
  walk('target', 'source'); // was benötigt wird
  walk('source', 'target'); // was darauf wartet
  return out;
}
