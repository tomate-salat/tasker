/**
 * Ordnet Knoten eines Abhängigkeitsgraphen in Spalten an: links, was nichts
 * braucht, rechts davon, was darauf wartet – je Spalte eine Stufe tiefer.
 * Innerhalb einer Spalte rückt ein Knoten in die Nähe dessen, was er braucht,
 * damit sich die Pfeile möglichst wenig kreuzen.
 *
 * Kreise kommen in den Daten nicht vor (das Setzen verhindert sie), sollen
 * die Anordnung aber auch nicht hängen lassen.
 */
export type Pos = { x: number; y: number };

export const COL_GAP = 280;
export const ROW_GAP = 84;

export function layerLayout(
  ids: string[],
  edges: { source: string; target: string }[],
): Record<string, Pos> {
  const inSet = new Set(ids);
  const preds = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of edges) {
    if (inSet.has(e.source) && inSet.has(e.target)) preds.get(e.target)!.push(e.source);
  }

  const rank = new Map<string, number>();
  const visiting = new Set<string>();
  const rankOf = (id: string): number => {
    const known = rank.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const r = Math.max(-1, ...preds.get(id)!.map(rankOf)) + 1;
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  ids.forEach(rankOf);

  const columns: string[][] = [];
  for (const id of ids) (columns[rank.get(id)!] ??= []).push(id);

  const row = new Map<string, number>();
  const out: Record<string, Pos> = {};
  columns.forEach((col, c) => {
    // Nach dem Mittel der Zeilen dessen, was gebraucht wird; sonst wie gegeben.
    const center = (id: string): number => {
      const ys = preds.get(id)!.map((p) => row.get(p)).filter((y): y is number => y !== undefined);
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Infinity;
    };
    const sorted = col
      .map((id, i) => ({ id, i, c: center(id) }))
      .sort((a, b) => a.c - b.c || a.i - b.i);
    sorted.forEach(({ id }, r) => {
      row.set(id, r);
      out[id] = { x: c * COL_GAP, y: r * ROW_GAP };
    });
  });
  return out;
}

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
