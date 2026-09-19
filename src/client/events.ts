import type { Envelope } from '@shared/events.js';
import { CLIENT_ID } from './api.js';
import { useStore } from './store.js';

/**
 * Der Änderungs-Strom. `EventSource` verbindet sich nach einem Abbruch von
 * selbst neu; nach einer Unterbrechung wird einmal komplett nachgeladen, weil
 * die verpassten Meldungen nicht nachgereicht werden.
 *
 * Der Strom ist eine Bequemlichkeit, keine Wahrheit: was wirklich vor
 * Datenverlust schützt, ist die Versionsprüfung beim Schreiben.
 */
export function connectEvents(): () => void {
  const source = new EventSource(`/api/events?client=${encodeURIComponent(CLIENT_ID)}`);
  let wasLive = false;

  source.addEventListener('ready', () => {
    const store = useStore.getState();
    store.setLive(true);
    // Nach einer Unterbrechung kann in der Zwischenzeit etwas passiert sein.
    if (wasLive) void store.load();
    wasLive = true;
  });

  source.onmessage = (e: MessageEvent<string>) => {
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

  source.onerror = () => useStore.getState().setLive(false);

  return () => {
    source.close();
    useStore.getState().setLive(false);
  };
}
