/**
 * Listen im Beschreibungsfeld weiterschreiben – über den Prototyp hinaus
 * (Wunsch des Nutzers). Reine Textfunktionen: sie bekommen Text und Auswahl
 * und liefern die Änderung, das Textfeld wendet sie an.
 *
 * - Enter in einem Listenpunkt (`- `, `* `, `1. `, auch mit `[ ]`) beginnt den
 *   nächsten Punkt gleicher Art; eine Checkbox kommt immer leer mit.
 * - Enter in einem leeren Punkt beendet die Liste: eingerückt geht es eine
 *   Ebene hinauf, ganz außen verschwindet das Zeichen.
 * - Tab / Umschalt+Tab rücken Listenpunkte ein und aus – alle markierten
 *   Zeilen, die Listenpunkte sind.
 * - Alt und Pfeil hoch/runter schieben die Zeile der Schreibmarke (oder alle
 *   markierten) nach oben oder unten.
 */

/** Ersetze `from..to` durch `text`, danach steht die Auswahl bei `selStart..selEnd`. */
export type TextEdit = { from: number; to: number; text: string; selStart: number; selEnd: number };

type Item = {
  indent: string;
  /** `-`, `*`, `+` oder `1.` / `1)` */
  marker: string;
  /** Die Nummer bei nummerierten Punkten. */
  num: number | null;
  delim: string;
  /** Abstand nach dem Zeichen. */
  gap: string;
  /** `[ ] ` samt Abstand, falls eine Checkbox dasteht. */
  box: string;
  /** Länge von Einrückung, Zeichen, Abstand und Checkbox. */
  prefix: number;
};

const ITEM = /^( *)([-*+]|(\d{1,9})([.)]))( +)(\[[ xX]\] +)?/;

function item(line: string): Item | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  return {
    indent: m[1] ?? '',
    marker: m[2] ?? '-',
    num: m[3] ? Number(m[3]) : null,
    delim: m[4] ?? '',
    gap: m[5] ?? ' ',
    box: m[6] ?? '',
    prefix: m[0].length,
  };
}

/** Wie weit der Inhalt eines Punktes eingerückt ist – so tief muss ein Unterpunkt stehen. */
const contentWidth = (it: Item): number => it.marker.length + it.gap.length;

/**
 * Der Anfang der Zeile, in der `i` steht. Die Null muss dabei ausdrücklich
 * abgefangen werden: `lastIndexOf` nimmt eine negative Startstelle als 0 und
 * fände bei einem Text, der mit einem Umbruch beginnt, genau diesen – die
 * Schreibmarke ganz vorn läge dann scheinbar in der zweiten Zeile.
 */
const lineStartAt = (v: string, i: number): number => (i <= 0 ? 0 : v.lastIndexOf('\n', i - 1) + 1);
const lineEndAt = (v: string, i: number): number => {
  const n = v.indexOf('\n', i);
  return n < 0 ? v.length : n;
};

/** Enter: nächsten Punkt beginnen oder die Liste beenden. `null` heißt: normales Enter. */
export function enterInList(value: string, selStart: number, selEnd: number): TextEdit | null {
  if (selStart !== selEnd) return null;
  const start = lineStartAt(value, selStart);
  const end = lineEndAt(value, selStart);
  const line = value.slice(start, end);
  const it = item(line);
  // Vor oder im Listenzeichen gilt das normale Enter.
  if (!it || selStart - start < it.prefix) return null;

  if (!line.slice(it.prefix).trim()) {
    if (it.indent) {
      const out = shiftLines(value, selStart, selStart, -1);
      if (out) return out;
    }
    // Ganz außen: das leere Zeichen verschwindet, die Zeile bleibt.
    return { from: start, to: end, text: '', selStart: start, selEnd: start };
  }

  const marker = it.num === null ? it.marker : `${it.num + 1}${it.delim}`;
  const text = `\n${it.indent}${marker}${it.gap}${it.box ? '[ ] ' : ''}`;
  const at = selStart + text.length;
  return { from: selStart, to: selStart, text, selStart: at, selEnd: at };
}

/**
 * Tab (`dir` 1) oder Umschalt+Tab (`dir` -1) für die Zeilen der Auswahl.
 * `null`, wenn die Zeile mit der Schreibmarke kein Listenpunkt ist – dann
 * bleibt Tab, was es war.
 */
export function tabInList(value: string, selStart: number, selEnd: number, dir: 1 | -1): TextEdit | null {
  const first = lineStartAt(value, selStart);
  if (!item(value.slice(first, lineEndAt(value, first)))) return null;
  return shiftLines(value, selStart, selEnd, dir);
}

