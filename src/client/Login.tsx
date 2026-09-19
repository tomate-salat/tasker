import { useState, type FormEvent } from 'react';
import { api, type Account } from './api.js';

/** Übernimmt Aufbau und Gestaltung des Login-Screens aus dem Prototyp. */
export function Login({ onDone }: { onDone: (account: Account) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) return setError('Bitte E-Mail eingeben.');
    if (!password) return setError('Bitte Passwort eingeben.');

    setBusy(true);
    setError(null);
    try {
      const { account } = await api.login(email, password, keep);
      onDone(account);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anmeldung fehlgeschlagen.');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">Tasker</div>
        <h1>Anmelden</h1>
        <p className="muted lead-sm">Deine Projekte liegen auf deinem eigenen Server.</p>

        <label className="field">
          <span>E-Mail</span>
          <input
            type="email"
            autoComplete="username"
            placeholder="du@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </label>

        <label className="field">
          <span>Passwort</span>
          <input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>

        {error && (
          <p className="login-err" role="alert">
            {error}
          </p>
        )}

        <label className="check-row">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          Angemeldet bleiben
        </label>

        <button className="btn primary login-go" type="submit" disabled={busy}>
          {busy ? 'Moment …' : 'Anmelden'}
        </button>
      </form>
    </div>
  );
}
