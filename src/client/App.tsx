import { useEffect, useState } from 'react';
import { api, type Account } from './api.js';
import { connectEvents } from './events.js';
import { Login } from './Login.js';
import { currentProjectId, TABS, useStore, VIEW_LABEL } from './store.js';
import { CategoriesDialog, HelpDialog, MarksDialog, ProfileDialog } from './ui/dialogs.js';
import { SIDE_ICON } from './ui/icons.js';
import { Inspector } from './ui/Inspector.js';
import { NewThing } from './ui/NewThing.js';
import { QuickAdd } from './ui/QuickAdd.js';
import { Sidebar } from './ui/Sidebar.js';
import { ArchiveView, Outline, TrashView } from './ui/views.js';

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

/** Welcher Dialog gerade offen ist – immer höchstens einer. */
type Dialog = 'none' | 'categories' | 'marks' | 'profile' | 'help';

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
  const { ws, view, setView, selected, loading, error, toast, load, say, addTask, live, scope } =
    state;
  const projectId = currentProjectId(state);
  const [dialog, setDialog] = useState<Dialog>('none');

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
      if (e.key === '?') setDialog((d) => (d === 'help' ? 'none' : 'help'));
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
  // Der ausgewählte Milestone, sonst der erste des Projekts.
  const planTarget =
    ws.milestone(selected)?.id ?? ws.milestones.find((m) => m.projectId === projectId)?.id ?? null;

  return (
    <div className={`app ${selected ? 'with-detail' : ''} ${state.sideCollapsed ? 'side-collapsed' : ''}`}>
      <Sidebar
        ws={ws}
        account={account}
        onProfile={() => setDialog('profile')}
        onManageCategories={() => setDialog('categories')}
        onManageMarks={() => setDialog('marks')}
        onHelp={() => setDialog('help')}
      />

      <main className="main">
        <header className="mhead">
          {state.sideCollapsed && (
            <button
              className="menu-btn"
              onClick={state.toggleSide}
              title="Seitenleiste ausklappen ( [ )"
              aria-label="Seitenleiste ausklappen"
            >
              {SIDE_ICON}
            </button>
          )}

          <h1>{title}</h1>

          {offline && (
            <span className="offline" title="Änderungen von anderen Geräten kommen gerade nicht an.">
              offline
            </span>
          )}

          <nav className="tabs" aria-label="Ansicht">
            {TABS.map((v) => (
              <button key={v} className={`tab ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}

            <span className="tab-actions">
              {view === 'plan' && (
                <NewThing
                  label="+ Milestone"
                  placeholder="Titel des Milestones"
                  onCreate={async (t) => void (await useStore.getState().addMilestone(t))}
                />
              )}
              {(view === 'plan' || view === 'backlog' || view === 'docs') && (
                <button
                  className="btn"
                  onClick={() =>
                    void addTask({
                      projectId,
                      title: '',
                      ...(view === 'docs' ? { doc: true } : {}),
                      // In der Planansicht gehört eine neue Aufgabe in einen Milestone,
                      // sonst landet sie unsichtbar im Backlog.
                      ...(view === 'plan' && planTarget ? { milestoneId: planTarget } : {}),
                    }).then((id) => id && useStore.getState().edit(id))
                  }
                >
                  + {view === 'docs' ? 'Seite' : 'Aufgabe'}
                </button>
              )}
            </span>
          </nav>
        </header>

        <FilterBar ws={ws} />

        {(view === 'plan' || view === 'backlog' || view === 'docs') && (
          <>
            <QuickAdd ws={ws} projectId={projectId} />
            <Outline ws={ws} view={view} onManageMarks={() => setDialog('marks')} />
          </>
        )}
        {view === 'archive' && <ArchiveView />}
        {view === 'trash' && <TrashView />}
      </main>

      {selected && <Inspector ws={ws} id={selected} />}

      {dialog === 'categories' && (
        <CategoriesDialog ws={ws} projectId={projectId} onClose={() => setDialog('none')} />
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
          {toast}
        </div>
      )}
    </div>
  );
}

/** Zeigt die gesetzten Filter als Chips, ein Klick nimmt sie zurück. */
function FilterBar({ ws }: { ws: import('@shared/workspace.js').Workspace }) {
  const { filter, setFilter, settings, setVelocity, view } = useStore();
  const category = ws.category(filter.categoryId ?? null);
  const mark = ws.mark(filter.markId ?? null);
  const any = filter.tag || category || mark;

  if (!any && view !== 'plan') return null;

  return (
    <div className="toolbar">
      {filter.tag && (
        <button className="tag" onClick={() => setFilter({ tag: null })} title="Filter entfernen">
          #{filter.tag} ×
        </button>
      )}
      {category && (
        <button
          className="tag filter-mark"
          onClick={() => setFilter({ categoryId: null })}
          title="Filter entfernen"
        >
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

      <span className="spacer" />

      {view === 'plan' && (
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
      )}
    </div>
  );
}