/**
 * Alt und Pfeil hoch/runter: die Zeile der Schreibmarke mit ihrer Nachbarin
 * tauschen – bei einer Markierung der ganze Block. Sie behält dabei ihren Text
 * unverändert, es ändert sich nur die Reihenfolge; die Markierung wandert mit,
 * sonst verlöre man beim zweiten Druck, was man gerade verschiebt.
 *
 * `null` heißt: am Rand angekommen, es geht nicht weiter.
 */
export function moveLines(value: string, selStart: number, selEnd: number, dir: 1 | -1): TextEdit | null {
  const from = lineStartAt(value, selStart);
  const to = lineEndAt(value, selEnd);
  const block = value.slice(from, to);

  if (dir === -1) {
    if (from === 0) return null;
    const above = lineStartAt(value, from - 1);
    const shift = from - above;
    return {
      from: above,
      to,
      text: `${block}\n${value.slice(above, from - 1)}`,
      selStart: selStart - shift,
      selEnd: selEnd - shift,
    };
  }

  if (to >= value.length) return null;
  const below = lineEndAt(value, to + 1);
  const next = value.slice(to + 1, below);
  const shift = next.length + 1;
  return {
    from,
    to: below,
    text: `${next}\n${block}`,
    selStart: selStart + shift,
    selEnd: selEnd + shift,
  };
}

function shiftLines(value: string, selStart: number, selEnd: number, dir: 1 | -1): TextEdit | null {
  const from = lineStartAt(value, selStart);
  const to = lineEndAt(value, selEnd);
  const before = value.slice(0, from).split('\n');
  // Die Zeilen davor – als Maßstab für die Einrückung, laufend mit den geänderten.
  const above = from > 0 ? before.slice(0, -1) : [];
  const lines = value.slice(from, to).split('\n');

  let changed = false;
  const out: string[] = [];

  for (const line of lines) {
    const it = item(line);
    let next = line;
    if (it) {
      const width = it.indent.length;
      const target = dir === 1 ? indentFor(above, width) : outdentFor(above, width);
      if (target !== null && target !== width) {
        const rest = line.slice(width + it.marker.length);
        const num = it.num === null ? null : numberAt(above, target);
        const marker = num === null ? it.marker : `${num}${it.delim}`;
        next = ' '.repeat(target) + marker + rest;
        changed = true;
      }
    }
    out.push(next);
    above.push(next);
  }
  if (!changed) return null;

  /**
   * Eine Stelle im alten Text auf den neuen abbilden: geändert wird nur der
   * Zeilenanfang, also wandert die Stelle um die Längenänderung ihrer Zeile
   * und aller Zeilen davor – aber nie vor den Anfang ihrer Zeile.
   */
  const map = (pos: number): number => {
    let oldStart = from;
    let newStart = from;
    for (let i = 0; i < lines.length; i++) {
      const oldLen = (lines[i] as string).length;
      const newLen = (out[i] as string).length;
      if (pos <= oldStart + oldLen || i === lines.length - 1) {
        const at = newStart + (pos - oldStart) + (newLen - oldLen);
        return Math.max(newStart, Math.min(newStart + newLen, at));
      }
      oldStart += oldLen + 1;
      newStart += newLen + 1;
    }
    return pos;
  };

  return { from, to, text: out.join('\n'), selStart: map(selStart), selEnd: map(selEnd) };
}

/** Der nächste Listenpunkt darüber, der höchstens so tief steht wie `width`. */
function parentItem(above: string[], width: number, strict: boolean): Item | null {
  for (let i = above.length - 1; i >= 0; i--) {
    const line = above[i] as string;
    if (!line.trim()) continue;
    const it = item(line);
    if (!it) return null;
    const w = it.indent.length;
    if (strict ? w < width : w <= width) return it;
  }
  return null;
}

/** Einrücken: unter den Inhalt des Punktes darüber. Ohne Punkt darüber: zwei Leerzeichen. */
function indentFor(above: string[], width: number): number {
  const sibling = parentItem(above, width, false);
  if (!sibling) return width + 2;
  return sibling.indent.length + contentWidth(sibling) > width
    ? sibling.indent.length + contentWidth(sibling)
    : width + 2;
}

/** Ausrücken: auf die Tiefe des übergeordneten Punktes. */
function outdentFor(above: string[], width: number): number | null {
  if (!width) return null;
  const parent = parentItem(above, width, true);
  return parent ? parent.indent.length : 0;
}

/** Die passende Nummer auf der neuen Ebene: eins weiter als der Punkt davor, sonst 1. */
function numberAt(above: string[], width: number): number {
  for (let i = above.length - 1; i >= 0; i--) {
    const line = above[i] as string;
    if (!line.trim()) continue;
    const it = item(line);
    if (!it) break;
    const w = it.indent.length;
    if (w < width) break;
    if (w === width) return it.num === null ? 1 : it.num + 1;
  }
  return 1;
}
