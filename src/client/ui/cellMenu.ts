import { effectiveTags, projectTags } from '@shared/inherit.js';
import type { Prio } from '@shared/model.js';
import { useStore } from '../store.js';
import { bulkCellMenu } from './BulkBar.js';
import { PRIO_LABEL } from './icons.js';
import type { MenuItem } from './Menu.js';
import { categorySub, markSub } from './rowMenu.js';

export type CellKind = 'mark' | 'prio' | 'cat' | 'tags';

/**
 * Das Menü hinter einer Zelle der Liste – `openCell` im Prototyp. Gehört die
 * Zeile zu einer Mehrfachauswahl, gilt es für alle ausgewählten Aufgaben.
 *
 * Zurück kommt eine Funktion: das Menü liest bei jedem Neuaufbau den aktuellen
 * Stand, damit die Häkchen im offen bleibenden Label-Menü mitwandern.
 */
export function cellMenu(kind: CellKind, id: string): () => MenuItem[] {
  return () => {
    const { ws, multi } = useStore.getState();
    const t = ws?.task(id);
    if (!ws || !t) return [];
    if (multi.size > 1 && multi.has(id)) return bulkCellMenu(ws, kind);

    if (kind === 'prio') return prioItems(id, t.prio);
    if (kind === 'mark') return markSub(ws, t);
    if (kind === 'cat') return categorySub(ws, t);
    return labelItems(id);
  };
}

const prioItems = (id: string, current: Prio): MenuItem[] =>
  ([0, 1, 2, 3] as const).map((v) => ({
    label: v ? `P${v} · ${PRIO_LABEL[v]}` : 'Keine',
    check: current === v,
    onSelect: () => void useStore.getState().patch('task', id, { prio: v }),
  }));

/** Labels umschalten, ohne dass sich das Menü schließt; ein neues gleich im Feld darunter. */
function labelItems(id: string): MenuItem[] {
  const ws = useStore.getState().ws;
  const t = ws?.task(id);
  if (!ws || !t) return [];
  const all = projectTags(ws, [t.projectId]);
  const extra = effectiveTags(ws, t).extra;

  return [
    ...(extra.length
      ? [{ head: `Aus Unteraufgaben: ${extra.map((x) => `#${x.tag}`).join(' ')}` }]
      : []),
    ...(all.length
      ? all.map((g) => ({
          label: `#${g}`,
          keep: true,
          check: t.tags.includes(g),
          onSelect: () => {
            // Den Stand erst beim Klick lesen – das Menü kann schon länger offen sein.
            const cur = useStore.getState().ws?.task(id);
            if (!cur) return;
            const tags = cur.tags.includes(g) ? cur.tags.filter((x) => x !== g) : [...cur.tags, g];
            void useStore.getState().patch('task', id, { tags });
          },
        }))
      : [{ label: 'Noch keine Labels', disabled: true }]),
    { sep: true },
    {
      input: 'Neues Label …',
      onSubmit: (value) => {
        const tag = value.replace(/^#+/, '').trim();
        const cur = useStore.getState().ws?.task(id);
        if (!tag || !cur || cur.tags.includes(tag)) return;
        void useStore.getState().patch('task', id, { tags: [...cur.tags, tag] });
      },
    },
  ];
}
