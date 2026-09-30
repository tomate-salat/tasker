/**
 * Die Animationen des Tisches (Wunsch des Nutzers: Gamification, also
 * animiert). Alles läuft über die Web Animations API auf den Zellen um die
 * Karten; die Karte selbst behält ihr `transform` für das Ausweichen und Kippen.
 *
 * Bei `prefers-reduced-motion` gibt es statt Bewegung nur kurze Überblendungen.
 */

export const reduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Mit Nachfedern – für alles, was irgendwo landet. */
const SPRING = 'cubic-bezier(0.34, 1.45, 0.64, 1)';
const GLIDE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const fade = (el: Element): void => {
  el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
};

/**
 * Die abgelegte Karte übernimmt von ihrer Kopie: sie startet dort, wo die Kopie
 * losgelassen wurde, und federt an ihren Platz. `rotate` (Grad) ist die Neigung
 * am Ziel – auf dem Erledigt-Stapel liegt jede Karte etwas schief.
 */
export function land(cell: HTMLElement, from: DOMRect, rotate = 0): Animation | null {
  if (reduced()) {
    fade(cell);
    return null;
  }
  const to = cell.getBoundingClientRect();
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  cell.style.zIndex = '60';
  const a = cell.animate(
    [
      { transform: `translate(${dx}px, ${dy}px) scale(1.06)`, rotate: '0deg' },
      { transform: 'none', rotate: `${rotate}deg` },
    ],
    { duration: 420, easing: SPRING },
  );
  a.onfinish = () => {
    cell.style.zIndex = '';
  };
  return a;
}

/** Gleiten von der alten Lage an die neue – für alle, die dabei nur Platz machen. */
export function glide(cell: HTMLElement, dx: number, dy: number): void {
  if (reduced() || (Math.abs(dx) < 1 && Math.abs(dy) < 1)) return;
  cell.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
    duration: 300,
    easing: GLIDE,
  });
}

/**
 * Ungültiger Zug: die Kopie schüttelt den Kopf und gleitet zurück an den Platz
 * der Karte. `translate` statt `transform`, weil `cardTilt.ts` das `transform`
 * der Kopie in jedem Bild neu setzt – die beiden Eigenschaften addieren sich.
 */
export async function refuse(ghost: HTMLElement, home: DOMRect | null): Promise<void> {
  if (reduced()) return;
  await ghost.animate(
    [
      { translate: '0 0' },
      { translate: '-12px 0' },
      { translate: '10px 0' },
      { translate: '-7px 0' },
      { translate: '4px 0' },
      { translate: '0 0' },
    ],
    { duration: 360, easing: 'ease-in-out' },
  ).finished;
  if (!home) return;
  const g = ghost.getBoundingClientRect();
  const dx = home.left + home.width / 2 - (g.left + g.width / 2);
  const dy = home.top + home.height / 2 - (g.top + g.height / 2);
  await ghost.animate([{ translate: '0 0' }, { translate: `${dx}px ${dy}px` }], {
    duration: 320,
    easing: GLIDE,
    fill: 'forwards',
  }).finished;
}

/** Ungültiger Zug über die Tastatur: die Karte selbst schüttelt den Kopf. */
export function shake(cell: HTMLElement): void {
  if (reduced()) return;
  cell.animate(
    [
      { translate: '0 0' },
      { translate: '-10px 0' },
      { translate: '8px 0' },
      { translate: '-5px 0' },
      { translate: '3px 0' },
      { translate: '0 0' },
    ],
    { duration: 360, easing: 'ease-in-out' },
  );
}

/** Der Erledigt-Stapel gibt beim Aufprall nach – ein ganzer Stapel stärker. */
export function thump(pile: HTMLElement, big: boolean): void {
  if (reduced()) return;
  const s = big ? 0.86 : 0.93;
  pile.animate(
    [{ transform: 'scale(1)' }, { transform: `scale(${s})`, offset: 0.35 }, { transform: 'scale(1)' }],
    { duration: big ? 520 : 380, easing: SPRING, delay: 120 },
  );
}

/** Der Zähler springt kurz auf. */
export function pop(el: HTMLElement | null): void {
  if (!el || reduced()) return;
  el.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.45)', offset: 0.3 }, { transform: 'scale(1)' }],
    { duration: 480, easing: SPRING, delay: 160 },
  );
}

