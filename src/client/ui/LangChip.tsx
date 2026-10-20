import { useDictationLang } from './dictation.js';

/**
 * Das Kürzel neben dem Mikrofon: in welcher Sprache diktiert wird. Ein Klick
 * stellt zwischen Deutsch und Englisch um – für alle Diktierknöpfe zugleich.
 * Es nimmt dem Textfeld den Fokus nicht.
 */
export function LangChip() {
  const [lang, toggle] = useDictationLang();
  const name = lang === 'de' ? 'Deutsch' : 'Englisch';
  return (
    <button
      type="button"
      className="d-lang"
      title={`Diktiert wird auf ${name} – klicken zum Umstellen`}
      aria-label={`Diktiersprache ${name}, umstellen`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={toggle}
    >
      {lang.toUpperCase()}
    </button>
  );
}
