import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Das Aufklappmenü aus dem Prototyp. Es hängt an einem Knopf, klemmt sich an
 * den Bildschirmrand und kennt Untermenüs, Trennlinien, Überschriften und
 * Häkchen. Im Prototyp baut `openMenu` dafür HTML zusammen; hier ist es eine
 * Komponente, die Auswahl bleibt dieselbe.
 */
export type MenuItem =
  | { sep: true }
  | { head: string }
  | {
      label: string;
      /** Häkchen links – sobald ein Eintrag eines hat, rücken alle ein. */
      check?: boolean;
      disabled?: boolean;
      danger?: boolean;
      sub?: MenuItem[];
      onSelect?: () => void;
    };

type Placed = { items: MenuItem[]; x: number; y: number };

export type Menu = {
  /** Öffnet unter dem Knopf; ein zweiter Klick auf denselben schließt wieder. */
  openAt: (el: HTMLElement, items: MenuItem[]) => void;
  /** Öffnet an einem Punkt – für den Rechtsklick. */
  openAtPoint: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
  node: React.ReactNode;
};

export function useMenu(): Menu {
  const [open, setOpen] = useState<Placed | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const openAtPoint = useCallback((x: number, y: number, items: MenuItem[]) => {
    setOpen({ items, x, y });
  }, []);

  const openAt = useCallback((el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    // Derselbe Knopf noch einmal: das offene Menü ist gemeint, nicht ein neues.
    setOpen((cur) => (cur && cur.x === r.left && cur.y === r.bottom + 4 ? null : { items, x: r.left, y: r.bottom + 4 }));
  }, []);

  const node = open
    ? createPortal(<Panel items={open.items} x={open.x} y={open.y} onClose={close} />, document.body)
    : null;

  return { openAt, openAtPoint, close, node };
}

function Panel({
  items,
  x,
  y,
  onClose,
}: {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: -9999, top: -9999 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
    });
    el.focus();
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === 'Tab') {
        // Escape gilt jetzt dem Menü – der Inspektor soll nicht mitschließen.
        e.preventDefault();
        e.stopPropagation();
        onClose();
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
    <div ref={ref} className="ctx" role="menu" tabIndex={-1} style={{ left: pos.left, top: pos.top }}>
      <Items items={items} onClose={onClose} />
    </div>
  );
}

function Items({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [openSub, setOpenSub] = useState<number | null>(null);
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

        if (item.sub) {
          return (
            <div
              key={i}
              className={`ctx-wrap ${openSub === i ? 'open' : ''}`}
              onMouseEnter={() => setOpenSub(i)}
              onMouseLeave={() => setOpenSub(null)}
            >
              <button
                className="ctx-i"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openSub === i}
                onClick={() => setOpenSub(openSub === i ? null : i)}
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
              onClose();
            }}
          >
            {hasCheck && <span className="chk">{item.check ? '✓' : ''}</span>}
            <span className="lab">{item.label}</span>
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
      onClick={(e) => menu.openAt(e.currentTarget, typeof items === 'function' ? items() : items)}
    >
      {children}
    </button>
  );
}
