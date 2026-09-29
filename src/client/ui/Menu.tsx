import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBackClose } from '../back.js';
import { useStore } from '../store.js';

/**
 * Das Aufklappmenü aus dem Prototyp. Es hängt an einem Knopf, klemmt sich an
 * den Bildschirmrand und kennt Untermenüs, Trennlinien, Überschriften und
 * Häkchen. Im Prototyp baut `openMenu` dafür HTML zusammen; hier ist es eine
 * Komponente, die Auswahl bleibt dieselbe.
 */
export type MenuItem =
  | { sep: true }
  | { head: string }
  /** Eine Zeile kleiner Knöpfe statt untereinander – im Prototyp die Priorität. */
  | { label: string; chips: { label: string; on?: boolean; onSelect: () => void }[] }
  /** Ein Textfeld; Enter übergibt den Text und schließt das Menü. */
  | { input: string; onSubmit: (value: string) => void }
  | {
      label: string;
      /** Häkchen links – sobald ein Eintrag eines hat, rücken alle ein. */
      check?: boolean;
      disabled?: boolean;
      danger?: boolean;
      /** Das Tastenkürzel, das dasselbe tut – rechts, blass. */
      kbd?: string;
      /** Das Menü bleibt nach dem Klick offen – im Prototyp die Labels. */
      keep?: boolean;
      sub?: MenuItem[];
      onSelect?: () => void;
    };

/**
 * Eine Funktion statt einer fertigen Liste baut das Menü bei jeder Änderung im
 * Speicher neu – so wandern die Häkchen mit, solange es offen bleibt.
 */
type Items = MenuItem[] | (() => MenuItem[]);
type Placed = { items: Items; x: number; y: number; keyboard: boolean };

export type Menu = {
  /**
   * Öffnet unter dem Knopf; ein zweiter Klick auf denselben schließt wieder.
   * `keyboard`: per Taste geöffnet – dann steht der Fokus gleich auf dem ersten Eintrag.
   */
  openAt: (el: HTMLElement, items: Items, keyboard?: boolean) => void;
  /** Öffnet an einem Punkt – für den Rechtsklick und die Kontextmenü-Taste. */
  openAtPoint: (x: number, y: number, items: MenuItem[], keyboard?: boolean) => void;
  close: () => void;
  node: React.ReactNode;
};

export function useMenu(): Menu {
  const [open, setOpen] = useState<Placed | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const openAtPoint = useCallback((x: number, y: number, items: MenuItem[], keyboard = false) => {
    setOpen({ items, x, y, keyboard });
  }, []);

  const openAt = useCallback((el: HTMLElement, items: Items, keyboard = false) => {
    const r = el.getBoundingClientRect();
    // Derselbe Knopf noch einmal: das offene Menü ist gemeint, nicht ein neues.
    setOpen((cur) =>
      cur && cur.x === r.left && cur.y === r.bottom + 4
        ? null
        : { items, x: r.left, y: r.bottom + 4, keyboard },
    );
  }, []);

  const node = open
    ? createPortal(
        <Panel items={open.items} x={open.x} y={open.y} keyboard={open.keyboard} onClose={close} />,
        document.body,
      )
    : null;

  return { openAt, openAtPoint, close, node };
}

/** Die bedienbaren Knöpfe einer Menüebene, ohne die der Untermenüs darin. */
const buttonsOf = (level: HTMLElement): HTMLButtonElement[] =>
  [
    ...level.querySelectorAll<HTMLButtonElement>(
      ':scope > .ctx-i, :scope > .ctx-wrap > .ctx-i, :scope > .ctx-chips > button',
    ),
  ].filter((b) => !b.disabled);

/** Klappt das Untermenü eines Eintrags auf und setzt den Fokus hinein. */
const enterSub = (button: HTMLElement): void => {
  button.click();
  requestAnimationFrame(() => {
    const sub = button.parentElement?.querySelector<HTMLElement>(':scope > .ctx-sub');
    if (sub) buttonsOf(sub)[0]?.focus();
  });
};

