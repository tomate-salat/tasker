import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { eq, lt } from 'drizzle-orm';
import { sessions } from '../../db/schema.js';
import { db } from './db.js';
import { ACCOUNT, accountSetting as getSetting, setAccountSetting as setSetting } from './settings.js';

export const SESSION_COOKIE = 'tasker_session';
const KEEP_DAYS = 90;

/* ------------------------------------------------------------------- Konto */

export type Account = { email: string; name: string; avatar: string };

export function getAccount(): Account | null {
  const email = getSetting(ACCOUNT.email);
  if (!email || !getSetting(ACCOUNT.passwordHash)) return null;
  return {
    email,
    name: getSetting(ACCOUNT.name) ?? 'Konto',
    avatar: getSetting(ACCOUNT.avatar) ?? '🙂',
  };
}

async function storePassword(password: string): Promise<void> {
  setSetting(ACCOUNT.passwordHash, await hash(password));
}

/**
 * Legt beim ersten Start das Konto aus TASKER_EMAIL und TASKER_PASSWORD an.
 *
 * Existiert das Konto bereits, werden beide Variablen ignoriert – sonst würde
 * ein im Profil geändertes Passwort beim nächsten Deploy überschrieben.
 * Zum Zurücksetzen eines vergessenen Passworts dient TASKER_PASSWORD_RESET.
 */
export async function bootstrapAccount(): Promise<void> {
  const email = process.env.TASKER_EMAIL?.trim();
  const password = process.env.TASKER_PASSWORD;
  const reset = process.env.TASKER_PASSWORD_RESET === '1';
  const existing = getAccount();

  if (!existing) {
    if (!email || !password) {
      console.warn(
        'WARNUNG: Es gibt noch kein Konto und TASKER_EMAIL/TASKER_PASSWORD sind nicht gesetzt. ' +
          'Eine Anmeldung ist damit nicht möglich.',
      );
      return;
    }
    setSetting(ACCOUNT.email, email);
    setSetting(ACCOUNT.name, process.env.TASKER_NAME?.trim() || email.split('@')[0] || 'Konto');
    setSetting(ACCOUNT.avatar, getSetting(ACCOUNT.avatar) ?? '🙂');
    await storePassword(password);
    console.log(`Konto angelegt für ${email}.`);
    return;
  }

  if (reset) {
    if (!password) {
      console.warn('TASKER_PASSWORD_RESET=1 gesetzt, aber kein TASKER_PASSWORD – nichts geändert.');
      return;
    }
    await storePassword(password);
    if (email) setSetting(ACCOUNT.email, email);
    db.delete(sessions).run();
    console.warn(
      'Passwort wurde zurückgesetzt und alle Sitzungen beendet. ' +
        'Entferne TASKER_PASSWORD_RESET jetzt wieder aus den Variablen.',
    );
  }
}

export async function changePassword(current: string, next: string): Promise<boolean> {
  const stored = getSetting(ACCOUNT.passwordHash);
  if (!stored || !(await verify(stored, current))) return false;
  await storePassword(next);
  return true;
}

/* ---------------------------------------------------------------- Anmeldung */

/**
 * Einfache Sperre gegen Durchprobieren. Der Prozess ist einzeln, deshalb reicht
 * ein Zähler im Speicher – nach einem Neustart ist er weg, was hier vertretbar ist.
 */
const LIMIT = { tries: 10, windowMs: 15 * 60_000 };
let failures: number[] = [];

export function loginLocked(): number {
  const since = Date.now() - LIMIT.windowMs;
  failures = failures.filter((t) => t > since);
  if (failures.length < LIMIT.tries) return 0;
  const oldest = failures[0] ?? Date.now();
  return Math.ceil((oldest + LIMIT.windowMs - Date.now()) / 1000);
}

/** Immer gleich teuer, egal ob es das Konto gibt – sonst verrät die Laufzeit es. */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c2FsdHNhbHRzYWx0c2E$Uu1rBFI0hM4pqTRWpcVCPQoEHKTnhcHkQyXQTvKXHVk';

export async function checkPassword(email: string, password: string): Promise<boolean> {
  const account = getAccount();
  const stored = getSetting(ACCOUNT.passwordHash) ?? DUMMY_HASH;
  let ok = false;
  try {
    ok = await verify(stored, password);
  } catch {
    ok = false;
  }
  if (!account || !sameString(account.email, email)) ok = false;
  if (!ok) failures.push(Date.now());
  else failures = [];
  return ok;
}

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a.trim().toLowerCase());
  const y = Buffer.from(b.trim().toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

/* ---------------------------------------------------------------- Sitzungen */

/** In der Datenbank steht nur der Hash des Tokens, nicht das Token selbst. */
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

export type NewSession = { token: string; maxAgeSeconds: number | null };

export function createSession(keepSignedIn: boolean, userAgent?: string): NewSession {
  const token = randomBytes(32).toString('base64url');
  const maxAgeSeconds = keepSignedIn ? KEEP_DAYS * 24 * 60 * 60 : null;
  // Auch eine reine Browsersitzung läuft serverseitig ab, damit nichts ewig gültig bleibt.
  const lifetimeMs = (maxAgeSeconds ?? 24 * 60 * 60) * 1000;
  db.insert(sessions)
    .values({
      id: tokenHash(token),
      expiresAt: new Date(Date.now() + lifetimeMs).toISOString(),
      userAgent: userAgent?.slice(0, 200),
    })
    .run();
  return { token, maxAgeSeconds };
}

export function sessionValid(token: string | undefined): boolean {
  if (!token) return false;
  const id = tokenHash(token);
  const row = db.select().from(sessions).where(eq(sessions.id, id)).get();
  if (!row) return false;
  if (row.expiresAt <= new Date().toISOString()) {
    db.delete(sessions).where(eq(sessions.id, id)).run();
    return false;
  }
  db.update(sessions).set({ lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, id)).run();
  return true;
}

export function destroySession(token: string | undefined): void {
  if (token) db.delete(sessions).where(eq(sessions.id, tokenHash(token))).run();
}

export function purgeExpiredSessions(): void {
  db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run();
}
