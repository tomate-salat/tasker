import type { Status, Task } from './model.js';
import type { Workspace } from './workspace.js';

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

/**
 * Was ein Task zusätzlich zu seinem eigenen Status anzeigt, abgeleitet aus
 * allen (nicht archivierten) Nachfahren – nur Anzeige, nichts wird gespeichert:
 *
 * - Ist eine Unteraufgabe blockiert, erscheint ein offener oder laufender Task
 *   blockiert; sonst bei einer unklaren Unteraufgabe unklar. Blockiert gewinnt.
 * - Ein offener Task, unter dem gearbeitet wird, erscheint in Arbeit.
 *
 * `null` heißt: nur der eigene Status zählt.
 */
export function implicitStatus(ws: Workspace, t: Task): Status | null {
  if (t.status !== 'open' && t.status !== 'progress') return null;
  const desc = ws.desc(t);
  if (desc.some((d) => d.status === 'blocked')) return 'blocked';
  if (desc.some((d) => d.status === 'unclear')) return 'unclear';
  if (t.status === 'open' && desc.some((d) => d.status === 'progress')) return 'progress';
  return null;
}
