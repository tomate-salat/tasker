import { useEffect } from 'react';
import { useState } from 'react';
import { api, type Account } from './api.js';
import { connectEvents } from './events.js';
import { Login } from './Login.js';
import { useStore, VIEWS, VIEW_LABEL } from './store.js';
import { Inspector } from './ui/Inspector.js';
import { Sidebar } from './ui/Sidebar.js';
import { NewThing } from './ui/NewThing.js';
import { QuickAdd } from './ui/QuickAdd.js';
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
  return <Shell account={account} onLogout={() => setAccount(null)} />;
}

function Shell({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const {
    ws,
    projectId,
    view,
    setView,
    selected,
    loading,
    error,
    toast,
    load,
    say,
    addTask,
    settings,
    setVelocity,
    live,
  } = useStore();

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

  const project = ws.project(projectId);
  // Der ausgewählte Milestone, sonst der erste des Projekts.
  const planTarget =
    ws.milestone(selected)?.id ?? ws.milestones.find((m) => m.projectId === projectId)?.id ?? null;

  return (
    <div id="app" className={selected ? 'with-detail' : ''}>
      <Sidebar ws={ws} account={account} onLogout={() => void logout()} />

      <main id="main">
        <header id="head">
          <h1>{project?.name ?? 'Projekt'}</h1>

          {offline && (
            <span className="offline" title="Änderungen von anderen Geräten kommen gerade nicht an.">
              offline
            </span>
          )}

          <nav className="tabs">
            {VIEWS.map((v) => (
              <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
                {VIEW_LABEL[v]}
              </button>
            ))}
          </nav>

          {view === 'plan' && (
            <label className="vel" title="Aufgaben pro Woche – Grundlage der Prognose">
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
            </label>
          )}

          {view === 'plan' && (
            <NewThing
              label="+ Milestone"
              placeholder="Titel des Milestones"
              onCreate={(title) => useStore.getState().addMilestone(title)}
            />
          )}

          {view === 'backlog' && (
            <NewThing
              label="+ Gruppe"
              placeholder="Name der Gruppe"
              onCreate={(title) => useStore.getState().addGroup(title)}
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
              + {view === 'docs' ? 'Dokument' : 'Aufgabe'}
            </button>
          )}
        </header>

        {(view === 'plan' || view === 'backlog' || view === 'docs') && (
          <>
            <QuickAdd ws={ws} projectId={projectId} />
            <Outline ws={ws} projectId={projectId} view={view} />
          </>
        )}
        {view === 'archive' && <ArchiveView projectId={projectId} />}
        {view === 'trash' && <TrashView />}
      </main>

      {selected && <Inspector ws={ws} id={selected} />}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
