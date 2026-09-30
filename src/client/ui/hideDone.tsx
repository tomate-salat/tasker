import { useLayoutEffect, useReducer, useRef } from 'react';
import { flushSync } from 'react-dom';
import { isDone } from '@shared/model.js';
import { outline, type OutlineRow } from '@shared/outline.js';
import { scopeProjectIds, useStore } from '../store.js';
import { HIDE_DONE_ICON } from './icons.js';

/**
 * Im Plan lassen sich erledigte Aufgaben ausblenden (Wunsch des Nutzers). Das
 * Verschwinden und Erscheinen ist animiert: Zeilen klappen zu und auf, Karten
 * blenden aus und ein, die übrigen Karten gleiten an ihren neuen Platz.
 */

const DURATION = 240;
const EASING = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

/**
 * Die Zeilenfolge ohne erledigte Aufgaben – samt allem, was unter ihnen hängt.
 * Was in `linger` steht, bleibt noch stehen, bis es fertig weggeklappt ist.
 */
export function withoutDone(rows: OutlineRow[], linger?: ReadonlySet<string>): OutlineRow[] {
  const out: OutlineRow[] = [];
  let below: number | null = null;
  for (const row of rows) {
    if (row.type !== 'task') {
      below = null;
      out.push(row);
      continue;
    }
    if (below !== null && row.depth > below) continue;
    below = null;
    if (isDone(row.task) && !linger?.has(row.id)) {
      below = row.depth;
      continue;
    }
    out.push(row);
  }
  return out;
}

/** Zeilen der Liste und Kartenzellen – wie beim Gleiten nach dem Ablegen. */
const ITEMS = '.tcard-cell, .list:not(.hier) > .row[data-row]';

const idOf = (el: HTMLElement): string | null =>
  el.classList.contains('tcard-cell')
    ? (el.querySelector<HTMLElement>(':scope > .tcard[data-row]')?.dataset['row'] ?? null)
    : (el.dataset['row'] ?? null);

function items(list: HTMLElement): Map<string, HTMLElement> {
  const out = new Map<string, HTMLElement>();
  for (const el of list.querySelectorAll<HTMLElement>(ITEMS)) {
    const id = idOf(el);
    if (id) out.set(id, el);
  }
  return out;
}

const isCard = (el: HTMLElement): boolean => el.classList.contains('tcard-cell');

/** Eine Zeile klappt auf ihre volle Höhe auf – oder von dort zu. */
function fold(el: HTMLElement, show: boolean): Animation {
  if (isCard(el)) {
    const hidden = { opacity: 0, transform: 'scale(0.92)' };
    const shown = { opacity: 1, transform: 'none' };
    return el.animate(show ? [hidden, shown] : [shown, hidden], {
      duration: DURATION,
      easing: EASING,
      fill: show ? 'none' : 'forwards',
    });
  }
  const cs = getComputedStyle(el);
  const shown = {
    height: `${el.offsetHeight}px`,
    minHeight: cs.minHeight,
    paddingTop: cs.paddingTop,
    paddingBottom: cs.paddingBottom,
    borderBottomWidth: cs.borderBottomWidth,
    opacity: 1,
  };
  const hidden = {
    height: '0px',
    minHeight: '0px',
    paddingTop: '0px',
    paddingBottom: '0px',
    borderBottomWidth: '0px',
    opacity: 0,
  };
  el.style.overflow = 'hidden';
  const a = el.animate(show ? [hidden, shown] : [shown, hidden], {
    duration: DURATION,
    easing: EASING,
    fill: show ? 'none' : 'forwards',
  });
  if (show) void a.finished.then(() => (el.style.overflow = ''), () => (el.style.overflow = ''));
  return a;
}

/** Karten, die schon da waren, gleiten von ihrer alten Lage an die neue. */
function glide(now: Map<string, HTMLElement>, before: Map<string, DOMRect>): void {
  for (const [id, el] of now) {
    const old = before.get(id);
    if (!old || !isCard(el)) continue;
    const r = el.getBoundingClientRect();
    const dx = old.left - r.left;
    const dy = old.top - r.top;
    if (!dx && !dy) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
      duration: DURATION,
      easing: EASING,
    });
  }
}

