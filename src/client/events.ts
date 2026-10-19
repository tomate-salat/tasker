import type { Envelope } from '@shared/events.js';
import { CLIENT_ID } from './api.js';
import { useStore } from './store.js';

/**
 * Der Änderungs-Strom. `EventSource` verbindet sich nach einem Abbruch von
 * selbst neu; nach einer Unterbrechung wird einmal komplett nachgeladen, weil
 * die verpassten Meldungen nicht nachgereicht werden.
 *
 * Bekommt ein Neuversuch aber eine Antwort, die kein Strom ist (etwa während
 * eines Deploys), gibt `EventSource` für immer auf – die App stand dann
 * dauerhaft auf „offline“ und bekam keine Änderungen mehr. Deshalb baut sie die
 * Verbindung in dem Fall selbst neu auf, in wachsenden Abständen.
 *
 * Der Strom ist eine Bequemlichkeit, keine Wahrheit: was wirklich vor
 * Datenverlust schützt, ist die Versionsprüfung beim Schreiben.
 */
export function connectEvents(): () => void {
  let source: EventSource | null = null;
  let wasLive = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let delay = RETRY_MIN_MS;
  let stopped = false;

  const open = (): void => {
    retry = null;
    const s = new EventSource(`/api/events?client=${encodeURIComponent(CLIENT_ID)}`);
    source = s;

    s.addEventListener('ready', () => {
      delay = RETRY_MIN_MS;
      const store = useStore.getState();
      store.setLive(true);
      // Nach einer Unterbrechung kann in der Zwischenzeit etwas passiert sein.
      if (wasLive) void store.load();
      wasLive = true;
    });

    s.onmessage = (e: MessageEvent<string>) => {
      let envelope: Envelope;
      try {
        envelope = JSON.parse(e.data) as Envelope;
      } catch {
        return;
      }
      // Der eigene Hall: diese Änderung steht längst im Store.
      if (envelope.origin === CLIENT_ID) return;
      useStore.getState().applyEvent(envelope.event);
    };

    s.onerror = () => {
      useStore.getState().setLive(false);
      // Solange `EventSource` es selbst weiter versucht, bleibt es dabei.
      if (s.readyState !== EventSource.CLOSED || stopped || retry) return;
      s.close();
      retry = setTimeout(open, delay);
      delay = Math.min(delay * 2, RETRY_MAX_MS);
    };
  };

  open();

  return () => {
    stopped = true;
    if (retry) clearTimeout(retry);
    source?.close();
    useStore.getState().setLive(false);
  };
}

/** Erster und längster Abstand, bevor die App einen aufgegebenen Strom neu öffnet. */
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
