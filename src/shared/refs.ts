/**
 * Verweise im Text: `$142` zeigt auf die Aufgabe oder den Milestone mit dieser
 * Nummer. Gespeichert wird nur die Nummer – benennt man das Ziel um, bleibt
 * der Verweis heil und zeigt den neuen Titel.
 *
 * Eine Nummer beginnt nie mit 0 und steht nicht mitten in einem Wort, damit
 * Geldbeträge wie `5$` oder Code wie `a$1` nicht zu Verweisen werden.
 */
export const REF_PATTERN = /(^|[^\w$])\$([1-9]\d*)(?![\w$])/g;

/** Alle Nummern, auf die ein Text verweist. */
export function refsIn(text: string): number[] {
  const out: number[] = [];
  for (const m of (text ?? '').matchAll(REF_PATTERN)) out.push(Number(m[2]));
  return out;
}

/** Ein Verweisziel außerhalb des aktiven Bestands – archiviert, nur mit Titel. */
export type RefStub = { id: string; ref: number; title: string; kind: 'task' | 'milestone' };
