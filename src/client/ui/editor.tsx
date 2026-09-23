import { enterInList, moveLines, tabInList, type TextEdit } from '@shared/listEdit.js';
import type { Workspace } from '@shared/workspace.js';
import { replaceText, useCaretMenu } from './caretMenu.js';
import { useRefPicker } from './refs.js';

/**
 * Das Beschreibungsfeld etwas klüger als ein nacktes Textfeld – über den
 * Prototyp hinaus (Wunsch des Nutzers):
 *
 * - `$` sucht Aufgaben und Milestones für einen Verweis (`refs.tsx`),
 * - `/` bietet Befehle an (`SLASH_COMMANDS`),
 * - Enter setzt Listen fort, Tab / Umschalt+Tab rücken Listenpunkte ein und
 *   aus (`listEdit.ts`). Umschalt+Enter bricht die Zeile ohne neuen Punkt um.
 * - Alt und Pfeil hoch/runter verschieben die Zeile im Text.
 */

/**
 * Ein Befehl im `/`-Menü. Bisher beginnen alle einen Zeilenanfang; weitere
 * Befehle kommen einfach in die Liste darunter.
 */
export type SlashCommand = {
  id: string;
  label: string;
  /** Rechts im Menü, klein – etwa die eingefügte Schreibweise. */
  hint: string;
  /** Weitere Wörter, unter denen der Befehl gefunden wird. */
  keywords: string[];
  /** Was am Zeilenanfang eingefügt wird. */
  line: string;
};

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: 'todo',
    label: 'TodoListe',
    hint: '- [ ]',
    keywords: ['todo', 'checkliste', 'checkbox', 'aufgaben'],
    line: '- [ ] ',
  },
  {
    id: 'list',
    label: 'Liste',
    hint: '-',
    keywords: ['liste', 'aufzählung', 'punkte', 'bullet'],
    line: '- ',
  },
];

/** Passende Befehle – wessen Name oder Stichwort so anfängt, steht vorn. */
export function slashMatches(query: string): SlashCommand[] {
  const q = query.toLowerCase();
  const rank = (c: SlashCommand): number =>
    !q || c.label.toLowerCase().startsWith(q) || c.keywords.some((k) => k.startsWith(q))
      ? 0
      : c.label.toLowerCase().includes(q)
        ? 1
        : 2;
  return SLASH_COMMANDS.map((c) => ({ c, r: rank(c) }))
    .filter((x) => x.r < 2)
    .sort((a, b) => a.r - b.r)
    .map((x) => x.c);
}

const LIST_ITEM = /^ *(?:[-*+]|\d{1,9}[.)]) +/;

/** Ein Listenzeichen ohne Inhalt – das ersetzt ein Befehl, statt eine neue Zeile zu beginnen. */
const BARE_ITEM = /^( *)(?:[-*+]|\d{1,9}[.)]) +(?:\[[ xX]\] +)?$/;

/**
 * Befehl übernehmen: steht vor dem `/` nichts (oder nur ein leerer
 * Listenpunkt), beginnt der Befehl diese Zeile; sonst eine neue darunter.
 */
function applySlash(el: HTMLTextAreaElement, start: number, end: number, cmd: SlashCommand): void {
  const lineStart = el.value.lastIndexOf('\n', start - 1) + 1;
  const before = el.value.slice(lineStart, start);
  const indent = /^ */.exec(before)?.[0] ?? '';
  if (!before.trim() || BARE_ITEM.test(before)) {
    replaceText(el, lineStart + indent.length, end, cmd.line);
    return;
  }
  const from = lineStart + before.trimEnd().length;
  replaceText(el, from, end, `\n${indent}${cmd.line}`);
}

/** Beim Öffnen steht die Schreibmarke am Ende, nicht am Anfang (Wunsch des Nutzers). */
export function focusAtEnd(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  el.setSelectionRange(el.value.length, el.value.length);
  el.scrollTop = el.scrollHeight;
  // Das Feld wächst mit dem Text – dann soll der Inspektor so weit scrollen, dass das Ende sichtbar ist.
  let box = el.parentElement;
  while (box && !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))) {
    box = box.parentElement;
  }
  if (!box) return;
  const over = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom + 56;
  if (over > 0) box.scrollTop += over;
}

export function useSmartEditor(
  ws: Workspace,
  area: React.RefObject<HTMLTextAreaElement | null>,
  o: { projectId: string | null; self: string | null },
) {
  const refs = useRefPicker(ws, area, o);
  const slash = useCaretMenu<SlashCommand>(area, {
    trigger: /(^|\s)\/([^\s/]{0,30})$/,
    items: slashMatches,
    key: (c) => c.id,
    render: (c) => (
      <>
        <span className="lab">{c.label}</span>
        <span className="no">{c.hint}</span>
      </>
    ),
    apply: applySlash,
  });

  const apply = (el: HTMLTextAreaElement, edit: TextEdit): void =>
    replaceText(el, edit.from, edit.to, edit.text, edit.selStart, edit.selEnd);

  /** Gibt `true` zurück, wenn der Editor die Taste übernommen hat. */
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (refs.onKeyDown(e) || slash.onKeyDown(e)) return true;
    if (e.nativeEvent.isComposing) return false;
    const el = e.currentTarget;

    /**
     * Alt und Pfeil hoch/runter verschieben die Zeile – wie in der Liste, wo
     * dieselbe Kombination die Zeile umsortiert. Auch am Rand bleibt die Taste
     * hier: sonst spränge die Schreibmarke doch noch weg.
     */
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const moved = moveLines(el.value, el.selectionStart, el.selectionEnd, e.key === 'ArrowDown' ? 1 : -1);
      if (moved) apply(el, moved);
      return true;
    }
    if (e.altKey || e.ctrlKey || e.metaKey) return false;
    const edit =
      e.key === 'Enter' && !e.shiftKey
        ? enterInList(el.value, el.selectionStart, el.selectionEnd)
        : e.key === 'Tab'
          ? tabInList(el.value, el.selectionStart, el.selectionEnd, e.shiftKey ? -1 : 1)
          : null;
    // Tab in einem Listenpunkt bleibt im Feld, auch wenn es nicht weiter ein- oder ausrückt.
    const inItem =
      e.key === 'Tab' &&
      LIST_ITEM.test(el.value.slice(el.value.lastIndexOf('\n', el.selectionStart - 1) + 1));
    if (!edit && !inItem) return false;
    e.preventDefault();
    if (edit) apply(el, edit);
    return true;
  };

  const update = (): void => {
    refs.update();
    slash.update();
  };

  return {
    onKeyDown,
    onInput: update,
    onSelect: update,
    onBlur: () => {
      refs.close();
      slash.close();
    },
    node: (
      <>
        {refs.node}
        {slash.node}
      </>
    ),
  };
}
