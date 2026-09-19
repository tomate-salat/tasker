import { dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

// Railway setzt PORT selbst und erwartet, dass wir darauf und auf 0.0.0.0 hören.
export const PORT = Number(process.env.PORT ?? 3000);
export const HOST = process.env.HOST ?? '0.0.0.0';

export const PRODUCTION = process.env.NODE_ENV === 'production';

// Das Dateisystem von Railway ist bei jedem Deploy leer. Die Datenbank muss deshalb
// auf einem gemounteten Volume liegen – lokal reicht eine Datei neben dem Projekt.
export const DATABASE_PATH = resolve(process.env.DATABASE_PATH ?? './data/tasker.db');

export function ensureDataDir(): void {
  mkdirSync(dirname(DATABASE_PATH), { recursive: true });
}
