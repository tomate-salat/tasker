import { useEffect, useState } from 'react';
import { api, type Account } from './api.js';
import { connectEvents } from './events.js';
import { Login } from './Login.js';
import { doneCandidates } from '@shared/outline.js';
import {
  archiveWorkspace,
  currentProjectId,
  scopeProjectIds,
  TABS,
  useStore,
  VIEW_LABEL,
  type View,
} from './store.js';
import { dropTarget, useZone } from './ui/dnd.js';
import { CategoriesDialog, HelpDialog, MarksDialog, ProfileDialog } from './ui/dialogs.js';
import { categoryHue } from './ui/colors.js';
import { SIDE_ICON } from './ui/icons.js';
import { tagStyle } from './ui/rows.js';
import { Inspector } from './ui/Inspector.js';
import { NewThing } from './ui/NewThing.js';
import { QuickAdd } from './ui/QuickAdd.js';
import { BulkBar } from './ui/BulkBar.js';
import { BadgeDrawingEditor } from './ui/Drawings.js';
import { MultiDetail } from './ui/MultiDetail.js';
import { Sidebar } from './ui/Sidebar.js';
import { Gallery } from './ui/Gallery.js';
import { Timeline } from './ui/Timeline.js';
import { ArchiveBar, ArchiveView, TrashBar, TrashView } from './ui/archive.js';
import { useGlobalKeys } from './ui/keys.js';
import { Outline } from './ui/views.js';
import { LayoutSwitch } from './ui/Cards.js';

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => setAccount(r.account))
      .catch(() => setAccount(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <main className="boot" />;
  if (!account) return <Login onDone={setAccount} />;
  return <Shell account={account} onAccount={setAccount} onLogout={() => setAccount(null)} />;
}

function Shell({
  account,
  onAccount,
  onLogout,
}: {
  account: Account;
  onAccount: (a: Account) => void;
  onLogout: () => void;
}) {
  const state = useStore();
  const { ws, view, setView, selected, loading, error, toast, load, say, addTask, live, scope, multi } =
    state;
  const projectId = currentProjectId(state);
  // Der Dialog liegt im Speicher, weil ihn auch die Kontextmenüs öffnen.
  const { dialog, setDialog } = state;

  // Ein kurzer Aussetzer beim Verbinden ist normal und soll nichts melden.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (live) {
      setOffline(false);
      return;
    }
    const t = setTimeout(() => setOffline(true), 3000);
    return () => clearTimeout(t);
  }, [live]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rückgängig, Escape und die Schnellerfassung gelten in jeder Ansicht.
  useGlobalKeys();

  // Änderungen aus anderen Tabs und Geräten kommen über den Strom herein.
  useEffect(() => connectEvents(), []);

  // Kurzmeldungen verschwinden von selbst wieder.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => say(null), 4000);
    return () => clearTimeout(t);
  }, [toast, say]);

  // Kürzel, die überall gelten: Hilfe und Seitenleiste.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '?') {
        const s = useStore.getState();
        s.setDialog(s.dialog === 'help' ? 'none' : 'help');
      }
      if (e.key === '[') {
        e.preventDefault();
        useStore.getState().toggleSide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  if (loading && !ws) return <main className="boot">Lade …</main>;
  if (error) {
    return (
      <main className="boot">
        <p className="bad">{error}</p>
        <button className="btn" onClick={() => void load()}>
          Nochmal versuchen
        </button>
      </main>
    );
  }
  if (!ws || !projectId) {
    return (
      <main className="boot">
        <p>Noch kein Projekt vorhanden.</p>
        <p className="muted">Leg eines an, dann geht es los.</p>
        <NewThing
          label="+ Projekt"
          placeholder="Name des Projekts"
          startOpen
          onCreate={(name) => useStore.getState().addProject(name)}
        />
      </main>
    );
  }

  const title = scope === 'all' ? 'Alle Projekte' : (ws.project(scope)?.name ?? 'Projekt');

  return (
    <>
      <div
        className={`app ${selected || multi.size > 1 ? 'with-detail' : ''} ${
          state.sideCollapsed ? 'side-collapsed' : ''
        } ${state.sideOpen ? 'side-open' : ''}`}
      >
        <Sidebar
          ws={ws}
          account={account}
          onProfile={() => setDialog('profile')}
          onManageCategories={() => state.openCategories()}
          onManageMarks={() => setDialog('marks')}
          onHelp={() => setDialog('help')}
        />

        <main className="main">
          <header className="mhead">
            {/* Die CSS blendet ihn aus, solange die Seitenleiste am Desktop offen ist. */}
            <button
              className="menu-btn"
              onClick={state.toggleSide}
              title="Seitenleiste ausklappen ( [ )"
              aria-label="Seitenleiste ausklappen"
            >
              {SIDE_ICON}
            </button>

            <h1>{title}</h1>

            {offline && (
              <span className="offline" title="Änderungen von anderen Geräten kommen gerade nicht an.">
                offline
              </span>
            )}

            <nav className="tabs" aria-label="Ansicht">
              {TABS.map((v) => (
                <Tab key={v} view={v} on={view === v} onClick={() => setView(v)} />
              ))}

              <span className="tab-actions">
                <LayoutSwitch />
                <ArchiveDone ws={ws} />
                {/* Wie im Prototyp: Aufgaben entstehen über die Schnellerfassung oder
                    in der Liste, der Kopf legt nur Milestones und Seiten an – sofort,
                    mit dem Titel zum Eintippen in der neuen Zeile. */}
                {view === 'plan' && (
                  <button
                    className="btn"
                    title="Neuen Milestone im Plan anlegen"
                    onClick={() =>
                      void useStore
                        .getState()
                        .addMilestone('')
                        .then((id) => id && useStore.getState().edit(id, true))
                    }
                  >
                    + Milestone
                  </button>
                )}
                {view === 'docs' && (
                  <button
                    className="btn"
                    title="Neue Seite anlegen"
                    onClick={() =>
                      void addTask({ projectId, title: '', doc: true }).then(
                        (id) => id && useStore.getState().edit(id, true),
                      )
                    }
                  >
                    + Seite
                  </button>
                )}
              </span>
            </nav>
          </header>

          {/* Die Schnellerfassung steht im Prototyp über der Filterleiste und in jeder Ansicht. */}
          <QuickAdd ws={ws} projectId={projectId} />
          <FilterBar ws={ws} />

          {(view === 'plan' || view === 'ready' || view === 'backlog' || view === 'docs') && (
            <Outline ws={ws} view={view} />
          )}
          {view === 'timeline' && <Timeline ws={ws} />}
          {view === 'bilder' && <Gallery />}
          {view === 'archive' && <ArchiveView />}
          {view === 'trash' && <TrashView ws={ws} />}
        </main>

        {/* Bei mehreren Ausgewählten zeigt der Inspektor sie alle nebeneinander. */}
        {multi.size > 1 ? (
          <MultiDetail ws={ws} />
        ) : (
          selected && (
            // Im Archiv sieht der Inspektor auch das Archivierte.
            <Inspector ws={(view === 'archive' && archiveWorkspace(state)) || ws} id={selected} />
          )
        )}

        <BulkBar ws={ws} />
        <BadgeDrawingEditor />

        {dialog === 'categories' && (
          <CategoriesDialog
            ws={ws}
            projectId={(state.catProject && ws.project(state.catProject)?.id) || projectId}
            onClose={() => setDialog('none')}
          />
        )}
        {dialog === 'marks' && <MarksDialog ws={ws} onClose={() => setDialog('none')} />}
        {dialog === 'profile' && (
          <ProfileDialog
            account={account}
            onAccount={onAccount}
            onLogout={() => void logout()}
            onClose={() => setDialog('none')}
          />
        )}
        {dialog === 'help' && <HelpDialog onClose={() => setDialog('none')} />}

        {toast && (
          <div className="toast" role="status">
            <span>{toast}</span>
            {state.toastUndo && (
              <button onClick={() => void state.undo()} title="Rückgängig (Strg+Z)">
                Rückgängig
              </button>
            )}
            {state.toastLink?.toast === toast && (
              <button
                onClick={() => {
                  // Wie im Prototyp: die Meldung geht zu, dann geht es dorthin.
                  const { run } = state.toastLink!;
                  say(null);
                  run();
                }}
              >
                {state.toastLink.label}
              </button>
            )}
          </div>
        )}
      </div>
      {/* Mobil: ein Tipp neben die offene Seitenleiste schließt sie. */}
      <div className="scrim" onClick={state.toggleSide} />
    </>
  );
}

