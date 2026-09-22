import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Eine Auswahlliste unter der Schreibmarke eines Textfelds – die gemeinsame
 * Mechanik hinter der Verweissuche (`$`) und den Befehlen (`/`). ↑/↓ wählen,
 * Enter oder Tab übernehmen, Escape schließt nur die Liste.
 */
export type CaretMenuConfig<T> = {
  /**
   * Passt auf den Text vor der Schreibmarke und endet dort (`…$`). Gruppe 2 ist
   * die Suche hinter dem einen Auslösezeichen, Gruppe 1 was davor stehen muss.
   */
  trigger: RegExp;
  items: (query: string) => T[];
  key: (item: T) => string;
  render: (item: T) => React.ReactNode;
  /** Zusätzliche Klasse je Eintrag, etwa für Erledigtes. */
  itemClass?: (item: T) => string;
  /** Übernehmen: `start` ist die Stelle des Auslösezeichens, `end` die Schreibmarke. */
  apply: (el: HTMLTextAreaElement, start: number, end: number, item: T) => void;
};

type Query = { start: number; text: string };

export function useCaretMenu<T>(area: React.RefObject<HTMLTextAreaElement | null>, cfg: CaretMenuConfig<T>) {
  const [query, setQuery] = useState<Query | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Mit Escape geschlossen: an dieser Stelle nicht gleich wieder öffnen – `onSelect`
  // kommt auch beim Loslassen der Taste noch einmal.
  const dismissed = useRef<number | null>(null);
  const hits = query ? cfg.items(query.text) : [];

  const update = (): void => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    const m = el.selectionStart === el.selectionEnd ? cfg.trigger.exec(el.value.slice(0, caret)) : null;
    const start = m ? caret - (m[2]?.length ?? 0) - 1 : null;
    if (start === null || start !== dismissed.current) dismissed.current = null;
    const next = m && start !== null && dismissed.current === null ? { start, text: m[2] ?? '' } : null;
    // Nur bei echter Änderung – sonst springt die Markierung bei jeder Bewegung zurück.
    setQuery((q) => (q?.start === next?.start && q?.text === next?.text ? q : next));
    if (next?.text !== query?.text) setActive(0);
  };

  useLayoutEffect(() => {
    const el = area.current;
    setPos(query && el ? caretPoint(el, query.start) : null);
  }, [query, area]);

  const take = (item: T): void => {
    const el = area.current;
    if (!el || !query) return;
    cfg.apply(el, query.start, el.selectionStart, item);
    el.focus();
    setQuery(null);
  };

  /** Gibt `true` zurück, wenn die Taste der Liste galt. */
  const onKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!query || !hits.length) return false;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i + (e.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length);
      return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (e.ctrlKey || e.metaKey) return false;
      e.preventDefault();
      const hit = hits[Math.min(active, hits.length - 1)];
      if (hit) take(hit);
      return true;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      dismissed.current = query.start;
      setQuery(null);
      return true;
    }
    return false;
  };

  const node =
    query && hits.length && pos ? (
      <div className="ref-pick" role="listbox" style={{ left: pos.left, top: pos.top }}>
        {hits.map((item, i) => (
          <button
            key={cfg.key(item)}
            role="option"
            aria-selected={i === active}
            className={`ref-pick-i${i === active ? ' on' : ''} ${cfg.itemClass?.(item) ?? ''}`}
            // mousedown statt click: sonst verliert das Textfeld vorher den Fokus.
            onMouseDown={(e) => {
              e.preventDefault();
              take(item);
            }}
          >
            {cfg.render(item)}
          </button>
        ))}
      </div>
    ) : null;

  return { onKeyDown, update, close: () => setQuery(null), node };
}

/**
 * Ersetzt `from..to` und setzt danach die Auswahl. Über `insertText`, damit
 * Strg+Z die Änderung wie getippten Text zurücknimmt; wo der Browser das nicht
 * kann, direkt.
 */
export function replaceText(
  el: HTMLTextAreaElement,
  from: number,
  to: number,
  text: string,
  selStart = from + text.length,
  selEnd = selStart,
): void {
  el.focus();
  el.setSelectionRange(from, to);
  const done =
    from === to && !text
      ? true
      : text
        ? document.execCommand('insertText', false, text)
        : document.execCommand('delete');
  if (!done) {
    el.setRangeText(text, from, to);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  el.setSelectionRange(selStart, selEnd);
}

/**
 * Bildschirmposition unter einer Stelle im Textfeld. Ein unsichtbarer Zwilling
 * mit gleicher Schrift und Breite zeigt, wo die Zeile umbricht.
 */
function caretPoint(el: HTMLTextAreaElement, index: number): { left: number; top: number } {
  const style = getComputedStyle(el);
  const twin = document.createElement('div');
  for (const p of [
    'boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'tabSize',
  ] as const) {
    twin.style[p] = style[p];
  }
  twin.style.position = 'absolute';
  twin.style.visibility = 'hidden';
  twin.style.whiteSpace = 'pre-wrap';
  twin.style.overflowWrap = 'break-word';
  twin.textContent = el.value.slice(0, index);
  const mark = document.createElement('span');
  mark.textContent = el.value[index] ?? '.';
  twin.append(mark);
  document.body.append(twin);
  const box = el.getBoundingClientRect();
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const left = box.left + mark.offsetLeft - el.scrollLeft;
  const top = box.top + mark.offsetTop - el.scrollTop + lineHeight;
  twin.remove();
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - 328)),
    top: Math.min(top, window.innerHeight - 40),
  };
}
