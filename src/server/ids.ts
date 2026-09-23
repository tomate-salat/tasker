import { randomBytes } from 'node:crypto';

/**
 * IDs behalten das Präfix aus dem Prototyp ('t' für Task, 'm' für Milestone …).
 * Das ist beim Lesen von Logs und beim Debuggen in der Datenbankdatei viel wert
 * und kostet nichts.
 */
export type IdPrefix = 'p' | 'c' | 'k' | 'g' | 'm' | 't' | 'd' | 'x' | 'o';

export const newId = (prefix: IdPrefix): string => prefix + randomBytes(9).toString('base64url');
