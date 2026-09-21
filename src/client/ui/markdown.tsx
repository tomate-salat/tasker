import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { toggleChecklistItem } from '@shared/checklist.js';
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
const PLACEHOLDER = /<p>DRAWEMBED([A-Za-z0-9_-]+)END<\/p>/;

/**
 * Markdown zu bereinigtem HTML; Checkboxen bekommen ihre laufende Nummer, und
 * mit `resolve` werden Verweise ($142) zu Links.
 */
export function markdownHtml(src: string, resolve?: RefResolver): string {
  const raw = marked.parse(src ?? '', { async: false, gfm: true }) as string;
  // Links nach draußen öffnen einen neuen Tab – sonst verlässt ein Klick die Anwendung.
  const sanitized = DOMPurify.sanitize(raw).replace(
    /<a href="(https?:[^"]*)"/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer"',
  );
  const clean = resolve ? linkRefs(sanitized, resolve) : sanitized;
  let n = 0;
  return clean.replace(
    /<input[^>]*type="checkbox"[^>]*>/g,
    (m) =>
      `<input type="checkbox" class="md-cb" data-cb="${n++}"${/checked/.test(m) ? ' checked' : ''} aria-label="Checklisten-Punkt umschalten">`,
  );
}

export type MarkdownPart =
  | { kind: 'html'; html: string }
  | { kind: 'drawing'; drawing: Drawing };

/** Zerlegt die Beschreibung in HTML-Stücke und eingebettete Zeichnungen. */
export function markdownParts(
  desc: string,
  drawings: Drawing[],
  resolve?: RefResolver,
): { parts: MarkdownPart[]; embedded: Set<string> } {
  const embedded = new Set<string>();
  const src = (desc || '').replace(TOKEN, (m, name: string) => {
    const d = drawings.find((z) => z.name === name.trim());
    if (!d) return m;
    embedded.add(d.id);
    return `\n\nDRAWEMBED${d.id}END\n\n`;
  });

  const pieces = markdownHtml(src, resolve).split(new RegExp(PLACEHOLDER.source, 'g'));
  const parts: MarkdownPart[] = [];
  pieces.forEach((piece, i) => {
    if (i % 2 === 1) {
      const d = drawings.find((z) => z.id === piece);
      if (d) parts.push({ kind: 'drawing', drawing: d });
      return;
    }
    if (piece.trim()) parts.push({ kind: 'html', html: piece });
  });
  return { parts, embedded };
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
