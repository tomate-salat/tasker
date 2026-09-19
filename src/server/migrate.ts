import { existsSync } from 'node:fs';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db } from './db.js';

const FOLDER = 'db/migrations';

/**
 * Wird beim Serverstart aufgerufen, damit ein Railway-Deploy die Migrationen
 * selbst anwendet und kein separater Befehl nötig ist.
 */
export function runMigrations(): void {
  if (!existsSync(FOLDER)) {
    console.log('Keine Migrationen vorhanden – übersprungen.');
    return;
  }
  migrate(db, { migrationsFolder: FOLDER });
  console.log('Migrationen angewendet.');
}

// Auch direkt aufrufbar: npm run db:migrate
if (process.argv[1]?.endsWith('migrate.ts')) runMigrations();
