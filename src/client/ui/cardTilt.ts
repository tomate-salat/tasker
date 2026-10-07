import { useDrag } from './dnd.js';

/**
 * Karten: beim Ziehen kippt die Karte leicht in die Bewegungsrichtung, wie bei
 * Codecks (Wunsch des Nutzers) – nach links gezogen weicht die linke Kante
 * zurück, nach oben die obere, diagonal beides. Bleibt die Maus stehen,
 * richtet sie sich wieder auf. Die Bilder der Galerie kippen genauso.
 *
 * Das Ziehbild des Browsers ist ein starres Abbild und lässt sich nicht
 * bewegen. Deshalb wird es durch ein leeres ersetzt, und eine Kopie der Karte
 * folgt dem Zeiger. Das Ablegen selbst läuft unverändert über `dnd.ts`.
 */

// Ein durchsichtiges Pixel als Ziehbild; vorab geladen, sonst nimmt der Browser das eigene.
const BLANK = new Image();
BLANK.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/*
 * Die drei Stellschrauben. Die Neigung folgt der Geschwindigkeit des Zeigers
 * auf einer Kurve, die schon bei kleinen Bewegungen deutlich anspricht und
 * zum Maximum hin abflacht – schneller ziehen kippt also nie weiter als MAX_TILT.
 */

/** Stärkste Neigung in Grad. Größer = die Karte kippt weiter. */
const MAX_TILT = 22;
/**
 * Tempo in Pixel pro Sekunde, bei dem die Karte schon drei Viertel von
 * MAX_TILT erreicht. Kleiner = empfindlicher (100 ist sehr, 400 wenig empfindlich).
 */
const FULL_SPEED = 180;
/** Wie träge die Karte folgt und sich wieder aufrichtet, in ms. Kleiner = zackiger. */
const RESPONSE_MS = 90;

/** Ohne neue Position so lange gilt der Zeiger als stehend. */
const STILL_MS = 60;

const tilt = (speed: number): number => MAX_TILT * Math.tanh(speed / FULL_SPEED);

let stop: (() => void) | null = null;

/** Die Kopie des laufenden Ziehens – und ob sie das Ende überdauern soll. */
let current: { ghost: HTMLElement; keep: boolean; release: () => void } | null = null;

/**
 * Beim Ablegen: die Kopie bleibt nach dem Ende des Ziehens liegen, wo sie
 * losgelassen wurde, und richtet sich dort auf – bis `release` sie wegnimmt.
 * So kann die echte Karte genau dort übernehmen (`dropFlip.ts`), statt dass
 * sie bis zur Antwort des Servers an ihrem alten Platz aufblitzt.
 */
export function holdGhost(): { el: HTMLElement; release: () => void } | null {
  if (!current) return null;
  current.keep = true;
  return { el: current.ghost, release: current.release };
}

/** Wo die gezogene Karte angefasst wurde und wie groß sie ist – solange gezogen wird. */
let grab: { ox: number; oy: number; w: number; h: number } | null = null;

/**
 * Mitte und Größe der gezogenen Karte zu einer Zeigerposition. Wer einen Platz
 * für sie sucht, richtet sich nach der Mitte und nicht nach dem Zeiger: an
 * einer Ecke gegriffen, liegt der schon über der Nachbarkarte, während die
 * Karte sichtbar noch davor ist.
 */
export function draggedCard(e: {
  clientX: number;
  clientY: number;
}): { x: number; y: number; w: number; h: number } | null {
  if (!grab) return null;
  return { x: e.clientX - grab.ox + grab.w / 2, y: e.clientY - grab.oy + grab.h / 2, w: grab.w, h: grab.h };
}

/** Aus `onDragStart` einer Karte aufrufen, nach dem Start in `dnd.ts`. */
export function startTilt(e: React.DragEvent<HTMLElement>): void {
  stop?.();
  if (!useDrag.getState().drag) return;

  const card = e.currentTarget;
  const box = card.getBoundingClientRect();
  grab = { ox: e.clientX - box.left, oy: e.clientY - box.top, w: box.width, h: box.height };
  const forget = useDrag.subscribe((s) => {
    if (s.drag) return;
    grab = null;
    forget();
  });
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

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
  const { ox, oy } = grab;
  let x = e.clientX;
  let y = e.clientY;
  /** Tempo in Pixel pro Sekunde, geglättet. */
  let vx = 0;
  let vy = 0;
  let rx = 0;
  let ry = 0;
  let frame = 0;
  let lastEvent = performance.now();
  let lastMove = lastEvent;
  let lastFrame = lastEvent;

  // Während des Ziehens gibt es keine Mausereignisse, nur `dragover` – und das
  // in unregelmäßigen Abständen. Darum zählt das Tempo über die echte Zeit.
  const track = (ev: DragEvent): void => {
    if (!ev.clientX && !ev.clientY) return;
    const now = performance.now();
    const dt = Math.max(8, now - lastEvent);
    lastEvent = now;
    const dx = ev.clientX - x;
    const dy = ev.clientY - y;
    if (!dx && !dy) return;
    lastMove = now;
    vx += ((dx / dt) * 1000 - vx) * 0.5;
    vy += ((dy / dt) * 1000 - vy) * 0.5;
    x = ev.clientX;
    y = ev.clientY;
  };

  const step = (): void => {
    const now = performance.now();
    const k = 1 - Math.exp(-(now - lastFrame) / RESPONSE_MS);
    lastFrame = now;
    // Steht der Zeiger, läuft das Tempo aus – die Karte richtet sich auf.
    if (now - lastMove > STILL_MS) {
      vx -= vx * k;
      vy -= vy * k;
    }
    // rotateY < 0 lässt die linke Kante zurückweichen, rotateX > 0 die obere.
    ry += (tilt(vx) - ry) * k;
    rx += (tilt(-vy) - rx) * k;
    ghost.style.transform =
      `translate(${x - ox}px, ${y - oy}px) perspective(700px) ` +
      `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    frame = requestAnimationFrame(step);
  };

  const release = (): void => {
    cancelAnimationFrame(frame);
    ghost.remove();
  };
  const self = { ghost, keep: false, release };
  current = self;

  const end = (): void => {
    document.removeEventListener('dragover', track, true);
    off();
    stop = null;
    if (current === self) current = null;
    // Gehalten läuft die Schleife weiter: ohne neue Position läuft das Tempo
    // aus, und die liegen gebliebene Kopie richtet sich auf.
    if (!self.keep) release();
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
