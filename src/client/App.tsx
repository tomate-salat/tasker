import { useEffect, useState } from 'react';

type Health = {
  ok: boolean;
  now: string;
  database: string;
  boots: number;
  firstBootAt: string;
};

/**
 * Platzhalter-Oberfläche. Sie zeigt nur, dass Client und Server im selben
 * Deploy zusammenspielen und die Datenbank den Neustart überlebt hat.
 * Die eigentliche App entsteht in den nächsten Schritten aus dem Prototyp.
 */
export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="boot">
      <h1>Tasker</h1>
      <p className="lead">Das Gerüst steht. Die Oberfläche kommt aus dem Prototyp.</p>

      {error && <p className="bad">Server nicht erreichbar: {error}</p>}
      {!health && !error && <p className="muted">Verbinde …</p>}

      {health && (
        <dl>
          <dt>Server</dt>
          <dd className="good">erreichbar</dd>
          <dt>Datenbank</dt>
          <dd>{health.database}</dd>
          <dt>Starts</dt>
          <dd>
            {health.boots}
            {health.boots > 1 && ' – die Daten haben den Neustart überlebt'}
          </dd>
          <dt>Erster Start</dt>
          <dd>{new Date(health.firstBootAt).toLocaleString('de-DE')}</dd>
        </dl>
      )}
    </main>
  );
}
