import type { Status, Task } from './model.js';
import type { Workspace } from './workspace.js';

/** Noch nicht angefangen: offen oder fertig geplant. */
const notStarted = (s: Status): boolean => s === 'open' || s === 'ready';

/**
 * Wie sich der Status einer Eltern-Aufgabe ändert, wenn eine ihrer Unteraufgaben
 * einen neuen Status bekommt (Wunsch des Nutzers):
 *
 * - Geht eine Unteraufgabe in Arbeit oder wird erledigt, ist die offene oder
 *   bereite Eltern-Aufgabe „In Progress“.
 * - Ist keine Unteraufgabe mehr angefangen, fällt die Eltern-Aufgabe zurück:
 *   auf „Bereit“, wenn alle bereit sind, sonst auf „Offen“. Eine Eltern-Aufgabe,
 *   die selbst noch nicht angefangen ist, bleibt dabei, wie sie ist.
 * - Sind alle erledigt, wird die Eltern-Aufgabe **nicht** von selbst erledigt –
 *   das bleibt eine eigene Entscheidung.
 * - Wird bei einer erledigten Eltern-Aufgabe eine Unteraufgabe wieder
 *   aufgemacht, ist sie nicht mehr erledigt.
 *
 * „Unklar“ und „Blockiert“ werden nur ausdrücklich gesetzt und bleiben stehen.
 * `kids` sind die Status aller (nicht archivierten) direkten Unteraufgaben,
 * die geänderte schon mit ihrem neuen Status. `null` heißt: bleibt, wie es ist.
 */
export function parentStatusAfter(parent: Status, child: Status, kids: readonly Status[]): Status | null {
  if (!notStarted(parent) && parent !== 'progress' && parent !== 'done') return null;
  if (kids.length && kids.every(notStarted)) {
    if (notStarted(parent)) return null;
    return kids.every((s) => s === 'ready') ? 'ready' : 'open';
  }
  if (notStarted(parent) && (child === 'progress' || child === 'done')) return 'progress';
  if (parent === 'done' && child !== 'done') return 'progress';
  return null;
}

/**
 * Was ein Task zusätzlich zu seinem eigenen Status anzeigt, abgeleitet aus
 * allen (nicht archivierten) Nachfahren – nur Anzeige, nichts wird gespeichert:
 *
 * - Ist eine Unteraufgabe blockiert, erscheint ein offener, bereiter oder
 *   laufender Task blockiert; sonst bei einer unklaren Unteraufgabe unklar.
 *   Blockiert gewinnt.
 * - Ein offener oder bereiter Task, unter dem gearbeitet wird, erscheint in Arbeit.
 * - Ein bereiter Task mit einer noch offenen Unteraufgabe erscheint offen –
 *   fertig geplant ist er erst, wenn alles darunter es ist.
 *
 * `null` heißt: nur der eigene Status zählt.
 */
export function implicitStatus(ws: Workspace, t: Task): Status | null {
  if (!notStarted(t.status) && t.status !== 'progress') return null;
  const desc = ws.desc(t);
  if (desc.some((d) => d.status === 'blocked')) return 'blocked';
  if (desc.some((d) => d.status === 'unclear')) return 'unclear';
  if (notStarted(t.status) && desc.some((d) => d.status === 'progress')) return 'progress';
  if (t.status === 'ready' && desc.some((d) => d.status === 'open')) return 'open';
  return null;
}
