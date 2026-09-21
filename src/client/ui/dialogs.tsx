import { useEffect, useState } from 'react';
import type { Settings } from '@shared/model.js';
import type { Workspace } from '@shared/workspace.js';
import { api, type Account } from '../api.js';
import { useStore } from '../store.js';
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
  const project = ws.project(projectId);
  const categories = ws.categories
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.order - b.order);
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
      {categories.length ? (
        <div className="mk-list">
          {categories.map((c, i) => (
            <div className="mk-row" key={c.id}>
              <span className="cat-sw" style={{ '--h': categoryHue(i) } as React.CSSProperties} />
              <NameInput
                value={c.name}
                onCommit={(next) => void patch('category', c.id, { name: next })}
              />
              <span className="mk-count">
                {ws.tasks.filter((t) => t.categoryId === c.id).length} Tasks
              </span>
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
  const { settings, setVelocity, say, setTheme } = useStore();

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

      <h3>Passwort</h3>
      <PasswordForm />

      <h3>Sitzung</h3>
      <button className="btn ghost" onClick={onLogout}>
        Abmelden
      </button>
    </Modal>
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
        <dd>Neuer Task auf gleicher Ebene (auf einem Milestone: neuer Task darin)</dd>
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
          <kbd>Leertaste</kbd>
        </dt>
        <dd>Erledigt umschalten</dd>
        <dt>
          <kbd>S</kbd>
        </dt>
        {/* Abweichung vom Prototyp, auf Wunsch: Unklar und Blockiert nur ausdrücklich. */}
        <dd>Nächster Status: Offen → In Progress → Erledigt</dd>
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
          Tab „Backlog“ = Unsortiert · auf Projekt = in dessen Backlog
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
