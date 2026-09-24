import { useEffect, useState } from 'react';
import type { CodecksRefsResult, CodecksSummary } from '@shared/api.js';
import type { Settings } from '@shared/model.js';
import { categoriesOf, categoryColorIndex } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { api, type Account } from '../api.js';
import { useStore, usesCards } from '../store.js';
import { CoverSlot } from './Cards.js';
import { categoryHue } from './colors.js';
import { THEME_LABEL } from './icons.js';

/**
 * Die Dialoge aus dem Prototyp: Kategorien, Markierungen, Profil und die
 * Tastenkürzel-Hilfe. Alle liegen als Überlagerung über der Anwendung, Klick
 * daneben und Escape schließen.
 */
function Modal({
  title,
  sub,
  onClose,
  children,
  wide = false,
  closeLabel = 'Fertig',
}: {
  title: string;
  sub?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  /** Die Hilfe schließt im Prototyp mit „Schließen“, die übrigen Dialoge mit „Fertig“. */
  closeLabel?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="help" onClick={onClose}>
      <div
        className={`help-card ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2>{title}</h2>
        {sub && <p className="muted dlg-sub">{sub}</p>}
        {children}
        <p className="dlg-foot">
          <button className="btn" onClick={onClose}>
            {closeLabel}
          </button>
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ Kategorien */

export function CategoriesDialog({
  ws,
  projectId,
  onClose,
}: {
  ws: Workspace;
  projectId: string;
  onClose: () => void;
}) {
  const { patch, remove, say, load } = useStore();
  // Karten: die Vorgaben für Titelbilder gibt es nur, wenn eine Ansicht Karten zeigt.
  const covers = useStore(usesCards);
  const project = ws.project(projectId);
  const categories = categoriesOf(ws, projectId);
  const [name, setName] = useState('');

  async function add(): Promise<void> {
    const value = name.trim();
    if (!value) return;
    if (categories.some((c) => c.name.toLowerCase() === value.toLowerCase())) {
      say(`„${value}“ gibt es schon`);
      return;
    }
    await api.create('category', { projectId, name: value }).catch((e: unknown) => {
      say(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen');
    });
    setName('');
    await load();
  }

  return (
    <Modal
      title="Kategorien"
      sub={`Für das Projekt „${project?.name ?? ''}“. Jeder Task hat höchstens eine Kategorie.`}
      onClose={onClose}
    >
      {covers && project && (
        <div className="mk-row cover-default">
          <CoverSlot owner={{ kind: 'project', item: project }} />
          <span className="hint">
            Titelbild des Projekts – gilt für jede Karte, die weder selbst noch über Markierung oder
            Kategorie eins hat. Die Kategorien unten überschreiben es.
          </span>
        </div>
      )}
      {categories.length ? (
        <div className="mk-list">
          {categories.map((c) => (
            <div className="mk-row" key={c.id}>
              <span
                className="cat-sw"
                style={{ '--h': categoryHue(categoryColorIndex(ws, c)) } as React.CSSProperties}
              />
              <NameInput
                value={c.name}
                onCommit={(next) => void patch('category', c.id, { name: next })}
              />
              <span className="mk-count">
                {ws.tasks.filter((t) => t.categoryId === c.id).length} Tasks
              </span>
              {covers && <CoverSlot owner={{ kind: 'category', item: c }} />}
              <button
                className="icon-btn"
                title="Löschen"
                aria-label={`Kategorie ${c.name} löschen`}
                onClick={() => void remove('category', c.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Noch keine Kategorien.</p>
      )}

      <h3>Neue Kategorie</h3>
      <div className="mk-row">
        <input
          className="mk-in-name"
          placeholder="Name, z.B. Player"
          aria-label="Name der neuen Kategorie"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn" onClick={() => void add()}>
          Hinzufügen
        </button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- Markierungen */

const EMOJI_PICKS = ['🐞', '🔧', '✨', '📐', '🎨', '🎧', '🚀', '📌', '🧪', '📝', '🔒', '⚡'];

export function MarksDialog({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const { patch, remove, say, load } = useStore();
  // Karten: die Vorgaben für Titelbilder gibt es nur, wenn eine Ansicht Karten zeigt.
  const covers = useStore(usesCards);
  const [emoji, setEmoji] = useState('');
  const [name, setName] = useState('');

  async function add(): Promise<void> {
    if (!emoji.trim() || !name.trim()) {
      say('Emoji und Name angeben');
      return;
    }
    await api.create('mark', { emoji: emoji.trim(), name: name.trim() }).catch((e: unknown) => {
      say(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen');
    });
    setEmoji('');
    setName('');
    await load();
  }

  return (
    <Modal
      title="Markierungen"
      sub="Das Emoji steht vor dem Titel. Jeder Task kann eine Markierung haben, sie gelten für alle Projekte."
      onClose={onClose}
    >
      {covers && (
        <p className="hint">
          Das Bild rechts ist die Vorgabe für Titelbilder: es gilt für Karten mit dieser Markierung, sticht
          das Projekt und wird von Kategorie und Task überschrieben.
        </p>
      )}
      <h3>Vorhanden</h3>
      {ws.marks.length ? (
        <div className="mk-list">
          {ws.marks.map((k) => (
            <div className="mk-row" key={k.id}>
              <NameInput
                className="mk-in-emoji"
                value={k.emoji}
                onCommit={(next) => void patch('mark', k.id, { emoji: next })}
              />
              <NameInput value={k.name} onCommit={(next) => void patch('mark', k.id, { name: next })} />
              <span className="mk-count">
                {ws.tasks.filter((t) => t.markId === k.id).length} Tasks
              </span>
              {covers && <CoverSlot owner={{ kind: 'mark', item: k }} />}
              <button
                className="icon-btn"
                title="Löschen"
                aria-label={`Markierung ${k.name} löschen`}
                onClick={() => void remove('mark', k.id)}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="hint">Noch keine Markierungen.</p>
      )}

      <h3>Neue Markierung</h3>
      <div className="mk-row">
        <input
          className="mk-in-emoji"
          placeholder="🙂"
          aria-label="Emoji für neue Markierung"
          maxLength={8}
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
        />
        <input
          className="mk-in-name"
          placeholder="Name, z.B. Feature"
          aria-label="Name der neuen Markierung"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add();
          }}
        />
        <button className="btn" onClick={() => void add()}>
          Hinzufügen
        </button>
      </div>
      <div className="mk-picks">
        {EMOJI_PICKS.map((e) => (
          <button key={e} aria-label={`${e} übernehmen`} onClick={() => setEmoji(e)}>
            {e}
          </button>
        ))}
      </div>
      <p className="hint">
        Tipp: Unter Windows öffnet <kbd>Win</kbd>+<kbd>.</kbd> die Emoji-Auswahl.
      </p>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Profil */

export function ProfileDialog({
  account,
  onAccount,
  onLogout,
  onClose,
}: {
  account: Account;
  onAccount: (account: Account) => void;
  onLogout: () => void;
  onClose: () => void;
}) {
  const { settings, setVelocity, setImageLimits, say, setTheme } = useStore();

  const save = (patch: { name?: string; avatar?: string }): void => {
    void api
      .updateAccount(patch)
      .then((r) => onAccount(r.account))
      .catch((e: unknown) => say(e instanceof Error ? e.message : 'Speichern fehlgeschlagen'));
  };

  return (
    <Modal
      title="Profil & Einstellungen"
      sub="Gilt für diese Instanz – Tasker läuft als Einzelplatz-Installation."
      onClose={onClose}
    >
      <h3>Konto</h3>
      <div className="pf-row">
        <NameInput
          className="avatar-in"
          value={account.avatar}
          onCommit={(avatar) => save({ avatar })}
        />
        <div className="pf-grid">
          <label className="field">
            <span>Name</span>
            <NameInput value={account.name} onCommit={(name) => save({ name })} />
          </label>
          <label className="field">
            <span>E-Mail</span>
            <input value={account.email} readOnly title="Die E-Mail ist die Anmeldung." />
          </label>
        </div>
      </div>
      <p className="pf-hint">
        Avatar: Emoji oder zwei Buchstaben. Die E-Mail ist die Anmeldung und lässt sich hier nicht
        ändern.
      </p>

      <h3>Darstellung</h3>
      <div className="seg" role="radiogroup" aria-label="Darstellung">
        {(['system', 'light', 'dark'] as Settings['theme'][]).map((t) => (
          <button
            key={t}
            className={settings.theme === t ? 'on' : ''}
            role="radio"
            aria-checked={settings.theme === t}
            onClick={() => void setTheme(t)}
          >
            {THEME_LABEL[t]}
          </button>
        ))}
      </div>

      <h3>Planung</h3>
      <label className="field pf-vel">
        <span>Tempo für Prognosen</span>
        <input
          type="number"
          min={1}
          max={200}
          defaultValue={settings.velocity}
          key={settings.velocity}
          onBlur={(e) => void setVelocity(Number(e.target.value))}
        />
      </label>
      <p className="pf-hint">Aufgaben pro Woche – daraus entstehen Zeitplan und Burnup-Prognose.</p>

      <h3>Bilder</h3>
      <label className="field pf-vel">
        <span>Größe je Bild</span>
        <input
          type="number"
          min={50}
          max={5000}
          step={50}
          defaultValue={settings.imageMaxKb}
          key={`kb${settings.imageMaxKb}`}
          onBlur={(e) => void setImageLimits({ imageMaxKb: Number(e.target.value) })}
        />
      </label>
      <label className="field pf-vel">
        <span>Längere Kante</span>
        <input
          type="number"
          min={400}
          max={8000}
          step={160}
          defaultValue={settings.imageMaxEdge}
          key={`px${settings.imageMaxEdge}`}
          onBlur={(e) => void setImageLimits({ imageMaxEdge: Number(e.target.value) })}
        />
      </label>
      <p className="pf-hint">
        Kilobyte und Pixel. Hochgeladene Bilder werden im Browser verkleinert und nach WebP
        umgewandelt, bis sie darunter liegen – erst über die Qualität, dann über die Kantenlänge.
      </p>

      <h3>Passwort</h3>
      <PasswordForm />

      <h3>Import aus Codecks</h3>
      <CodecksImport onDone={onClose} />

      <h3>Codecks-Verweise umwandeln</h3>
      <CodecksRefs onDone={onClose} />

      <h3>Sitzung</h3>
      <button className="btn ghost" onClick={onLogout}>
        Abmelden
      </button>
    </Modal>
  );
}

/**
 * Übergangsweise, solange die Daten aus Codecks herüberkommen: Datei wählen,
 * Vorschau ansehen, bestätigen. Die Vorschau läuft den echten Import und
 * rollt ihn zurück.
 */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

function CodecksImport({ onDone }: { onDone: () => void }) {
  const { say, load } = useStore();
  const [file, setFile] = useState<{ name: string; csv: string } | null>(null);
  const [preview, setPreview] = useState<CodecksSummary | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(f: File | undefined): Promise<void> {
    setPreview(null);
    setFile(null);
    if (!f) return;
    setBusy(true);
    try {
      const csv = await f.text();
      setPreview(await api.importCodecks(csv, true));
      setFile({ name: f.name, csv });
    } catch (e) {
      say(e instanceof Error ? e.message : 'Datei konnte nicht gelesen werden');
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    if (!file) return;
    setBusy(true);
    try {
      const s = await api.importCodecks(file.csv, false);
      await load();
      say(`Importiert: ${s.projects.join(', ')}`);
      onDone();
    } catch (e) {
      say(e instanceof Error ? e.message : 'Import fehlgeschlagen');
      setBusy(false);
    }
  }

  return (
    <>
      <label className="field">
        <span>CSV-Export aus Codecks</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(e) => void pick(e.target.files?.[0])}
        />
      </label>
      {preview ? (
        <>
          <p className="pf-hint">
            Projekt <b>{preview.projects.join(', ')}</b>:{' '}
            {count(preview.tasks, 'Aufgabe', 'Aufgaben')},{' '}
            {count(preview.subtasks, 'Unteraufgabe', 'Unteraufgaben')},{' '}
            {count(preview.docs, 'Doku-Seite', 'Doku-Seiten')}
            {preview.unclear ? `, davon ${preview.unclear} unklar` : ''}.
            {preview.milestones.length > 0 && <> Milestones: {preview.milestones.join(', ')}.</>}
            {preview.categories.length > 0 && <> Kategorien: {preview.categories.join(', ')}.</>}
            {preview.labels.length > 0 && <> Labels: {preview.labels.join(', ')}.</>}
          </p>
          <button className="btn" disabled={busy} onClick={() => void run()}>
            Importieren
          </button>
        </>
      ) : (
        <p className="pf-hint">
          In Codecks Karten auswählen, „Export as CSV“, dazu Content, Project name und Milestone
          ankreuzen. Vor dem Import siehst du, was angelegt wird.
        </p>
      )}
    </>
  );
}

function PasswordForm() {
  const say = useStore((s) => s.say);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setBusy(true);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      say('Passwort geändert');
    } catch (err) {
      say(err instanceof Error ? err.message : 'Passwort konnte nicht geändert werden');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="pf-grid" onSubmit={(e) => void submit(e)}>
      <label className="field">
        <span>Aktuelles Passwort</span>
        <input
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Neues Passwort</span>
        <input
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </label>
      <button className="btn" disabled={busy || !current || next.length < 8}>
        Passwort ändern
      </button>
    </form>
  );
}

/**
 * Codecks-Verweise ($3yw) in schon importierten Texten zu Tasker-Nummern machen.
 * Alle Exporte auf einmal, damit auch Verweise über Projekte hinweg ein Ziel
 * finden. Erst die Vorschau mit jeder einzelnen Änderung, dann umwandeln.
 */
function CodecksRefs({ onDone }: { onDone: () => void }) {
  const { say, load } = useStore();
  const [csvs, setCsvs] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<CodecksRefsResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(files: FileList | null): Promise<void> {
    setPreview(null);
    setCsvs(null);
    if (!files?.length) return;
    setBusy(true);
    try {
      const texts = await Promise.all([...files].map((f) => f.text()));
      setPreview(await api.convertCodecksRefs(texts, true));
      setCsvs(texts);
    } catch (e) {
      say(e instanceof Error ? e.message : 'Dateien konnten nicht gelesen werden');
    } finally {
      setBusy(false);
    }
  }

  async function run(): Promise<void> {
    if (!csvs) return;
    setBusy(true);
    try {
      const r = await api.convertCodecksRefs(csvs, false);
      await load();
      say(`Verweise in ${count(r.texts.length, 'Text', 'Texten')} umgewandelt`);
      onDone();
    } catch (e) {
      say(e instanceof Error ? e.message : 'Umwandeln fehlgeschlagen');
      setBusy(false);
    }
  }

  const changes = preview?.texts.flatMap((t) => t.changes) ?? [];
  const linked = changes.filter((c) => c.link !== null).length;
  const unclear = changes.filter((c) => c.ref === null && c.link === null).length;

  return (
    <>
      <label className="field">
        <span>Alle CSV-Exporte aus Codecks (mehrere auswählbar)</span>
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          disabled={busy}
          onChange={(e) => void pick(e.target.files)}
        />
      </label>
      {!preview && (
        <p className="pf-hint">
          Macht aus Codecks-Verweisen wie $3yw in importierten Beschreibungen Tasker-Verweise. Die
          Karte wird über Projekt und Titel gefunden; gibt es sie nicht eindeutig, wird daraus ein
          Link zur Karte in Codecks. Jedes Projekt wird nur einmal umgewandelt.
        </p>
      )}
      {preview && (
        <>
          <p className="pf-hint">
            {count(changes.length - linked - unclear, 'Verweis wird', 'Verweise werden')} zum
            Tasker-Verweis, {count(linked, 'Verweis wird', 'Verweise werden')} zum Codecks-Link – in{' '}
            {count(preview.texts.length, 'Text', 'Texten')}.
            {unclear > 0 && <> {count(unclear, 'Verweis ist', 'Verweise sind')} unklar und bleiben stehen.</>}
            {preview.skipped.length > 0 && <> Schon umgewandelt: {preview.skipped.join(', ')}.</>}
            {preview.unknownProjects.length > 0 && (
              <> Nicht in Tasker: {preview.unknownProjects.join(', ')}.</>
            )}
          </p>
          {preview.texts.length > 0 && (
            <ul className="refs-preview">
              {preview.texts.map((t) => (
                <li key={t.id}>
                  <b>{t.title || 'Ohne Titel'}</b>
                  {t.changes.map((c, i) => (
                    <div key={i} className={c.ref === null ? 'muted' : ''}>
                      ${c.code} →{' '}
                      {c.ref !== null
                        ? `$${c.ref} „${c.target}“`
                        : c.link
                          ? `Codecks-Link (${c.reason})`
                          : `bleibt (${c.reason})`}
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
          <button className="btn" disabled={busy || !preview.texts.length} onClick={() => void run()}>
            Umwandeln
          </button>
        </>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- Hilfe */

export function HelpDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="Tastenkürzel & Schnell-Erfassung"
      sub="Kürzel wirken, wenn die Liste aktiv ist (Task oder Milestone anklicken)."
      onClose={onClose}
      closeLabel="Schließen"
      wide
    >
      <h3>Liste</h3>
      <dl>
        <dt>
          <kbd>↑</kbd> <kbd>↓</kbd>
        </dt>
        <dd>Auswählen</dd>
        <dt>
          <kbd>←</kbd> <kbd>→</kbd>
        </dt>
        <dd>Zuklappen / Aufklappen</dd>
        <dt>
          <kbd>Enter</kbd>
        </dt>
        <dd>
          Neuer Task auf gleicher Ebene (auf einem Milestone: neuer Task darin). Beim Anlegen
          oder Umbenennen bestätigt Enter nur und öffnet den Task im Inspektor – noch ein Enter
          legt den nächsten an.
        </dd>
        <dt>
          <kbd>Shift</kbd>+<kbd>Enter</kbd>
        </dt>
        <dd>Neue Unteraufgabe</dd>
        <dt>
          <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>
        </dt>
        <dd>Einrücken / Ausrücken</dd>
        <dt>
          <kbd>Alt</kbd>+<kbd>↑</kbd> <kbd>↓</kbd>
        </dt>
        <dd>Verschieben (auch Milestones)</dd>
        <dt>
          <kbd>Leertaste</kbd> / <kbd>Shift</kbd>+<kbd>Leertaste</kbd>
        </dt>
        {/* Abweichung vom Prototyp, auf Wunsch: Unklar und Blockiert nur ausdrücklich. */}
        <dd>Status weiter / zurück: Offen → In Progress → Erledigt</dd>
        <dt>
          <kbd>F2</kbd> / <kbd>E</kbd>
        </dt>
        <dd>Titel bearbeiten</dd>
        <dt>
          <kbd>P</kbd>
        </dt>
        <dd>Milestone in den Plan / zurück in den Backlog</dd>
        <dt>
          <kbd>B</kbd>
        </dt>
        <dd>Task in den Backlog (Unsortiert)</dd>
        <dt>
          <kbd>M</kbd>
        </dt>
        <dd>Task verschieben nach …</dd>
        <dt>
          <kbd>A</kbd>
        </dt>
        <dd>Archivieren (im Archiv: wiederherstellen)</dd>
        <dt>
          <kbd>Entf</kbd>
        </dt>
        <dd>Löschen</dd>
        <dt>
          <kbd>Strg</kbd>+Klick
        </dt>
        <dd>Task zur Auswahl hinzufügen / entfernen</dd>
        <dt>
          <kbd>Shift</kbd>+Klick
        </dt>
        <dd>Bereich auswählen</dd>
        <dt>
          <kbd>Shift</kbd>+<kbd>↑</kbd> <kbd>↓</kbd>
        </dt>
        <dd>Auswahl erweitern</dd>
        <dt>
          <kbd>Strg</kbd>+<kbd>A</kbd>
        </dt>
        <dd>Alle sichtbaren Tasks auswählen</dd>
        <dt>
          Rechtsklick / <kbd>Shift</kbd>+<kbd>F10</kbd>
        </dt>
        <dd>Kontextmenü für Task, Milestone oder Gruppe</dd>
        <dt>
          <kbd>Strg</kbd>+<kbd>Z</kbd>
        </dt>
        <dd>Rückgängig</dd>
        <dt>
          <kbd>N</kbd> / <kbd>/</kbd>
        </dt>
        <dd>Schnell-Erfassung</dd>
        <dt>
          <kbd>[</kbd>
        </dt>
        <dd>Seitenleiste ein-/ausklappen</dd>
        <dt>Zeichnung</dt>
        {/* Der Editor ist Excalidraw: dort gehört Esc dem Editor, fertig ist man mit „Fertig“. */}
        <dd>
          „+ Zeichnung“ im Detail-Panel · im Editor: <kbd>P</kbd> Stift, <kbd>R</kbd> Rechteck,{' '}
          <kbd>O</kbd> Ellipse, <kbd>A</kbd> Pfeil, <kbd>T</kbd> Text, <kbd>Strg</kbd>+<kbd>Z</kbd>,
          „Fertig“ schließt
        </dd>
      </dl>

      <h3>Beschreibung</h3>
      <dl>
        <dt>
          <kbd>Enter</kbd>
        </dt>
        <dd>
          In einer Liste (<code>- </code>, <code>1. </code>, <code>- [ ] </code>) den nächsten Punkt
          beginnen · im leeren Punkt die Liste beenden
        </dd>
        <dt>
          <kbd>Shift</kbd>+<kbd>Enter</kbd>
        </dt>
        <dd>Neue Zeile ohne neuen Punkt</dd>
        <dt>
          <kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd>
        </dt>
        <dd>Listenpunkt ein-/ausrücken</dd>
        <dt>
          <kbd>$</kbd>
        </dt>
        <dd>Verweis auf Task oder Milestone</dd>
        <dt>
          <kbd>/</kbd>
        </dt>
        <dd>Befehle: TodoListe, Liste</dd>
      </dl>

      <h3>Schnell-Erfassung</h3>
      <dl>
        <dt>
          <code>#code</code>
        </dt>
        <dd>Label</dd>
        <dt>
          <code>!1</code> … <code>!3</code>
        </dt>
        <dd>Priorität</dd>
        <dt>
          <code>&amp;player</code>
        </dt>
        <dd>Kategorie des Projekts (Anfang des Namens reicht)</dd>
        <dt>
          <code>%bug</code>
        </dt>
        <dd>
          Markierung (Name oder Anfang davon) – oder den Titel direkt mit dem Emoji beginnen:{' '}
          <code>🐞 Absturz beim Laden</code>
        </dd>
        <dt>
          <code>~progress</code>
        </dt>
        <dd>
          Status (<code>~o</code> Offen, <code>~p</code> In Progress, <code>~b</code> Blockiert,{' '}
          <code>~e</code> Erledigt)
        </dd>
        <dt>
          <code>&gt;Demo</code>
        </dt>
        <dd>
          In Milestone, Backlog-Gruppe oder unter einen Task (Teil des Namens reicht; mit Leerzeichen:{' '}
          <code>&gt;"Nice to"</code>)
        </dd>
        <dt>
          <code>@nach:Hitbox</code>
        </dt>
        <dd>Abhängig von diesem Task</dd>
        <dt>
          <code>+web</code>
        </dt>
        <dd>In dieses Projekt</dd>
      </dl>
      <p className="muted" style={{ fontSize: 13 }}>
        Ohne <code>&gt;</code> landet ein neuer Task im Backlog unter „Unsortiert“.
      </p>

      <h3>Ziehen &amp; Ablegen</h3>
      <dl>
        <dt>Task</dt>
        <dd>
          auf Task: oben/unten = davor/danach, Mitte = hinein · auf Milestone oder Gruppe = hinein · auf
          Tab „Ready“ = ready · auf Tab „Backlog“ = Unsortiert · auf Projekt = in dessen Backlog
        </dd>
        <dt>Milestone</dt>
        <dd>auf Milestone = Reihenfolge · auf Tab „Plan“ / „Backlog“ = einplanen / zurückholen</dd>
        <dt>Gruppe</dt>
        <dd>auf Gruppe = Reihenfolge</dd>
      </dl>
    </Modal>
  );
}

/**
 * Ein Feld, das seinen Wert erst beim Verlassen oder mit Enter übernimmt –
 * sonst schickt jeder Tastendruck eine Änderung an den Server.
 */
function NameInput({
  value,
  onCommit,
  className = 'mk-in-name',
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const commit = (): void => {
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else if (!next) setDraft(value);
  };

  return (
    <input
      className={className}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(value);
      }}
    />
  );
}
