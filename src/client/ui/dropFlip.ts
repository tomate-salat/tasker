import { useLayoutEffect } from 'react';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';

/**
 * Nach dem Ablegen gleiten Karten und Zeilen an ihren neuen Platz, statt hart
 * umzuspringen (Wunsch des Nutzers) – so sieht man, dass und wohin sich etwas
 * bewegt hat. Gilt für die Karten- wie für die Listenansicht.
 *
 * Das übliche FLIP: Beim Ablegen merkt sich `snapshotDrop` die Lage jedes
 * Eintrags, eine gezogene Karte dort, wo ihre Kopie losgelassen wurde. Kommt
 * danach der neue Stand (ein anderer `ws`), versetzt `useDropFlip` jeden
 * Eintrag zurück an seine alte Lage und lässt ihn von dort an die neue laufen.
 *
 * Bei Karten wird die Zelle um die Karte bewegt, nicht die Karte selbst – deren
 * `transform` gehört dem Ausweichen beim Ziehen. Der Baum im Inspektor bleibt
 * außen vor: seine Zeilen tragen dieselben Kennungen wie die der Liste.
 */

const DURATION = 280;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
/** So lange nach dem Ablegen gilt ein neuer Stand noch als dessen Folge. */
const WINDOW_MS = 3000;

const ITEMS = '.tcard-cell, .list:not(.hier) > .row[data-row]';

type Pending = { rects: Map<string, DOMRect>; ws: Workspace | null; until: number };
let pending: Pending | null = null;

const idOf = (el: HTMLElement): string | null =>
  el.classList.contains('tcard-cell')
    ? (el.querySelector<HTMLElement>(':scope > .tcard[data-row]')?.dataset['row'] ?? null)
    : (el.dataset['row'] ?? null);

const items = (root: ParentNode): { el: HTMLElement; id: string }[] =>
  [...root.querySelectorAll<HTMLElement>(ITEMS)]
    .map((el) => ({ el, id: idOf(el) as string }))
    .filter((x) => x.id);

/** Beim Ablegen aufrufen, bevor der Ziehzustand zurückgesetzt wird. */
export function snapshotDrop(draggedIds: string[]): void {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rects = new Map<string, DOMRect>();
  for (const { el, id } of items(document)) rects.set(id, el.getBoundingClientRect());
  if (!rects.size) return;
  // Eine gezogene Karte startet dort, wo man sie losgelassen hat. Die Kopie hat
  // kein Polster wie die Zelle – das gleicht der Versatz aus. In der Liste
  // zeigt der Browser sein eigenes Ziehbild; die Zeile startet an ihrem Platz.
  const ghost = document.querySelector<HTMLElement>('.tcard-ghost');
  const first = draggedIds[0];
  const from = first ? rects.get(first) : undefined;
  if (ghost && first && from) {
    const g = ghost.getBoundingClientRect();
    const pad = (from.width - ghost.offsetWidth) / 2;
    rects.set(first, new DOMRect(g.left - pad, g.top - pad, from.width, from.height));
  }
  pending = { rects, ws: useStore.getState().ws, until: performance.now() + WINDOW_MS };
}

/**
 * Am Container der Liste: nach einem neuen Stand die Einträge gleiten lassen.
 * Ein Stand kann in Schritten kommen (erst das Ereignis vom Server, dann das
 * Nachladen) – jeder Schritt läuft von der Lage des vorigen aus.
 */
export function useDropFlip(ref: React.RefObject<HTMLElement | null>, ws: Workspace): void {
  useLayoutEffect(() => {
    const p = pending;
    const root = ref.current;
    if (!p || !root) return;
    if (performance.now() > p.until) {
      pending = null;
      return;
    }
    if (p.ws === ws) return;
    p.ws = ws;

    const now = items(root).map(({ el, id }) => {
      for (const a of el.getAnimations()) a.cancel();
      el.style.zIndex = '';
      return { el, id, rect: el.getBoundingClientRect() };
    });
    for (const { el, id, rect } of now) {
      const old = p.rects.get(id);
      p.rects.set(id, rect);
      if (!old) continue;
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Wer weit reist, liegt obenauf – sonst gleitet er unter den Nachbarn durch.
      el.style.zIndex = String(5 + Math.round((Math.abs(dx) + Math.abs(dy)) / 50));
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: DURATION,
        easing: EASING,
      }).onfinish = () => {
        el.style.zIndex = '';
      };
    }
  });
}
