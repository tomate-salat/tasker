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

/* --------------------------------------------- Checkboxen zu Unteraufgaben */

/**
 * Ein Checklisten-Punkt samt allem, was zu ihm gehört – wie in Codecks
 * (Wunsch des Nutzers): alles, was tiefer eingerückt ist als die Checkbox,
 * gehört noch zum Punkt, auch über Leerzeilen hinweg und samt eingerückter
 * Checkboxen darin.
 */
export type ChecklistItem = {
  /** Nummer der Checkbox, wie beim Umschalten. */
  n: number;
  /** Erste Zeile (die mit der Checkbox) und die Zeile hinter dem letzten Inhalt. */
  from: number;
  to: number;
  done: boolean;
  /** Steht in keinem anderen Checklisten-Punkt. */
  top: boolean;
  /** Einrückung und Listenzeichen bis vor die Checkbox, etwa `  - `. */
  lead: string;
  title: string;
  /** Der Rest, um die gemeinsame Einrückung gekürzt. */
  desc: string;
};

/** Tabs zählen wie vier Leerzeichen. */
const expandLead = (line: string): string =>
  line.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, '    '));
const indentOf = (line: string): number => /^ */.exec(expandLead(line))?.[0].length ?? 0;
const FENCE = /^\s*(```|~~~)/;

export function checklistItems(s: string | null | undefined): ChecklistItem[] {
  const { lines, out } = checklistLines(s);
  const items: ChecklistItem[] = [];
  let reach = -1;

  out.forEach((from, n) => {
    const line = lines[from] as string;
    const m = CHECK_RE.exec(line) as RegExpExecArray;
    const width = indentOf(line);
    let to = from + 1;
    let fence: string | null = null;
    for (let j = from + 1; j < lines.length; j++) {
      const l = lines[j] as string;
      const f = FENCE.exec(l)?.[1] ?? null;
      if (fence) {
        if (f === fence) fence = null;
        to = j + 1;
        continue;
      }
      if (!l.trim()) continue;
      if (indentOf(l) <= width) break;
      if (f) fence = f;
      to = j + 1;
    }

    const body = lines.slice(from + 1, to).map((l) => (l.trim() ? expandLead(l) : ''));
    // Das Innere eines Code-Blocks zählt für die gemeinsame Einrückung nicht mit.
    let inCode: string | null = null;
    const widths: number[] = [];
    for (const l of body) {
      const f = FENCE.exec(l)?.[1] ?? null;
      if (!inCode && l) widths.push(indentOf(l));
      if (f) inCode = inCode === f ? null : (inCode ?? f);
    }
    const cut = widths.length ? Math.min(...widths) : 0;
    const desc = body
      .map((l) => l.slice(Math.min(cut, indentOf(l))))
      .join('\n')
      .replace(/^\n+|\n+$/g, '');

    items.push({
      n,
      from,
      to,
      done: m[2] !== ' ',
      top: from >= reach,
      lead: (m[1] as string).slice(0, -1),
      title: line.slice(m[0].length).trim(),
      desc,
    });
    if (from >= reach) reach = to;
  });
  return items;
}

/**
 * Welche Punkte zu Unteraufgaben werden: ohne Auswahl alle offenen der
 * obersten Ebene, sonst die genannten. Abgehakte bleiben stehen, ebenso Punkte
 * ohne Text; was in einem anderen gewählten Punkt steckt, geht mit diesem.
 */
export function convertibleItems(s: string | null | undefined, which?: number[]): ChecklistItem[] {
  const picked = checklistItems(s).filter(
    (it) => !it.done && (it.title || it.desc) && (which ? which.includes(it.n) : it.top),
  );
  return picked.filter((it) => !picked.some((o) => o !== it && o.from < it.from && it.from < o.to));
}

/** Ersetzt die Punkte durch Verweise auf die neuen Unteraufgaben: `- $123`. */
export function replaceItems(
  s: string,
  done: { item: ChecklistItem; ref: number }[],
): string {
  const lines = s.split('\n');
  for (const { item, ref } of [...done].sort((a, b) => b.item.from - a.item.from)) {
    lines.splice(item.from, item.to - item.from, `${item.lead}$${ref}`);
  }
  return lines.join('\n');
}
