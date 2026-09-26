import type { TextEdit } from './listEdit.js';

/**
 * Ligaturen beim Tippen – über den Prototyp hinaus (Wunsch des Nutzers).
 * Eine Zeichenfolge wird durch das echte Zeichen ersetzt, sobald ihr letztes
 * Zeichen getippt ist; gespeichert wird also `→`, nicht `->`.
 *
 * In Code (`…` und ```-Blöcken) bleibt alles, wie es getippt wurde.
 * Strg+Z holt die getippte Schreibweise zurück.
 */

/** Längere Folgen zuerst: `<->` wird zu `←` und dann mit `>` zu `↔`. */
const RULES: [from: string, to: string][] = [
  ['←>', '↔'],
  ['<=>', '⇔'],
  ['->', '→'],
  ['<-', '←'],
  ['=>', '⇒'],
  ['...', '…'],
  // Der Gedankenstrich erst mit dem Leerzeichen danach – sonst wäre `---` (Trennlinie) nicht mehr tippbar.
  [' -- ', ' – '],
];

/** Steht die Schreibmarke in Code – in `…` auf der Zeile oder in einem ```-Block? */
function inCode(value: string, caret: number): boolean {
  const lineStart = value.lastIndexOf('\n', caret - 1) + 1;
  const fences = value.slice(0, lineStart).match(/^ {0,3}```/gm)?.length ?? 0;
  if (fences % 2 === 1) return true;
  const ticks = value.slice(lineStart, caret).match(/`/g)?.length ?? 0;
  return ticks % 2 === 1;
}

/** Die Ersetzung für das gerade vor `caret` getippte Zeichen, sonst `null`. */
export function ligatureAt(value: string, caret: number): TextEdit | null {
  if (inCode(value, caret)) return null;
  const before = value.slice(0, caret);
  for (const [from, to] of RULES) {
    if (!before.endsWith(from)) continue;
    const start = caret - from.length;
    return { from: start, to: caret, text: to, selStart: start + to.length, selEnd: start + to.length };
  }
  return null;
}
