import type { Kind } from './api.js';
import type { Settings } from './model.js';

/**
 * Was der Server über den Änderungs-Strom schickt. Zwei Tabs oder Handy plus
 * Rechner sind der Normalfall, sobald das Tool auf einem Server läuft; ohne
 * Push sähe der zweite Tab noch den Stand von vorhin.
 *
 * Kleine Änderungen tragen das geänderte Objekt bei sich – der Empfänger tauscht
 * es aus und rendert neu. Änderungen, die viele Zeilen auf einmal betreffen
 * (Archivieren, Verschieben eines Astes, Papierkorb), melden nur, dass neu zu
 * laden ist: das ehrlich zu sagen ist billiger, als einen halben Teilbaum
 * einzeln nachzuführen und dabei etwas zu übersehen.
 */
export type ChangeEvent =
  | { type: 'upsert'; kind: Kind; object: unknown }
  | { type: 'delete'; kind: Kind; id: string }
  | { type: 'reload'; reason: string }
  | { type: 'settings'; settings: Settings }
  /** Zeichnungen einer Aufgabe haben sich geändert (Name, Anzahl, Inhalt). */
  | { type: 'drawings'; taskId: string };

/** Jede Nachricht sagt, von welchem Tab sie stammt – der eigene Hall wird übergangen. */
export type Envelope = { id: number; origin: string | null; event: ChangeEvent };

/** Der Header, mit dem ein Tab seine schreibenden Anfragen kennzeichnet. */
export const CLIENT_HEADER = 'x-tasker-client';
