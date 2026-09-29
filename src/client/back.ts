import { useEffect, useRef } from 'react';
import { useStore } from './store.js';

/**
 * „Zurück“ – Maustaste, Tablet-Geste, Browser-Knopf – schließt zuerst, was
 * gerade über der App liegt (Seitenleiste als Overlay, Dialog, Menü,
 * Zeichnung, Abhängigkeits-Board), und geht erst dann einen Ort zurück
 * (`url.ts`).
 *
 * Dafür legt jede offene Überlagerung einen eigenen Eintrag im Verlauf an –
 * mit derselben Adresse, nur als „Wache“ markiert. Zurück landet unter der
 * Wache und schließt, was über dem Ziel liegt. Schließt die Überlagerung auf
 * anderem Weg (Escape, Klick), nimmt sie ihre Wache wieder heraus.
 *
 * Jeder Eintrag trägt:
 * - `idx`: seine Stelle im Verlauf – daraus ergibt sich, ob es vor oder zurück ging;
 * - `depth`: die oberste Überlagerung, die offen war, als er entstand;
 * - `guard`: er ist die Wache dieser Überlagerung.
 */
type Entry = { idx: number; depth: number; guard?: true };

/** Offene Überlagerungen, die älteste zuerst. Ids steigen auch über Neuladen hinweg. */
const open: { id: number; close: () => void }[] = [];
let nextId = Date.now();
/** Stelle des aktuellen Eintrags im Verlauf. */
let idx = 0;
/** Rücksprünge, die wir selbst ausgelöst haben, um eine Wache herauszunehmen. */
let ownPops = 0;

const entry = (): Partial<Entry> => (history.state ?? {}) as Partial<Entry>;
const top = (): number => open.at(-1)?.id ?? 0;

const standalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as { standalone?: boolean }).standalone === true;

/** Zustand für einen neuen Ort, den `url.ts` anlegt. */
export function pushEntry(url: string): void {
  // Liegt gerade eine Wache oben, geht die Überlagerung mit diesem Ortswechsel
  // zu (Seitenleiste, Menü) – der neue Ort tritt an ihre Stelle, statt eine
  // tote Wache im Verlauf zu hinterlassen.
  if (entry().guard) {
    history.replaceState({ idx, depth: top() } satisfies Entry, '', url);
    return;
  }
  idx += 1;
  history.pushState({ idx, depth: top() } satisfies Entry, '', url);
}

/** Die Adresse umschreiben, ohne dass der Eintrag seine Rolle verliert. */
export function replaceEntry(url: string): void {
  history.replaceState(history.state, '', url);
}

/**
 * Eine Überlagerung ist aufgegangen: Zurück soll sie schließen. Gibt die
 * Freigabe zurück, die beim Schließen auf anderem Weg aufzurufen ist.
 */
export function holdBack(close: () => void): () => void {
  const id = ++nextId;
  open.push({ id, close });
  idx += 1;
  history.pushState({ idx, depth: id, guard: true } satisfies Entry, '', location.href);
  return () => {
    const i = open.findIndex((o) => o.id === id);
    // Schon über Zurück geschlossen – die Wache ist bereits weg.
    if (i < 0) return;
    open.splice(i, 1);
    // Erst nach dem laufenden Zug nachsehen: ein Ortswechsel im selben Zug hat
    // die Wache womöglich schon ersetzt, und im StrictMode geht dieselbe
    // Überlagerung sofort wieder auf.
    queueMicrotask(() => {
      if (entry().guard && entry().depth === id) {
        ownPops += 1;
        history.back();
      }
    });
  };
}

/** `holdBack` für Komponenten: solange `active`, schließt Zurück über `close`. */
export function useBackClose(close: () => void, active = true): void {
  const latest = useRef(close);
  latest.current = close;
  useEffect(() => (active ? holdBack(() => latest.current()) : undefined), [active]);
}

/**
 * Muss vor `syncUrl` laufen: der eigene `popstate`-Lauscher kommt so zuerst
 * dran und hält Sprünge, die nur Überlagerungen betreffen, von `url.ts` fern.
 */
export function installBack(): void {
  const start = entry();
  idx = start.idx ?? 0;
  // Nach dem Neuladen ist nichts mehr offen – der Eintrag ist ein gewöhnlicher Ort.
  history.replaceState({ idx, depth: 0 } satisfies Entry, '', location.href);

  window.addEventListener('popstate', (e) => {
    const to = entry();
    const toIdx = to.idx ?? 0;
    const forward = toIdx > idx;
    idx = toIdx;
    if (ownPops > 0) {
      ownPops -= 1;
      e.stopImmediatePropagation();
      return;
    }
    // Alles schließen, was es beim Ziel noch nicht gab – die jüngste zuerst.
    const depth = to.depth ?? 0;
    while (open.length && open.at(-1)!.id > depth) open.pop()!.close();
    // Eine Wache, deren Überlagerung nicht mehr offen ist, zeigt nichts –
    // weiter in dieselbe Richtung, statt einen leeren Schritt zu machen.
    if (to.guard && !open.some((o) => o.id === to.depth)) {
      e.stopImmediatePropagation();
      if (forward) history.forward();
      else history.back();
      return;
    }
    if (!forward && standalone() && idx === 0 && touch()) {
      useStore.getState().say('Noch einmal „Zurück“ schließt Tasker.');
    }
  });

  // Die Seitenleiste als Overlay (schmale Bildschirme) lebt im Store.
  let releaseSide: (() => void) | null = null;
  useStore.subscribe((s, prev) => {
    if (s.sideOpen === prev.sideOpen) return;
    if (s.sideOpen) releaseSide = holdBack(() => useStore.setState({ sideOpen: false }));
    else {
      releaseSide?.();
      releaseSide = null;
    }
  });

  if (!standalone()) return;

  // Im installierten Fenster verlässt sich die App nicht darauf, dass der
  // Browser die Zurück-/Vor-Tasten der Maus umsetzt. `preventDefault` hält
  // ihn davon ab, es zusätzlich selbst zu tun.
  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.button === 3) history.back();
      else history.forward();
    },
    true,
  );

  // Auf dem Tablet schließt Zurück am Anfang des Verlaufs die App. Ein
  // Ersatz-Eintrag darunter fängt den ersten Schritt ab; erst der nächste
  // schließt. Er entsteht bei einer Berührung – ohne sie überspringt Android
  // den Eintrag.
  const spare = (): void => {
    if (idx !== 0 || !touch()) return;
    idx = 1;
    history.pushState({ idx, depth: top() } satisfies Entry, '', location.href);
  };
  window.addEventListener('click', spare, true);
  window.addEventListener('keydown', spare, true);
}

/** Tablet oder Telefon – dort schließt Zurück am Anfang die App. */
const touch = (): boolean => window.matchMedia('(pointer: coarse)').matches;
