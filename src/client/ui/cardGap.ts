import { create } from 'zustand';
import type { OutlineView } from '@shared/outline.js';
import { useStore } from '../store.js';
import { draggedCard } from './cardTilt.js';
import { dropTarget, useDrag, type Zone } from './dnd.js';
import { onBeforeFlip } from './dropFlip.js';

/**
 * Karten: beim Sortieren rücken die Karten eines Rasters auseinander und lassen
 * eine Lücke in Kartengröße, in der die gezogene Karte landet – wie auf dem
 * Tisch (Wunsch des Nutzers, vorerst in Plan und Ready). Anders als dort lässt
 * sich eine Karte hier auch **auf** eine andere legen (sie wird Unteraufgabe),
 * und beides muss nebeneinander gehen.
 *
 * Maßgeblich ist die Mitte der gezogenen Karte, nicht der Zeiger:
 * - über der Mitte einer Karte: „hinein“, die Karte leuchtet auf;
 * - nahe ihrem linken oder rechten Rand: dort öffnet sich die Lücke;
 * - über der Lücke selbst und an den Rändern ihrer beiden Nachbarn: sie bleibt.
 *
 * Die Lücke wandert also nur, wenn die Karte an einem anderen Rand ankommt –
 * nicht schon, wenn sie eine Nachbarkarte berührt. Sonst wiche jede Karte aus,
 * auf die man etwas legen will. Gerechnet wird gegen das Raster mit der Lücke
 * als festem Platz, nicht gegen die Karten, wie sie gerade im Übergang stehen.
 *
 * Auch welches Raster gemeint ist, entscheidet die Kartenmitte: wer eine Karte
 * am linken Rand greift, hat den Zeiger schon neben dem Raster, wenn sie über
 * dem ersten Platz liegt. Deshalb hört diese Datei während des Ziehens am
 * Dokument mit, noch vor den Ablagezielen, statt an den Rastern selbst.
 *
 * Abgelegt wird weiter über `dnd.ts`: die Lücke übersetzt sich in „vor“ oder
 * „nach“ einer Karte. Hier steht nur, wo – und das Auseinanderrücken.
 */

/** Wo die Lücke gilt. */
export const gapView = (view: OutlineView): boolean => view === 'plan' || view === 'ready';

/** So breit ist der Rand einer Karte, an dem „davor/danach“ gilt – wie bisher in `dnd.ts`. */
const EDGE = 0.28;

type Land = { x: number; y: number; w: number; h: number };

/** Das Raster mit der Lücke und der Landeplatz darin – für die Anzeige. */
export const useCardGap = create<{ grid: HTMLElement | null; land: Land | null }>(() => ({
  grid: null,
  land: null,
}));

/** Das Raster, über dem gerade gezogen wird; `at`: die Lücke, gezählt unter den übrigen Karten. */
let cur: { grid: HTMLElement; at: number | null } | null = null;
/** Nach dem Ablegen bleibt die Lücke, bis der neue Stand da ist – sonst sprängen die Karten zurück. */
let held = false;
let watching = false;

const cellsOf = (grid: HTMLElement): HTMLElement[] => [...grid.querySelectorAll<HTMLElement>(':scope > .tcard-cell')];
const idOf = (cell: HTMLElement): string =>
  cell.querySelector<HTMLElement>(':scope > .tcard[data-row]')?.dataset['row'] ?? '';

/** Nimmt alles Auseinanderrücken sofort zurück, ohne Übergang. */
export function releaseCardGap(): void {
  held = false;
  cur = null;
  for (const cell of document.querySelectorAll<HTMLElement>('.tcard-cell[data-shift], .tcard-cell[data-lift]')) {
    cell.removeAttribute('data-shift');
    cell.removeAttribute('data-lift');
    cell.style.removeProperty('--shift-x');
    cell.style.removeProperty('--shift-y');
  }
  for (const grid of document.querySelectorAll<HTMLElement>('.card-grid[data-gap]')) {
    grid.removeAttribute('data-gap');
    grid.style.minHeight = '';
  }
  if (useCardGap.getState().grid) useCardGap.setState({ grid: null, land: null });
}

/**
 * Aus einem Raster heraus aufrufen, nicht beim Laden – `dnd.ts` und diese
 * Datei laden sich gegenseitig.
 */
