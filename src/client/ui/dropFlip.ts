import { useLayoutEffect } from 'react';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { holdGhost } from './cardTilt.js';

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

type Pending = {
  rects: Map<string, DOMRect>;
  ws: Workspace | null;
  until: number;
  /** Karten: die liegen gebliebene Kopie der gezogenen Karte und deren Kennung. */
  ghost: { el: HTMLElement; release: () => void; id: string } | null;
  /** Die echte gezogene Karte, unsichtbar, bis sie die Kopie ablöst. */
  hidden: HTMLElement | null;
};
let pending: Pending | null = null;

/** Die Kopie weg, die echte Karte wieder sichtbar. */
function settle(p: Pending): void {
  p.ghost?.release();
  p.ghost = null;
  if (p.hidden) p.hidden.style.visibility = '';
  p.hidden = null;
}

/** Wo die Zelle der gezogenen Karte stünde, läge sie unter der Kopie. */
function ghostRect(ghost: HTMLElement, cell: DOMRect): DOMRect {
  const g = ghost.getBoundingClientRect();
  // Die Kopie ist die Karte ohne das Polster der Zelle – und gekippt etwas
  // breiter; die Mitte bleibt verlässlich.
  const cx = g.left + g.width / 2;
  const cy = g.top + g.height / 2;
  return new DOMRect(cx - cell.width / 2, cy - cell.height / 2, cell.width, cell.height);
}

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
  if (pending) settle(pending);

  // Eine gezogene Karte: ihre Kopie bleibt liegen, wo man sie losgelassen hat,
  // und die echte Karte an ihrem alten Platz bleibt unsichtbar. Kommt der neue
  // Stand, startet die echte Karte genau unter der Kopie. In der Liste zeigt
  // der Browser sein eigenes Ziehbild; die Zeile startet an ihrem Platz.
  const first = draggedIds[0];
  const held = first && rects.has(first) ? holdGhost() : null;
  const card = held
    ? document.querySelector<HTMLElement>(`.list:not(.hier) .tcard[data-row="${CSS.escape(first as string)}"]`)
    : null;
  if (card) card.style.visibility = 'hidden';

  const p: Pending = {
    rects,
    ws: useStore.getState().ws,
    until: performance.now() + WINDOW_MS,
    ghost: held ? { ...held, id: first as string } : null,
    hidden: card,
  };
  pending = p;
  // Kommt kein neuer Stand (abgelehnt, nichts geändert), räumt das hier auf.
  setTimeout(() => {
    if (pending !== p) return;
    settle(p);
    pending = null;
  }, WINDOW_MS);
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
      settle(p);
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

    // Die gezogene Karte übernimmt jetzt von ihrer Kopie: Start genau dort,
    // wo die Kopie liegt, im selben Zug wird die Kopie weggenommen.
    const dragged = p.ghost?.id;
    if (p.ghost) {
      const cell = now.find((x) => x.id === dragged);
      if (cell) {
        p.rects.set(cell.id, ghostRect(p.ghost.el, cell.rect));
        const card = cell.el.querySelector<HTMLElement>(':scope > .tcard');
        if (card) card.style.visibility = '';
      }
      settle(p);
    }
    for (const { el, id, rect } of now) {
      const old = p.rects.get(id);
      p.rects.set(id, rect);
      if (!old) continue;
      const dx = old.left - rect.left;
      const dy = old.top - rect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      // Die abgelegte Karte liegt immer obenauf, sonst wer weiter reist – so
      // gleitet niemand unter seinen Nachbarn durch.
      el.style.zIndex =
        id === dragged ? '50' : String(5 + Math.round((Math.abs(dx) + Math.abs(dy)) / 50));
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: DURATION,
        easing: EASING,
      }).onfinish = () => {
        el.style.zIndex = '';
      };
    }
  });
}