const rects = (m: Map<string, HTMLElement>): Map<string, DOMRect> =>
  new Map([...m].map(([id, el]) => [id, el.getBoundingClientRect()]));

/**
 * Die Zeilen der Liste bei ausgeblendeten Erledigten. Wird eine sichtbare
 * Aufgabe erledigt, bleibt sie kurz stehen und klappt dann weg, statt einfach
 * zu verschwinden.
 */
export function useHideDone(full: OutlineRow[], on: boolean): OutlineRow[] {
  const linger = useRef(new Set<string>());
  const started = useRef(new Set<string>());
  const shown = useRef(new Set<string>());
  const wasOn = useRef(on);
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  if (!on) {
    linger.current.clear();
    started.current.clear();
  } else if (wasOn.current) {
    // Nur was eben noch zu sehen war – das Umschalten animiert sich selbst.
    for (const r of full) {
      if (r.type === 'task' && isDone(r.task) && shown.current.has(r.id)) linger.current.add(r.id);
    }
  }
  const rows = on ? withoutDone(full, linger.current) : full;

  useLayoutEffect(() => {
    shown.current = new Set(rows.map((r) => r.id));
    wasOn.current = on;
    const fresh = [...linger.current].filter((id) => !started.current.has(id));
    if (!fresh.length) return;
    const list = document.querySelector<HTMLElement>('.main .list');
    const now = list ? items(list) : new Map<string, HTMLElement>();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    for (const id of fresh) started.current.add(id);
    void Promise.all(
      fresh.map((id) => {
        const el = now.get(id);
        return el && !reduce ? fold(el, false).finished.catch(() => {}) : Promise.resolve();
      }),
    ).then(() => {
      const before = list ? rects(items(list)) : new Map<string, DOMRect>();
      for (const id of fresh) {
        linger.current.delete(id);
        started.current.delete(id);
        shown.current.delete(id);
      }
      flushSync(rerender);
      if (!list) return;
      const after = items(list);
      // Wieder offen (etwa per Rückgängig): die Zeile bleibt und kommt zurück.
      for (const id of fresh) after.get(id)?.getAnimations().forEach((a) => a.cancel());
      if (!reduce) glide(after, before);
    });
  });

  return rows;
}

let busy = false;

export async function toggleHideDone(): Promise<void> {
  if (busy) return;
  const state = useStore.getState();
  const hide = !state.hideDone;
  const list = document.querySelector<HTMLElement>('.main .list');
  if (!list || !state.ws || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    state.setHideDone(hide);
    return;
  }

  busy = true;
  try {
    if (hide) {
      // Erst klappen die Erledigten zu, dann verschwinden sie aus der Liste.
      const all = outline(state.ws, {
        view: 'plan',
        projectIds: scopeProjectIds(state),
        collapsed: state.collapsed,
        filter: state.filter,
      });
      const keep = new Set(withoutDone(all).map((r) => r.id));
      const tasks = new Set(all.filter((r) => r.type === 'task').map((r) => r.id));
      const leaving = [...items(list)].filter(([id]) => tasks.has(id) && !keep.has(id));
      await Promise.all(leaving.map(([, el]) => fold(el, false).finished.catch(() => {})));

      const before = rects(items(list));
      flushSync(() => state.setHideDone(true));
      glide(items(list), before);
    } else {
      const before = rects(items(list));
      flushSync(() => state.setHideDone(false));
      const now = items(list);
      for (const [id, el] of now) if (!before.has(id)) fold(el, true);
      glide(now, before);
    }
  } finally {
    busy = false;
  }
}

/** Der Knopf in der Titelzeile – nur im Plan. */
export function HideDoneSwitch() {
  const { view, hideDone } = useStore();
  if (view !== 'plan') return null;
  const label = hideDone ? 'Erledigte einblenden' : 'Erledigte ausblenden';
  return (
    <button
      className={`head-icon ${hideDone ? 'on' : ''}`}
      onClick={() => void toggleHideDone()}
      title={label}
      aria-label={label}
      aria-pressed={hideDone}
    >
      {HIDE_DONE_ICON}
    </button>
  );
}