/** Was man auf einen Reiter ziehen kann – die Titel aus dem Prototyp. */
const TAB_DROP_TITLE: Partial<Record<View, string>> = {
  plan: 'Milestone hierher ziehen = einplanen',
  ready: 'Task hierher ziehen = ready',
  backlog: 'Hierher ziehen = zurück in den Backlog',
  docs: 'Task hierher ziehen = in die Dokumentation',
  archive: 'Hierher ziehen = archivieren',
};

function Tab({ view, on, onClick }: { view: View; on: boolean; onClick: () => void }) {
  const target = { type: 'tab', view } as const;
  const zone = useZone(target);
  const title = TAB_DROP_TITLE[view];
  return (
    <button
      className={`tab ${on ? 'on' : ''} ${zone ? 'dz-on' : ''}`}
      onClick={onClick}
      {...(title ? { title } : {})}
      {...dropTarget(target)}
    >
      {VIEW_LABEL[view]}
    </button>
  );
}

/**
 * „Erledigte archivieren (n)“ neben den Reitern – wie im Prototyp nur in Plan
 * und Backlog, und nur wenn es überhaupt etwas Erledigtes gibt.
 */
function ArchiveDone({ ws }: { ws: import('@shared/workspace.js').Workspace }) {
  const state = useStore();
  const { view, archiveDone } = state;
  if (view !== 'plan' && view !== 'ready' && view !== 'backlog') return null;

  const found = doneCandidates(ws, { view, projectIds: scopeProjectIds(state) });
  const n = found.milestones.length + found.tasks.length;
  if (!n) return null;

  return (
    <button
      className="btn ghost"
      title="Erledigte Milestones und Aufgaben dieser Ansicht archivieren"
      onClick={() => void archiveDone()}
    >
      Erledigte archivieren ({n})
    </button>
  );
}

