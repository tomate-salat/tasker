import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { type HeadingSection, toggleChecklistItem } from '@shared/checklist.js';
import type { Drawing } from '../api.js';
import { linkRefs, type RefResolver } from './refs.js';

/**
 * Die Beschreibung als Markdown, wie im Prototyp: Checklisten sind anklickbar
 * und `![[zeichnung:Name]]` wird durch die Zeichnung selbst ersetzt.
 *
 * Gerendert wird in zwei Schritten – erst der Text zu HTML (bereinigt), dann
 * an den Platzhaltern aufgeteilt, damit die Zeichnungen echte Komponenten sind
 * und nicht in fremdem HTML stecken.
 */
const TOKEN = /!\[\[zeichnung:([^\]]+)\]\]/g;
const PLACEHOLDER = /^DRAWEMBED([A-Za-z0-9_-]+)END$/;

/**
 * Markdown zu bereinigtem HTML; Checkboxen bekommen ihre laufende Nummer, und
 * mit `resolve` werden Verweise ($142) zu Links. Jeder Zeilenumbruch bleibt
 * einer (Wunsch des Nutzers).
 *
 * `subtasks` sind die Nummern der Checkboxen, die neben sich einen Knopf zum
 * Umwandeln in eine Unteraufgabe bekommen, `sections` die Überschriften, für
 * die dasselbe gilt.
 */
export function markdownHtml(
  src: string,
  resolve?: RefResolver,
  subtasks?: ReadonlySet<number>,
  sections?: readonly HeadingSection[],
): string {
  return serialize(markdownDom(src, resolve, subtasks, sections).childNodes);
}

/**
 * Alles nach dem Bereinigen geschieht am DOM, nie am HTML-Text: ein Regex über
 * HTML trifft auch, was in einem Attribut steht, und kann es dort aufbrechen.
 * Die Beschreibung kommt nicht nur vom Nutzer (MCP, Token, Import).
 */
function markdownDom(
  src: string,
  resolve?: RefResolver,
  subtasks?: ReadonlySet<number>,
  sections?: readonly HeadingSection[],
): DocumentFragment {
  const raw = marked.parse(src ?? '', { async: false, gfm: true, breaks: true }) as string;
  const root = DOMPurify.sanitize(raw, { RETURN_DOM_FRAGMENT: true });

  // Links nach draußen öffnen einen neuen Tab – sonst verlässt ein Klick die Anwendung.
  for (const a of root.querySelectorAll('a[href]')) {
    if (!/^https?:/i.test(a.getAttribute('href') ?? '')) continue;
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer');
  }
  if (resolve) linkRefs(root, resolve);

  root.querySelectorAll('input[type="checkbox"]').forEach((old, i) => {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'md-cb';
    box.dataset['cb'] = String(i);
    if (old.hasAttribute('checked')) box.setAttribute('checked', '');
    box.setAttribute('aria-label', 'Checklisten-Punkt umschalten');
    old.replaceWith(box);
    if (subtasks?.has(i)) box.after(subButton('sub', i, 'In Unteraufgabe umwandeln'));
  });
  if (!sections?.length) return root;

  // Die Überschriften im HTML und die im Text werden der Reihe nach über Ebene
  // und Wortlaut zusammengeführt – was nicht sicher passt, bekommt keinen Knopf.
  let at = 0;
  for (const h of root.querySelectorAll('h1, h2, h3, h4, h5, h6')) {
    const level = Number(h.tagName.slice(1));
    const text = letters(h.textContent ?? '');
    const hit = sections.findIndex((s, i) => i >= at && s.level === level && letters(s.title) === text);
    if (hit < 0) continue;
    at = hit + 1;
    h.append(subButton('head', (sections[hit] as HeadingSection).n, 'Abschnitt in Unteraufgabe umwandeln'));
  }
  return root;
}

function subButton(key: 'sub' | 'head', n: number, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'md-cb-sub';
  b.dataset[key] = String(n);
  b.title = title;
  b.textContent = '↳ Unteraufgabe';
  return b;
}

/** Über ein `template`, damit nichts davon schon hier lädt oder ausgeführt wird. */
const serialize = (nodes: Iterable<Node>): string => {
  const tpl = document.createElement('template');
  tpl.content.append(...[...nodes].map((n) => n.cloneNode(true)));
  return tpl.innerHTML;
};

/** Nur Buchstaben und Ziffern – zum Vergleich von Markdown-Text und gerendertem HTML. */
const letters = (s: string): string => s.replace(/[^\p{L}\p{N}]/gu, '');

export type MarkdownPart =
  | { kind: 'html'; html: string }
  | { kind: 'drawing'; drawing: Drawing };

/** Zerlegt die Beschreibung in HTML-Stücke und eingebettete Zeichnungen. */
export function markdownParts(
  desc: string,
  drawings: Drawing[],
  resolve?: RefResolver,
  subtasks?: ReadonlySet<number>,
  sections?: readonly HeadingSection[],
): { parts: MarkdownPart[]; embedded: Set<string> } {
  const embedded = new Set<string>();
  const src = (desc || '').replace(TOKEN, (m, name: string) => {
    const d = drawings.find((z) => z.name === name.trim());
    if (!d) return m;
    embedded.add(d.id);
    return `\n\nDRAWEMBED${d.id}END\n\n`;
  });

  // Aufgeteilt wird an den Absätzen der obersten Ebene, die nur aus einem
  // Platzhalter bestehen – jedes Stück bleibt so ganzes, bereinigtes HTML.
  const parts: MarkdownPart[] = [];
  let pending: Node[] = [];
  const flush = (): void => {
    const html = serialize(pending);
    if (html.trim()) parts.push({ kind: 'html', html });
    pending = [];
  };
  for (const node of markdownDom(src, resolve, subtasks, sections).childNodes) {
    const id =
      node instanceof HTMLParagraphElement && node.children.length === 0
        ? PLACEHOLDER.exec(node.textContent ?? '')?.[1]
        : undefined;
    if (id === undefined) {
      pending.push(node);
      continue;
    }
    flush();
    const d = drawings.find((z) => z.id === id);
    if (d) parts.push({ kind: 'drawing', drawing: d });
  }
  flush();
  return { parts, embedded };
}

/**
 * Klick auf den Umwandeln-Knopf einer Checkbox oder Überschrift: ihre Nummer,
 * sonst `null`.
 */
export function subtaskClick(e: React.MouseEvent): { item: number } | { heading: number } | null {
  const button = (e.target as HTMLElement).closest?.('button.md-cb-sub') as HTMLElement | null;
  if (!button) return null;
  e.stopPropagation();
  const heading = button.dataset.head !== undefined;
  const n = Number(heading ? button.dataset.head : button.dataset.sub);
  if (Number.isNaN(n)) return null;
  return heading ? { heading: n } : { item: n };
}

/**
 * Klick auf eine Checkbox im gerenderten Markdown: den Punkt umschalten, ohne
 * in den Editor zu wechseln. Gibt den neuen Text zurück oder `null`, wenn der
 * Klick keiner Checkbox galt.
 */
export function checkboxClick(e: React.MouseEvent, desc: string): string | null {
  const target = e.target as HTMLElement;
  if (!target.matches?.('input.md-cb')) return null;
  e.stopPropagation();
  const n = Number(target.dataset.cb);
  return Number.isNaN(n) ? null : toggleChecklistItem(desc, n);
}
