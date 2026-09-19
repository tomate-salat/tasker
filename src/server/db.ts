import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { DATABASE_PATH, ensureDataDir } from './env.js';

export type DbCtx = {
  sqlite: Database.Database;
  db: BetterSQLite3Database;
};

/**
 * Öffnet eine Datenbank. Die Anwendung benutzt genau eine (siehe `appDb`),
 * Tests legen sich eigene an.
 */
export function createDbCtx(path: string): DbCtx {
  const sqlite = new Database(path);
  // WAL: Lesen wird durch Schreiben nicht blockiert – wichtig, sobald mehrere
  // Tabs gleichzeitig offen sind. Fremdschlüssel gelten je Verbindung.
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return { sqlite, db: drizzle(sqlite) };
}

ensureDataDir();
export const appDb = createDbCtx(DATABASE_PATH);
export const sqlite = appDb.sqlite;
export const db = appDb.db;

/**
 * Kleine Schlüssel-Wert-Tabelle außerhalb der Migrationen: hier steht, wann der
 * Server zum ersten Mal lief und wie oft. Daran erkennt man auf Railway, ob das
 * Volume wirklich greift.
 */
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

const readMeta = sqlite.prepare<[string], { value: string }>('SELECT value FROM meta WHERE key = ?');
const writeMeta = sqlite.prepare(
  'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
);

export function getMeta(key: string): string | null {
  return readMeta.get(key)?.value ?? null;
}

export function setMeta(key: string, value: string): void {
  writeMeta.run(key, value);
}

/** Zählt die Starts mit und merkt sich den ersten. Beides überlebt nur mit Volume. */
export function recordBoot(): { boots: number; firstBootAt: string } {
  const firstBootAt = getMeta('firstBootAt') ?? new Date().toISOString();
  const boots = Number(getMeta('boots') ?? 0) + 1;
  setMeta('firstBootAt', firstBootAt);
  setMeta('boots', String(boots));
  return { boots, firstBootAt };
}
