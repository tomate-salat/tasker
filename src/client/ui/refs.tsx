import { useLayoutEffect, useRef, useState } from 'react';
import { isArchived, isDone } from '@shared/model.js';
import { REF_PATTERN, type RefStub } from '@shared/refs.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';

/**
 * Verweise im Text ($142): in der Anzeige ein Link mit dem aktuellen Titel,
 * beim Schreiben eine Suche nach `$`. Über den Prototyp hinaus (Wunsch des
 * Nutzers, wie die Kartenverweise in Codecks).
 */
export type RefTarget = {
  id: string;
  ref: number;
  kind: 'task' | 'milestone';
  title: string;
  doc: boolean;
  done: boolean;
  archived: boolean;
};

export type RefResolver = (ref: number) => RefTarget | null;

const cache = new WeakMap<Workspace, Map<number, RefTarget>>();

/** Nummer → Ziel, aus dem aktiven Bestand und den archivierten Zielen im Startpaket. */
export function refResolver(ws: Workspace, stubs: RefStub[] = []): RefResolver {
  let map = cache.get(ws);
  if (!map) {
    map = new Map();
    for (const m of ws.milestones) {
      map.set(m.ref, { id: m.id, ref: m.ref, kind: 'milestone', title: m.title, doc: false, done: isDone(m), archived: isArchived(m) });
    }
    for (const t of ws.tasks) {
      map.set(t.ref, { id: t.id, ref: t.ref, kind: 'task', title: t.title, doc: ws.isDoc(t), done: isDone(t), archived: !ws.isActive(t) });
    }
    cache.set(ws, map);
  }
  const found = map;
  const archived = (ref: number): RefTarget | null => {
    const s = stubs.find((x) => x.ref === ref);
    return s ? { ...s, doc: false, done: false, archived: true } : null;
  };
  return (ref) => found.get(ref) ?? archived(ref);
}

/** Der Auflöser zum aktuellen Stand – für Stellen, die Markdown zeigen. */
export function useRefResolver(): RefResolver | undefined {
  const ws = useStore((s) => s.ws);
  const stubs = useStore((s) => s.boot?.refStubs);
  return ws ? refResolver(ws, stubs) : undefined;
}

const icon = (t: RefTarget): string => (t.kind === 'milestone' ? '◆ ' : t.doc ? '📄 ' : '');

/**
 * Ersetzt `$142` im fertigen, bereinigten HTML durch Links – nur im Fließtext,
 * nicht in Code und nicht in vorhandenen Links. Gebaut wird mit DOM-Knoten,
 * damit ein Titel nie als HTML gelesen wird.
 */
export function linkRefs(html: string, resolve: RefResolver): string {
  if (!html.includes('$')) return html;
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.parentElement?.closest('code, pre, a')) continue;
    if ((n.textContent ?? '').includes('$')) nodes.push(n as Text);
  }

  for (const node of nodes) {
    const text = node.textContent ?? '';
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(REF_PATTERN)) {
      const start = (m.index ?? 0) + (m[1]?.length ?? 0);
      frag.append(text.slice(last, start));
      const ref = Number(m[2]);
      const target = resolve(ref);
      if (target) {
        const a = document.createElement('a');
        a.className = `ref-link${target.done ? ' done' : ''}${target.archived ? ' archived' : ''}`;
        a.href = `#${ref}`;
        a.dataset['refId'] = target.id;
        a.title = `$${ref} · ${target.kind === 'milestone' ? 'Milestone' : target.doc ? 'Dokument' : 'Aufgabe'}${target.archived ? ' · archiviert' : ''}${target.done ? ' · erledigt' : ''}`;
        a.textContent = `${icon(target)}${target.title || 'Ohne Titel'}`;
        frag.append(a);
      } else {
        const span = document.createElement('span');
        span.className = 'ref-link missing';
        span.title = `$${ref} gibt es nicht (mehr) – gelöscht oder nie angelegt`;
        span.textContent = `$${ref}`;
        frag.append(span);
      }
      last = start + 1 + (m[2]?.length ?? 0);
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return tpl.innerHTML;
}

/** Klick auf einen Verweis im gerenderten Markdown: hinspringen statt bearbeiten. */
export function refClick(e: React.MouseEvent): boolean {
  const a = (e.target as HTMLElement).closest<HTMLElement>('a.ref-link');
  if (!a) return false;
  e.preventDefault();
  e.stopPropagation();
  const id = a.dataset['refId'];
  if (id) useStore.getState().reveal(id);
  return true;
}

/* ------------------------------------------------------ Suche beim Schreiben */

const MAX_HITS = 8;

/** Aufgaben, Dokumente und Milestones zum Suchtext – das eigene Projekt zuerst. */
function search(ws: Workspace, q: string, projectId: string | null, self: string | null): RefTarget[] {
  const resolve = refResolver(ws);
  const needle = q.toLowerCase();
  const all = [...ws.milestones, ...ws.tasks]
    .filter((x) => x.id !== self)
    .map((x) => ({ x, target: resolve(x.ref) as RefTarget }))
    .filter(({ x, target }) =>
      !needle ? true : /^\d+$/.test(needle) ? String(x.ref).startsWith(needle) : target.title.toLowerCase().includes(needle),
    );
  const score = ({ x, target }: (typeof all)[number]): number =>
    (x.projectId === projectId ? 0 : 2) +
    (needle && target.title.toLowerCase().startsWith(needle) ? 0 : 1) +
    (target.done ? 4 : 0);
  return all
    .sort((a, b) => score(a) - score(b) || a.target.title.localeCompare(b.target.title))
    .slice(0, MAX_HITS)
    .map((h) => h.target);
}

type Query = { start: number; text: string };

/**
 * Tippt man `$`, erscheint unter der Schreibmarke eine Liste. ↑/↓ wählen,
 * Enter oder Tab fügen `$142` ein, Escape schließt nur die Liste.
 */
export function useRefPicker(
  ws: Workspace,
  area: React.RefObject<HTMLTextAreaElement | null>,
  o: { projectId: string | null; self: string | null },
) {
  const [query, setQuery] = useState<Query | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Mit Escape geschlossen: an dieser Stelle nicht gleich wieder öffnen – `onSelect`
  // kommt auch beim Loslassen der Taste noch einmal.
  const dismissed = useRef<number | null>(null);
  const hits = query ? search(ws, query.text, o.projectId, o.self) : [];

  const update = (): void => {
    const el = area.current;
    if (!el) return;
    const caret = el.selectionStart;
    const m = /(^|[^\w$])\$([^\s$]{0,40})$/.exec(el.value.slice(0, caret));
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

  const insert = (t: RefTarget): void => {
    const el = area.current;
    if (!el || !query) return;
    el.setRangeText(`$${t.ref} `, query.start, el.selectionStart, 'end');
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
      const hit = hits[active];
      if (hit) insert(hit);
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
        {hits.map((t, i) => (
          <button
            key={t.id}
            role="option"
            aria-selected={i === active}
            className={`ref-pick-i${i === active ? ' on' : ''}${t.done ? ' done' : ''}`}
            // mousedown statt click: sonst verliert das Textfeld vorher den Fokus.
            onMouseDown={(e) => {
              e.preventDefault();
              insert(t);
            }}
          >
            <span className="lab">
              {icon(t)}
              {t.title || 'Ohne Titel'}
            </span>
            <span className="no">${t.ref}</span>
          </button>
        ))}
      </div>
    ) : null;

  return {
    onKeyDown,
    onInput: update,
    onSelect: update,
    onBlur: () => setQuery(null),
    node,
  };
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
  mark.textContent = '$';
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
