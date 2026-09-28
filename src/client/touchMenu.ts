/**
 * Tablet: Langes Drücken meldet der Browser zugleich als Kontextmenü und als
 * Beginn des Ziehens – beides kommt sich in Liste und Karten in die Quere.
 *
 * Bei Berührung (Finger, Stift) auf etwas Ziehbarem wartet das Menü deshalb,
 * bis der Finger losgelassen wird. Wandert er vorher spürbar weiter oder wird
 * etwas abgelegt, entfällt es. Ein Ziehen, das der Browser beim langen Drücken
 * von selbst beginnt, zählt dabei nicht – nur die Bewegung. Maus und Tastatur
 * bleiben unberührt.
 */
/** So weit darf der Finger zittern, ohne dass es als Ziehen gilt. */
const SLOP = 16;
/** Langes Drücken dauert im Browser rund eine halbe Sekunde. */
const HOLD_MS = 3000;

type Pending = { target: Element; init: MouseEventInit };

export function installTouchMenu(): void {
  /** Beginn der laufenden Berührung – `null`, solange kein Finger liegt. */
  let touchAt: number | null = null;
  /** Ein Ziehen läuft gerade. */
  let dragging = false;
  let pending: Pending | null = null;
  /** Wo der Finger beim langen Drücken lag. */
  let origin: { x: number; y: number } | null = null;
  /** Ein Menü, das wir in dieser Berührung schon geöffnet haben. */
  let opened = false;
  let replaying = false;

  document.addEventListener('pointerdown', (e) => {
    // Nicht auf `pointerType` des Menü-Ereignisses verlassen: Chrome auf
    // Android meldet das lange Drücken teils als Maus.
    touchAt = e.pointerType === 'touch' || e.pointerType === 'pen' ? performance.now() : null;
    pending = null;
    opened = false;
    // Verschwindet die gezogene Zeile unterwegs, kommt kein `dragend` mehr.
    dragging = false;
  }, true);

  document.addEventListener('contextmenu', (e) => {
    if (replaying || touchAt === null || performance.now() - touchAt > HOLD_MS) return;
    const el = e.target;
    if (!(el instanceof Element) || !el.closest('[draggable="true"]')) return;
    if (el.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    origin = { x: e.clientX, y: e.clientY };
    pending = {
      target: el,
      init: {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        screenX: e.screenX,
        screenY: e.screenY,
        button: 2,
      },
    };
  }, true);

  const open = (): void => {
    const p = pending;
    pending = null;
    if (!p?.target.isConnected) return;
    replaying = true;
    try {
      p.target.dispatchEvent(new MouseEvent('contextmenu', p.init));
    } finally {
      replaying = false;
    }
    opened = true;
  };

  /** Das Menü fällt weg – und steht es schon, geht es wieder zu. */
  const drop = (): void => {
    pending = null;
    if (opened) {
      opened = false;
      // `Menu.tsx` schließt auf mousedown außerhalb.
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  };

  const moved = (e: MouseEvent): void => {
    if ((!pending && !opened) || !origin || touchAt === null) return;
    const d = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
    if (d > SLOP) drop();
  };
  document.addEventListener('pointermove', moved, true);
  document.addEventListener('dragover', moved, true);

  // Loslassen ohne Ziehen: kurz warten – beginnt zugleich ein Ziehen, endet
  // die Berührung erst mit `dragend`.
  const release = (): void => {
    const p = pending;
    if (!p) return;
    setTimeout(() => {
      if (pending === p && !dragging) open();
    }, 80);
  };
  for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
    document.addEventListener(type, release, true);
  }

  document.addEventListener('dragstart', () => {
    if (touchAt !== null) dragging = true;
  }, true);
  // Wirklich abgelegt: dann war es ein Ziehen, kein Menü.
  document.addEventListener('drop', drop, true);
  document.addEventListener('dragend', () => {
    if (!dragging) return;
    dragging = false;
    if (pending) open();
  }, true);
}
