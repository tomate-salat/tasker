import { ligatureAt } from '@shared/ligatures.js';
import { replaceText } from './ui/caretMenu.js';

/**
 * Ligaturen in allen Textfeldern der App (`@shared/ligatures.ts`): ein
 * Zuhörer am Dokument statt einer Zeile in jedem Feld. Suchfelder, E-Mail,
 * Passwort und Excalidraw bleiben außen vor.
 */
export function installLigatures(): void {
  let busy = false;
  document.addEventListener('input', (e) => {
    if (busy || !(e instanceof InputEvent) || e.isComposing || e.inputType !== 'insertText') return;
    const el = e.target;
    const field =
      el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && el.type === 'text');
    if (!field || el.closest('.excalidraw')) return;
    if (el.selectionStart === null || el.selectionStart !== el.selectionEnd) return;
    const edit = ligatureAt(el.value, el.selectionStart);
    if (!edit) return;
    busy = true;
    try {
      replaceText(el, edit.from, edit.to, edit.text, edit.selStart, edit.selEnd);
    } finally {
      busy = false;
    }
  });
}
