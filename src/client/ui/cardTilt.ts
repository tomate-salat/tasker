import { useDrag } from './dnd.js';

/**
 * Karten: beim Ziehen kippt die Karte leicht in die Bewegungsrichtung, wie bei
 * Codecks (Wunsch des Nutzers) – nach links gezogen weicht die linke Kante
 * zurück, nach oben die obere, diagonal beides. Bleibt die Maus stehen,
 * richtet sie sich wieder auf.
 *
 * Das Ziehbild des Browsers ist ein starres Abbild und lässt sich nicht
 * bewegen. Deshalb wird es durch ein leeres ersetzt, und eine Kopie der Karte
 * folgt dem Zeiger. Das Ablegen selbst läuft unverändert über `dnd.ts`.
 */

// Ein durchsichtiges Pixel als Ziehbild; vorab geladen, sonst nimmt der Browser das eigene.
const BLANK = new Image();
BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/** Höchste Neigung in Grad. */
const MAX = 14;
/** Grad Neigung je Pixel Bewegung pro Bild. */
const GAIN = 0.8;
/** Wie schnell die Neigung ihrem Ziel folgt (0–1). */
const EASE = 0.16;
/** Glättung der Geschwindigkeit – `dragover` kommt nicht in jedem Bild. */
const SMOOTH = 0.35;

const clamp = (v: number): number => Math.max(-MAX, Math.min(MAX, v));

let stop: (() => void) | null = null;

/** Aus `onDragStart` einer Karte aufrufen, nach dem Start in `dnd.ts`. */
export function startTilt(e: React.DragEvent<HTMLElement>): void {
  stop?.();
  if (!useDrag.getState().drag) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const card = e.currentTarget;
  const box = card.getBoundingClientRect();
  const ghost = card.cloneNode(true) as HTMLElement;
  ghost.classList.remove('sel', 'multi', 'holds', 'dragging');
  ghost.classList.add('tcard-ghost');
  ghost.removeAttribute('data-row');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.style.width = `${box.width}px`;
  ghost.style.height = `${box.height}px`;
  document.body.append(ghost);
  e.dataTransfer.setDragImage(BLANK, 0, 0);

  // Die Karte bleibt dort gepackt, wo man sie angefasst hat.
  const ox = e.clientX - box.left;
  const oy = e.clientY - box.top;
  let x = e.clientX;
  let y = e.clientY;
  let lx = x;
  let ly = y;
  let vx = 0;
  let vy = 0;
  let rx = 0;
  let ry = 0;
  let frame = 0;

  // Während des Ziehens gibt es keine Mausereignisse, nur `dragover`.
  const track = (ev: DragEvent): void => {
    if (!ev.clientX && !ev.clientY) return;
    x = ev.clientX;
    y = ev.clientY;
  };

  const step = (): void => {
    vx += (x - lx - vx) * SMOOTH;
    vy += (y - ly - vy) * SMOOTH;
    lx = x;
    ly = y;
    // rotateY < 0 lässt die linke Kante zurückweichen, rotateX > 0 die obere.
    ry += (clamp(vx * GAIN) - ry) * EASE;
    rx += (clamp(-vy * GAIN) - rx) * EASE;
    ghost.style.transform =
      `translate(${x - ox}px, ${y - oy}px) perspective(700px) ` +
      `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    frame = requestAnimationFrame(step);
  };

  const end = (): void => {
    cancelAnimationFrame(frame);
    document.removeEventListener('dragover', track, true);
    ghost.remove();
    off();
    stop = null;
  };
  // Endet das Ziehen – abgelegt, abgebrochen oder die Karte ist aus dem DOM –,
  // setzt `dnd.ts` den Zustand zurück; dann geht auch die Kopie.
  const off = useDrag.subscribe((s) => {
    if (!s.drag) end();
  });

  document.addEventListener('dragover', track, true);
  step();
  stop = end;
}
