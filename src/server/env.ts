import { dirname, isAbsolute, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

// Railway setzt PORT selbst und erwartet, dass wir darauf und auf 0.0.0.0 hören.
export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';

export const PRODUCTION = process.env.NODE_ENV === 'production';

// Das Dateisystem von Railway ist bei jedem Deploy leer. Die Datenbank muss deshalb
// auf einem gemounteten Volume liegen – lokal reicht eine Datei neben dem Projekt.
const RAW_DATABASE_PATH = process.env.DATABASE_PATH ?? './data/tasker.db';
export const DATABASE_PATH = resolve(RAW_DATABASE_PATH);

export function ensureDataDir(): void {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
}

/**
 * Ein relativer Pfad landet im Container-Dateisystem und ist nach dem nächsten
 * Deploy weg. Das fällt sonst erst auf, wenn die Daten schon fehlen.
 */
export function warnIfNotPersistent(): void {
  if (!PRODUCTION) return;
  if (!isAbsolute(RAW_DATABASE_PATH)) {
    console.warn(
      `WARNUNG: DATABASE_PATH ist relativ ("${RAW_DATABASE_PATH}") und zeigt damit auf ${DATABASE_PATH}. ` +
        'Liegt das nicht auf einem gemounteten Volume, sind die Daten nach dem nächsten Deploy verloren. ' +
        'Setze DATABASE_PATH auf den absoluten Mount-Pfad des Volumes, z.B. /data/tasker.db.',
    );
  }
}
