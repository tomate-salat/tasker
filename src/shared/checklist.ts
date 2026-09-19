/**
 * Markdown-Checklisten in einer Beschreibung: „- [ ]“ offen, „- [x]“ erledigt.
 * Unverändert aus dem Prototyp übernommen, inklusive der Regel, dass Zeilen in
 * Code-Blöcken nicht zählen.
 */
export const CHECK_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)( |x|X)(\])/;

export type ChecklistLines = { lines: string[]; out: number[] };

/** Alle Checklisten-Zeilen außerhalb von Code-Blöcken, in Reihenfolge. */
export function checklistLines(s: string | null | undefined): ChecklistLines {
  const lines = (s ?? '').split('\n');
  const out: number[] = [];
  let fence: string | null = null;

  lines.forEach((line, i) => {
    const fenceMatch = line.match(/^\s*(```|~~~)/);
    if (fenceMatch) {
      const mark = fenceMatch[1] as string;
      fence = fence === mark ? null : (fence ?? mark);
      return;
    }
    if (!fence && CHECK_RE.test(line)) out.push(i);
  });

  return { lines, out };
}

const lineDone = (line: string): boolean => (line.match(CHECK_RE)?.[2] ?? ' ') !== ' ';

export type ChecklistCount = { total: number; done: number };

export function checklist(s: string | null | undefined): ChecklistCount {
  const { lines, out } = checklistLines(s);
  return {
    total: out.length,
    done: out.filter((i) => lineDone(lines[i] as string)).length,
  };
}

/** Schaltet den n-ten Punkt um und gibt den neuen Text zurück. */
export function toggleChecklistItem(s: string, n: number): string {
  const { lines, out } = checklistLines(s);
  const i = out[n];
  if (i === undefined) return s;
  lines[i] = (lines[i] as string).replace(
    CHECK_RE,
    (_m, before: string, state: string, after: string) =>
      before + (state === ' ' ? 'x' : ' ') + after,
  );
  return lines.join('\n');
}
