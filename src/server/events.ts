import type { ChangeEvent, Envelope } from '../shared/events.js';

/**
 * Der Änderungs-Verteiler. Ein Prozess, ein Nutzer – deshalb genügt eine Liste
 * von Zuhörern im Speicher; kein Redis, kein Pub/Sub.
 *
 * Verloren gehen darf eine Nachricht trotzdem (abgebrochene Verbindung,
 * schlafendes Handy). Deshalb ist der Strom eine Bequemlichkeit und keine
 * Wahrheit: die Versionsprüfung beim Schreiben bleibt der Schutz gegen stillen
 * Datenverlust.
 */
export class EventBus {
  private listeners = new Set<(e: Envelope) => void>();
  private next = 1;

  subscribe(listener: (e: Envelope) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  publish(event: ChangeEvent, origin: string | null = null): Envelope {
    const envelope: Envelope = { id: this.next++, origin, event };
    for (const l of [...this.listeners]) {
      try {
        l(envelope);
      } catch {
        // Ein hängender Zuhörer darf das Schreiben nicht scheitern lassen.
      }
    }
    return envelope;
  }

  get count(): number {
    return this.listeners.size;
  }
}

/** Der Verteiler der Anwendung. Tests bauen sich ihren eigenen. */
export const appEvents = new EventBus();