/** „+1“ steigt vom Stapel auf und verblasst. */
export function float(anchor: HTMLElement, text: string): void {
  if (reduced()) return;
  const box = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'tisch-float';
  el.textContent = text;
  el.style.left = `${box.left + box.width / 2}px`;
  el.style.top = `${box.top}px`;
  document.body.append(el);
  el.animate(
    [
      { transform: 'translate(-50%, 0) scale(0.6)', opacity: 0 },
      { transform: 'translate(-50%, -18px) scale(1.15)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, -64px) scale(1)', opacity: 0 },
    ],
    { duration: 1100, easing: 'ease-out', delay: 180 },
  ).onfinish = () => el.remove();
}

/**
 * Ein ganzer Stapel ist abgelegt: kleine Karten fliegen vom Erledigt-Stapel
 * auseinander. Die Farben kommen aus dem CSS (`.tisch-spark`).
 */
export function burst(anchor: HTMLElement): void {
  if (reduced()) return;
  const box = anchor.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const n = 14;
  for (let i = 0; i < n; i++) {
    const el = document.createElement('div');
    el.className = `tisch-spark s${i % 4}`;
    el.style.left = `${cx}px`;
    el.style.top = `${cy}px`;
    document.body.append(el);
    const angle = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const dist = 70 + Math.random() * 60;
    const spin = (Math.random() - 0.5) * 540;
    el.animate(
      [
        { transform: 'translate(-50%, -50%) rotate(0deg) scale(0.4)', opacity: 1 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) rotate(${spin}deg) scale(1)`,
          opacity: 1,
          offset: 0.6,
        },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist * 1.2}px), calc(-50% + ${Math.sin(angle) * dist * 1.2 + 40}px)) rotate(${spin * 1.3}deg) scale(0.8)`,
          opacity: 0,
        },
      ],
      { duration: 900, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', delay: 140 },
    ).onfinish = () => el.remove();
  }
}

/** Das Schloss aus `LOCK_ICON` in zwei Teilen: Bügel und Körper fliegen auseinander. */
const SHACKLE =
  '<svg width="22" height="22" viewBox="0 0 12 12"><path d="M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
const BODY =
  '<svg width="22" height="22" viewBox="0 0 12 12"><rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="currentColor"/></svg>';

/**
 * Freigeschaltet: an der alten Stelle springt das Schloss auf – der Bügel fliegt
 * nach oben weg, der Körper fällt –, die Karte dreht sich um und gleitet aus
 * „Gesperrt“ in die Mitte.
 */
export function unlock(cell: HTMLElement, from: DOMRect): void {
  if (reduced()) {
    fade(cell);
    return;
  }
  // Das Schloss als eigenes Element über allem, damit es beim Gleiten der Karte zurückbleibt.
  const pieces: [string, number, number, number][] = [
    [SHACKLE, 18, -46, -35],
    [BODY, -10, 38, 25],
  ];
  for (const [svg, dx, dy, spin] of pieces) {
    const part = document.createElement('div');
    part.className = 'tisch-link';
    part.innerHTML = svg;
    part.style.left = `${from.left + from.width / 2}px`;
    part.style.top = `${from.top + from.height / 2}px`;
    document.body.append(part);
    part.animate(
      [
        { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
        { transform: 'translate(-50%, -50%) scale(1.5)', opacity: 1, offset: 0.25 },
        {
          transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1.1) rotate(${spin}deg)`,
          opacity: 0,
        },
      ],
      { duration: 700, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
    ).onfinish = () => part.remove();
  }

  const to = cell.getBoundingClientRect();
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  cell.style.zIndex = '40';
  cell.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
    duration: 620,
    easing: SPRING,
    delay: 180,
    fill: 'backwards',
  }).onfinish = () => {
    cell.style.zIndex = '';
  };
  const card = cell.firstElementChild as HTMLElement | null;
  card?.animate(
    // Von der Kante her aufgedreht – eine ganze Drehung zeigte die Karte spiegelverkehrt.
    [
      { transform: 'perspective(700px) rotateY(-90deg)', filter: 'grayscale(1)' },
      { transform: 'perspective(700px) rotateY(12deg)', filter: 'grayscale(0.2)', offset: 0.7 },
      { transform: 'none', filter: 'none' },
    ],
    { duration: 620, easing: 'ease-out', delay: 180, fill: 'backwards' },
  );
}
