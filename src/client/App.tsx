import { useEffect, useState } from 'react';
import { api, type Account } from './api.js';
import { Login } from './Login.js';
import { useStore } from './store.js';
import { Inspector } from './ui/Inspector.js';
import { List } from './ui/List.js';
import { Sidebar } from './ui/Sidebar.js';

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
  return <Workspace account={account} onLogout={() => setAccount(null)} />;
}

function Workspace({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const { ws, projectId, selected, loading, error, toast, load, say, addTask } = useStore();

  useEffect(() => {
    void load();
  }, [load]);

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
        <p className="muted">Die Anlage von Projekten kommt mit dem nächsten Schritt.</p>
      </main>
    );
  }

  const project = ws.project(projectId);

  return (
    <div id="app" className={selected ? 'with-detail' : ''}>
      <Sidebar ws={ws} account={account} onLogout={() => void logout()} />

      <main id="main">
        <header id="head">
          <h1>{project?.name ?? 'Projekt'}</h1>
          <button
            className="btn"
            onClick={() => void addTask({ projectId, title: 'Neue Aufgabe' })}
          >
            + Aufgabe
          </button>
        </header>
        <List ws={ws} projectId={projectId} />
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
