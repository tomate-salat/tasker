import type { Status } from './model.js';

/**
 * Wie sich der Status einer Eltern-Aufgabe ändert, wenn eine ihrer Unteraufgaben
 * einen neuen Status bekommt (Wunsch des Nutzers):
 *
 * - Geht eine Unteraufgabe in Arbeit oder wird erledigt, ist die offene
 *   Eltern-Aufgabe „In Progress“.
 * - Stehen alle Unteraufgaben wieder auf „Offen“, ist es die Eltern-Aufgabe auch.
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
  if (parent !== 'open' && parent !== 'progress' && parent !== 'done') return null;
  if (kids.length && kids.every((s) => s === 'open')) return parent === 'open' ? null : 'open';
  if (parent === 'open' && (child === 'progress' || child === 'done')) return 'progress';
  if (parent === 'done' && child !== 'done') return 'progress';
  return null;
}
