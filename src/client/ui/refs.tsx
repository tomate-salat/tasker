import { isArchived, isDone } from '@shared/model.js';
import { REF_PATTERN, type RefStub } from '@shared/refs.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { replaceText, useCaretMenu } from './caretMenu.js';

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

/**
 * Tippt man `$`, erscheint unter der Schreibmarke eine Liste. ↑/↓ wählen,
 * Enter oder Tab fügen `$142` ein, Escape schließt nur die Liste.
 */
export function useRefPicker(
  ws: Workspace,
  area: React.RefObject<HTMLTextAreaElement | null>,
  o: { projectId: string | null; self: string | null },
) {
  return useCaretMenu<RefTarget>(area, {
    trigger: /(^|[^\w$])\$([^\s$]{0,40})$/,
    items: (q) => search(ws, q, o.projectId, o.self),
    key: (t) => t.id,
    itemClass: (t) => (t.done ? 'done' : ''),
    render: (t) => (
      <>
        <span className="lab">
          {icon(t)}
          {t.title || 'Ohne Titel'}
        </span>
        <span className="no">${t.ref}</span>
      </>
    ),
    apply: (el, start, end, t) => replaceText(el, start, end, `$${t.ref} `),
  });
}
