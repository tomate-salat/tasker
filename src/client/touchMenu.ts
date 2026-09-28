/**
 * Tablet: Langes Drücken meldet der Browser zugleich als Kontextmenü und als
 * Beginn des Ziehens – beides kommt sich in Liste und Karten in die Quere.
 *
 * Bei Berührung (Finger, Stift) auf etwas Ziehbarem wartet das Menü deshalb,
 * bis der Finger losgelassen wird. Wird in dieser Berührung gezogen – egal ob
 * vor oder nach dem Menü-Ereignis – oder wandert der Finger weiter, entfällt
 * es. Maus und Tastatur bleiben unberührt.
 */
const SLOP = 10;
/** Langes Drücken dauert im Browser rund eine halbe Sekunde. */
const HOLD_MS = 3000;

type Pending = { target: Element; init: MouseEventInit };

export function installTouchMenu(): void {
  /** Beginn der laufenden Berührung – `null`, solange kein Finger liegt. */
  let touchAt: number | null = null;
  /** In dieser Berührung wurde gezogen. */
  let dragged = false;
  let pending: Pending | null = null;
  /** Ein Menü, das wir in dieser Berührung schon geöffnet haben. */
  let opened = false;
  let replaying = false;

  document.addEventListener('pointerdown', (e) => {
    // Nicht auf `pointerType` des Menü-Ereignisses verlassen: Chrome auf
    // Android meldet das lange Drücken teils als Maus.
    touchAt = e.pointerType === 'touch' || e.pointerType === 'pen' ? performance.now() : null;
    dragged = false;
    pending = null;
    opened = false;
  }, true);

  document.addEventListener('contextmenu', (e) => {
    if (replaying || touchAt === null || performance.now() - touchAt > HOLD_MS) return;
    const el = e.target;
    if (!(el instanceof Element) || !el.closest('[draggable="true"]')) return;
    if (el.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
    if (dragged) return;
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

  const release = (): void => {
    const p = pending;
    if (!p) return;
    // Erst gleich danach: beginnt zugleich ein Ziehen, gewinnt das.
    setTimeout(() => {
      if (pending !== p || dragged) return;
      pending = null;
      if (!p.target.isConnected) return;
      replaying = true;
      try {
        p.target.dispatchEvent(new MouseEvent('contextmenu', p.init));
      } finally {
        replaying = false;
      }
      opened = true;
    }, 80);
  };
  for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
    document.addEventListener(type, release, true);
  }

  document.addEventListener('pointermove', (e) => {
    if (!pending) return;
    const dx = e.clientX - (pending.init.clientX ?? 0);
    const dy = e.clientY - (pending.init.clientY ?? 0);
    if (Math.hypot(dx, dy) > SLOP) pending = null;
  }, true);

  document.addEventListener('dragstart', () => {
    if (touchAt === null) return;
    dragged = true;
    pending = null;
    // Hat der Browser die Berührung schon vorher abgebrochen, steht das Menü
    // bereits – dann schließt es das Ziehen wieder (`Menu.tsx` lauscht auf mousedown).
    if (opened) {
      opened = false;
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  }, true);
}
