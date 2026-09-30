import { useEffect } from 'react';

/**
 * Das Mausrad scrollt eine seitlich scrollende Reihe (Wunsch des Nutzers): die
 * Reiter oben und „Im Spiel“ auf dem Tisch. Beide haben keine Scrollleiste, und
 * ein gewöhnliches Mausrad kennt nur hoch und runter.
 *
 * Nur solange die Reihe in diese Richtung noch weiter kann – am Ende scrollt
 * das Rad wieder die Seite. Seitliche Gesten (Touchpad, Umschalt+Rad) bleiben,
 * wie sie sind.
 */
export function useWheelScrollX(ref: React.RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent): void => {
      if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      // Zeilen- und Seitenschritte in Pixel umrechnen, wie der Browser es auch tut.
      const step = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? el.clientWidth : 1;
      const dy = e.deltaY * step;
      if ((dy < 0 && el.scrollLeft <= 0) || (dy > 0 && el.scrollLeft >= max - 1)) return;
      e.preventDefault();
      el.scrollLeft += dy;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);
}
