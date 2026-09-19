import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { DATABASE_PATH, ensureDataDir } from './env.js';

ensureDataDir();

export const sqlite = new Database(DATABASE_PATH);

// WAL: Lesen wird durch Schreiben nicht blockiert – wichtig, sobald mehrere Tabs
// gleichzeitig offen sind. foreign_keys ist in SQLite per Verbindung abzuschalten/einzuschalten.
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite);

/**
 * Minimale Tabelle, um zu beweisen, dass das Volume den Deploy überlebt.
 * Das richtige Schema kommt mit den Drizzle-Migrationen; diese Tabelle bleibt
 * danach als Startprotokoll bestehen.
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