function Panel({
  items: source,
  x,
  y,
  keyboard,
  onClose,
}: {
  items: Items;
  x: number;
  y: number;
  keyboard: boolean;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBackClose(onClose);
  // Abonniert den Arbeitsstand, damit ein offenes Menü neu gebaut wird.
  useStore((s) => s.ws);
  const items = typeof source === 'function' ? source() : source;
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
    // Ein Menü, das mit einem Textfeld anfängt, ist zum Tippen da – dann gehört
    // der Fokus dorthin, sonst liefen die ersten Anschläge ins Leere.
    const field = el.querySelector<HTMLInputElement>(':scope > .ctx-input:first-child');
    (field ?? (keyboard ? (buttonsOf(el)[0] ?? el) : el)).focus();
  }, [x, y, keyboard]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    /**
     * Wie `ctxKey` im Prototyp: Solange das Menü offen ist, gehören ihm alle
     * Tasten – sonst wanderte mit ↓ zugleich die Auswahl in der Liste, und
     * `Enter` legte dort eine Aufgabe an.
     */
    const onKey = (e: KeyboardEvent): void => {
      const root = ref.current;
      if (!root) return;
      const active = document.activeElement as HTMLElement | null;
      // Im Textfeld gehören die Tasten dem Feld – nur Escape, Tab und ↑/↓ bleiben beim Menü.
      if (
        active?.matches('input') &&
        root.contains(active) &&
        !['Escape', 'Tab', 'ArrowDown', 'ArrowUp'].includes(e.key)
      ) {
        return;
      }
      e.stopPropagation();
      const level =
        active && root.contains(active) ? (active.closest<HTMLElement>('.ctx') ?? root) : root;
      const buttons = buttonsOf(level);
      const i = buttons.indexOf(active as HTMLButtonElement);
      const isSub = !!active?.parentElement?.classList.contains('ctx-wrap') && active.classList.contains('ctx-i');

      if (e.key === 'Escape' || e.key === 'Tab') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        buttons[(i + 1) % buttons.length]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        buttons[(i - 1 + buttons.length) % buttons.length]?.focus();
      } else if (e.key === 'ArrowRight' && active && isSub) {
        e.preventDefault();
        enterSub(active);
      } else if (e.key === 'ArrowLeft' && level !== root) {
        e.preventDefault();
        // Der Fokus geht zurück auf den Eintrag; das schließt das Untermenü (siehe `onFocus`).
        level.parentElement?.querySelector<HTMLElement>(':scope > .ctx-i')?.focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (active && isSub) enterSub(active);
        else if (active?.matches('button')) active.click();
      }
    };
    // Erst im nächsten Zug lauschen, sonst schließt der öffnende Klick gleich wieder.
    const timer = setTimeout(() => document.addEventListener('mousedown', onDown));
    document.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.left, top: pos.top }}
      // Die Kontextmenü-Taste löst nach dem Öffnen noch das Browsermenü aus – nicht hier.
      onContextMenu={(e) => e.preventDefault()}
    >
      <Items items={items} onClose={onClose} />
    </div>
  );
}