/** Zeigt die gesetzten Filter als Chips, ein Klick nimmt sie zurück. */
function FilterBar({ ws }: { ws: import('@shared/workspace.js').Workspace }) {
  const { filter, setFilter, settings, setVelocity, view } = useStore();
  const category = ws.category(filter.categoryId ?? null);
  const mark = ws.mark(filter.markId ?? null);
  const any = filter.tag || category || mark;

  if (view === 'archive') return <ArchiveBar />;
  if (view === 'trash') return <TrashBar ws={ws} />;

  // Wie im Prototyp: über dem Zeitplan steht allein das Tempo, sonst die Filter.
  if (view === 'timeline') {
    return (
      <div className="toolbar">
        <label className="ctl" title="Aufgaben pro Woche – Grundlage der Prognose">
          Tempo
          <input
            type="number"
            min={1}
            max={200}
            defaultValue={settings.velocity}
            key={settings.velocity}
            onBlur={(e) => void setVelocity(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          Aufgaben / Woche
        </label>
      </div>
    );
  }

  if (!any) return null;

  // Das Farbfeld hängt wie in der Seitenleiste an der Stelle in der Projektliste.
  const catIndex = category
    ? ws.categories
        .filter((c) => c.projectId === category.projectId)
        .sort((a, b) => a.order - b.order)
        .indexOf(category)
    : -1;

  return (
    <div className="toolbar">
      <span className="sum">Gefiltert:</span>
      {filter.tag && (
        <button
          className="tag"
          style={tagStyle(filter.tag)}
          onClick={() => setFilter({ tag: null })}
          title="Filter entfernen"
        >
          #{filter.tag} ×
        </button>
      )}
      {category && (
        <button
          className="tag filter-mark"
          onClick={() => setFilter({ categoryId: null })}
          title="Filter entfernen"
        >
          <span className="cat-sw" style={{ '--h': categoryHue(catIndex) } as React.CSSProperties} />{' '}
          {category.name} ×
        </button>
      )}
      {mark && (
        <button
          className="tag filter-mark"
          onClick={() => setFilter({ markId: null })}
          title="Filter entfernen"
        >
          {mark.emoji} {mark.name} ×
        </button>
      )}
    </div>
  );
}
