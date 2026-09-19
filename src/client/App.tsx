import { useEffect, useState } from 'react';
import { api, type Account } from './api.js';
import { Login } from './Login.js';

type Status = { database: string; boots: number; firstBootAt: string };

/**
 * Bis die eigentliche Oberfläche aus dem Prototyp übernommen ist, zeigt die
 * angemeldete Ansicht nur, dass Anmeldung, Server und Datenbank zusammenspielen.
 */
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
  return <SignedIn account={account} onLogout={() => setAccount(null)} />;
}

function SignedIn({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .status()
      .then(setStatus)
      .catch((e: Error) => setError(e.message));
  }, []);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  return (
    <main className="boot">
      <h1>Tasker</h1>
      <p className="lead">
        Angemeldet als {account.avatar} {account.name}. Die Oberfläche kommt aus dem Prototyp.
      </p>

      {error && <p className="bad">{error}</p>}

      {status && (
        <dl>
          <dt>Konto</dt>
          <dd>{account.email}</dd>
          <dt>Datenbank</dt>
          <dd>{status.database}</dd>
          <dt>Starts</dt>
          <dd>
            {status.boots}
            {status.boots > 1 && ' – die Daten haben den Neustart überlebt'}
          </dd>
          <dt>Erster Start</dt>
          <dd>{new Date(status.firstBootAt).toLocaleString('de-DE')}</dd>
        </dl>
      )}

      <p className="actions">
        <button className="btn" onClick={logout}>
          Abmelden
        </button>
      </p>
    </main>
  );
}