function Items({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
  const wraps = useRef(new Map<number, HTMLDivElement>());

  // Rechts neben den Eintrag, bei Platzmangel links davon (`flip` im Prototyp), und
  // nie über den unteren Rand hinaus.
  useLayoutEffect(() => {
    if (openSub === null) return;
    const wrap = wraps.current.get(openSub);
    const sub = wrap?.querySelector<HTMLElement>(':scope > .ctx-sub');
    if (!wrap || !sub) return;
    const at = wrap.getBoundingClientRect();
    const { width, height } = sub.getBoundingClientRect();
    const right = at.right + 2;
    sub.style.left = `${right + width > window.innerWidth - 8 ? Math.max(8, at.left - width - 2) : right}px`;
    sub.style.top = `${Math.max(8, Math.min(at.top - 6, window.innerHeight - height - 8))}px`;
  }, [openSub]);

  // Häkchen nur einrücken, wenn es in dieser Ebene überhaupt welche gibt.
  const hasCheck = items.some((i) => 'check' in i);

  return (
    <>
      {items.map((item, i) => {
        if ('sep' in item) return <div key={i} className="ctx-sep" role="separator" />;
        if ('head' in item)
          return (
            <div key={i} className="ctx-head">
              {item.head}
            </div>
          );

        if ('input' in item) {
          return (
            <input
              key={i}
              className="ctx-input"
              placeholder={item.input}
              aria-label={item.input}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                const value = e.currentTarget.value.trim();
                if (!value) return;
                item.onSubmit(value);
                onClose();
              }}
            />
          );
        }

        if ('chips' in item) {
          return (
            <div key={i} className="ctx-chips" role="group" aria-label={item.label}>
              <span className="lbl">{item.label}</span>
              {item.chips.map((c) => (
                <button
                  key={c.label}
                  className={c.on ? 'on' : ''}
                  role="menuitemradio"
                  aria-checked={!!c.on}
                  onClick={() => {
                    c.onSelect();
                    onClose();
                  }}
                >
                  {c.label}
                </button>
              ))}
            </div>
          );
        }

        if (item.sub) {
          return (
            <div
              key={i}
              ref={(el) => {
                if (el) wraps.current.set(i, el);
                else wraps.current.delete(i);
              }}
              className={`ctx-wrap ${openSub === i ? 'open' : ''}`}
              onMouseEnter={() => setOpenSub(i)}
              // Wer im Untermenü gerade tippt, verliert es nicht, nur weil die Maus hinausrutscht.
              onMouseLeave={(e) => {
                if (!e.currentTarget.querySelector('input:focus')) setOpenSub(null);
              }}
            >
              <button
                className="ctx-i"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSub === i}
                // Ein Klick öffnet, er schließt nicht wieder: sonst macht er das
                // zu, was das Überfahren gerade aufgeklappt hat.
                onClick={() => setOpenSub(i)}
                // Kommt der Fokus mit ← aus dem Untermenü zurück, klappt es zu.
                onFocus={(e) => {
                  const sub = e.currentTarget.nextElementSibling;
                  if (e.relatedTarget && sub?.contains(e.relatedTarget)) setOpenSub(null);
                }}
              >
                <span className="lab">{item.label}</span>
                <span className="arrow" aria-hidden="true">
                  ▸
                </span>
              </button>
              <div className="ctx ctx-sub" role="menu">
                <Items items={item.sub} onClose={onClose} />
              </div>
            </div>
          );
        }

        return (
          <button
            key={i}
            className={`ctx-i ${item.danger ? 'danger' : ''}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.();
              if (!item.keep) onClose();
            }}
          >
            {hasCheck && <span className="chk">{item.check ? '✓' : ''}</span>}
            <span className="lab">{item.label}</span>
            {item.kbd && <kbd>{item.kbd}</kbd>}
          </button>
        );
      })}
    </>
  );
}

/** Der Knopf, der ein Menü öffnet – im Prototyp `.prop`. */
export function PropButton({
  items,
  menu,
  empty = false,
  title,
  className = '',
  children,
}: {
  items: MenuItem[] | (() => MenuItem[]);
  menu: Menu;
  /** Leer heißt: gestrichelter Rand, blasse Schrift. */
  empty?: boolean;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`prop ${empty ? 'empty' : ''} ${className}`}
      title={title}
      aria-haspopup="menu"
      onClick={(e) => menu.openAt(e.currentTarget, typeof items === 'function' ? items() : items, e.detail === 0)}
    >
      {children}
    </button>
  );
}
