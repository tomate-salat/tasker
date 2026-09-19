import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.js';
import { db } from './db.js';

/**
 * Schlüssel-Wert-Tabelle für alles, wovon es genau eine Zeile gibt:
 * Konto und dauerhafte Einstellungen. Ein einziger Nutzer, deshalb ohne user_id.
 */
export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run();
}

export const ACCOUNT = {
  email: 'account.email',
  name: 'account.name',
  avatar: 'account.avatar',
  passwordHash: 'account.passwordHash',
} as const;