export function watchCardGap(): void {
  if (watching) return;
  watching = true;
  useDrag.subscribe((s, prev) => {
    if (s.drag?.kind === 'task' && s.drag !== prev.drag) {
      releaseCardGap();
      document.addEventListener('dragover', over, true);
      document.addEventListener('drop', drop, true);
    }
    if (!s.drag && prev.drag) {
      document.removeEventListener('dragover', over, true);
      document.removeEventListener('drop', drop, true);
      if (!held) releaseCardGap();
    }
  });
  // Der neue Stand ist da: die Karten liegen jetzt wirklich, wo sie standen.
  onBeforeFlip(releaseCardGap);
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

function measure(grid: HTMLElement, cells: HTMLElement[]) {
  const style = getComputedStyle(grid);
  const box = grid.getBoundingClientRect();
  const padLeft = parseFloat(style.paddingLeft || '0');
  const padTop = parseFloat(style.paddingTop || '0');
  return {
    left: box.left + grid.clientLeft + padLeft,
    top: box.top + grid.clientTop + padTop,
    padLeft,
    padTop,
    padBottom: parseFloat(style.paddingBottom || '0'),
    w: cells[0]?.offsetWidth || 142,
    h: cells[0]?.offsetHeight || 190,
    cols: Math.max(1, style.gridTemplateColumns.split(' ').filter(Boolean).length),
  };
}

function setOver(next: { key: string; zone: Zone } | null): void {
  const now = useDrag.getState().over;
  if (now?.key !== next?.key || now?.zone !== next?.zone) useDrag.setState({ over: next });
}

/** Schließt die Lücke eines Rasters mit Übergang – die Karte ist weitergezogen. */
function close(grid: HTMLElement): void {
  for (const cell of cellsOf(grid)) {
    cell.removeAttribute('data-lift');
    if (!cell.hasAttribute('data-shift')) continue;
    cell.style.setProperty('--shift-x', '0');
    cell.style.setProperty('--shift-y', '0');
  }
  grid.style.minHeight = '';
  if (useCardGap.getState().grid === grid) useCardGap.setState({ grid: null, land: null });
}

const gridAt = (x: number, y: number): HTMLElement | null =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('.card-grid[data-gapgrid]') ?? null;

function over(e: DragEvent): void {
  const drag = useDrag.getState().drag;
  if (drag?.kind !== 'task') return;
  // Das Raster unter der Kartenmitte – sonst das unter dem Zeiger.
  const card = draggedCard(e) ?? { x: e.clientX, y: e.clientY, w: 128, h: 176 };
  const grid = gridAt(card.x, card.y) ?? gridAt(e.clientX, e.clientY);
  if (!grid) {
    // Weitergezogen: die Lücke schließt sich, das Ziel unter dem Zeiger ist dran.
    if (cur) {
      close(cur.grid);
      cur = null;
      setOver(null);
    }
    return;
  }
  const cells = cellsOf(grid);
  const dragged = (c: HTMLElement): boolean => drag.ids.includes(idOf(c));
  const others = cells.filter((c) => !dragged(c));
  const inside = cells.filter(dragged);

  // Die Schublade der gezogenen Karte selbst: dort hinein geht nichts.
  if (others.some((c) => drag.blocked.has(idOf(c)))) {
    if (cur) close(cur.grid);
    cur = null;
    e.stopPropagation();
    setOver(null);
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';

  const n = others.length;
  // Liegt die Karte selbst im Raster, ist ihr Platz die Lücke – sonst ist noch keine da.
  const home = inside[0] ? cells.slice(0, cells.indexOf(inside[0])).filter((c) => !dragged(c)).length : null;
  const width = Math.max(1, inside.length);
  if (cur?.grid !== grid) {
    if (cur) close(cur.grid);
    cur = { grid, at: home };
  }

  const g = measure(grid, cells);
  const col = clamp(Math.floor((card.x - g.left) / g.w), 0, g.cols - 1);
  const slot = Math.max(0, Math.floor((card.y - g.top) / g.h)) * g.cols + col;
  const edge = clamp((card.x - g.left) / g.w - col, 0, 1);
  const at = cur.at;
  const shown = n + (at === null ? 0 : width);

  let onto: HTMLElement | null = null;
  if (slot >= shown) {
    // Hinter der letzten Karte: ans Ende.
    cur.at = n;
  } else if (at === null || slot < at || slot >= at + width) {
    const k = at !== null && slot >= at + width ? slot - width : slot;
    // An dem Rand, der an die Lücke grenzt, bleibt sie, wo sie ist.
    if (edge < EDGE) {
      if (at === null || slot !== at + width) cur.at = k;
    } else if (edge > 1 - EDGE) {
      if (at === null || slot !== at - 1) cur.at = k + 1;
    } else onto = others[k] ?? null;
  }

  if (onto) setOver({ key: idOf(onto), zone: 'child' });
  // Am eigenen Platz abgelegt ändert sich nichts.
  else if (cur.at === null || cur.at === home) setOver(null);
  else {
    const next = others[cur.at];
    const last = others[n - 1];
    setOver(next ? { key: idOf(next), zone: 'before' } : last ? { key: idOf(last), zone: 'after' } : null);
  }

  // Die übrigen Karten nehmen alle Plätze außer der Lücke ein.
  const gap = cur.at;
  const place = (s: number) => ({ col: s % g.cols, line: Math.floor(s / g.cols) });
  let other = 0;
  cells.forEach((cell, index) => {
    if (dragged(cell)) {
      cell.setAttribute('data-lift', '');
      return;
    }
    const from = place(index);
    const to = place(gap === null || other < gap ? other : other + width);
    cell.setAttribute('data-shift', '');
    cell.style.setProperty('--shift-x', String(to.col - from.col));
    cell.style.setProperty('--shift-y', String(to.line - from.line));
    other++;
  });

  // Kommt die Karte von außen, braucht die Lücke womöglich eine Zeile mehr.
  grid.setAttribute('data-gap', '');
  const lines = Math.ceil((n + (gap === null ? 0 : width)) / g.cols);
  grid.style.minHeight =
    lines > Math.ceil(cells.length / g.cols) ? `${g.padTop + g.padBottom + lines * g.h}px` : '';

  const spot = gap === null || onto ? null : place(gap);
  const pad = (g.w - card.w) / 2;
  const land = spot && {
    x: g.padLeft + spot.col * g.w + pad,
    y: g.padTop + spot.line * g.h + pad,
    w: card.w,
    h: card.h,
  };
  const now = useCardGap.getState();
  if (now.grid !== grid || now.land?.x !== land?.x || now.land?.y !== land?.y || !now.land !== !land) {
    useCardGap.setState({ grid, land });
  }
}

function drop(e: DragEvent): void {
  const { drag, over: target } = useDrag.getState();
  if (drag?.kind !== 'task' || !cur) return;
  const task = target ? useStore.getState().ws?.task(target.key) : null;
  if (!task) {
    // Am eigenen Platz: nichts tun – aber auch nicht an das Ziel unter dem Zeiger durchreichen.
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  held = true;
  dropTarget({ type: 'task', task, card: true }).onDrop(e as unknown as React.DragEvent);
}
