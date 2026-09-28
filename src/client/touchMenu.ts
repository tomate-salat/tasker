/**
 * Tablet: Langes Drücken meldet der Browser zugleich als Kontextmenü und als
 * Beginn des Ziehens – beides kommt sich in Liste und Karten in die Quere.
 *
 * Bei Berührung (Finger, Stift) auf etwas Ziehbarem wartet das Menü deshalb,
 * bis der Finger losgelassen wird. Beginnt vorher ein Ziehen oder wandert der
 * Finger weiter, entfällt es. Maus und Tastatur bleiben unberührt.
 */
const SLOP = 10;

type Pending = { target: Element; init: MouseEventInit };

export function installTouchMenu(): void {
  let lastType = 'mouse';
  let pending: Pending | null = null;
  /** Ein Menü, das wir in dieser Berührung schon geöffnet haben. */
  let opened = false;
  let replaying = false;

  document.addEventListener('pointerdown', (e) => {
    lastType = e.pointerType;
    opened = false;
  }, true);

  document.addEventListener('contextmenu', (e) => {
    if (replaying) return;
    const type = (e as PointerEvent).pointerType || lastType;
    if (type !== 'touch' && type !== 'pen') return;
    const el = e.target;
    if (!(el instanceof Element) || !el.closest('[draggable="true"]')) return;
    if (el.closest('input, textarea, [contenteditable="true"]')) return;
    e.preventDefault();
    e.stopPropagation();
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
    if (!pending) return;
    const p = pending;
    // Erst im nächsten Zug: beginnt gleichzeitig ein Ziehen, gewinnt das.
    setTimeout(() => {
      if (pending !== p) return;
      pending = null;
      if (!p.target.isConnected) return;
      replaying = true;
      try {
        p.target.dispatchEvent(new MouseEvent('contextmenu', p.init));
      } finally {
        replaying = false;
      }
      opened = true;
    }, 30);
  };
  for (const type of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) {
    document.addEventListener(type, release, true);
  }

  document.addEventListener('pointermove', (e) => {
    const x = pending?.init.clientX ?? 0;
    const y = pending?.init.clientY ?? 0;
    if (pending && Math.hypot(e.clientX - x, e.clientY - y) > SLOP) pending = null;
  }, true);

  document.addEventListener('dragstart', () => {
    pending = null;
    // Hat der Browser die Berührung schon vorher abgebrochen, steht das Menü
    // bereits – dann schließt es das Ziehen wieder (`Menu.tsx` lauscht auf mousedown).
    if (opened) {
      opened = false;
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    }
  }, true);
}
