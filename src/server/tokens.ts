import { createHash, randomBytes } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { apiTokens } from '../../db/schema.js';
import type { DbCtx } from './db.js';

/**
 * Zugangs-Tokens für den MCP-Endpunkt (`/mcp`) und die in index.ts
 * freigegebenen Datenrouten (`TOKEN_ROUTES`). Ein Token ersetzt dort die
 * Anmeldung: wer es hat, darf lesen und schreiben wie der Nutzer selbst.
 *
 * Gespeichert wird nur der SHA-256 – ein langes Zufallstoken braucht kein
 * langsames Passwort-Hashing, und so kostet die Prüfung bei jeder Anfrage
 * nichts. Das Token selbst bekommt der Nutzer einmal zu sehen, danach nie wieder.
 */

const PREFIX = 'tsk_';

const hashOf = (token: string): string => createHash('sha256').update(token).digest('hex');

export type TokenInfo = { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null };

export function listTokens(ctx: DbCtx): TokenInfo[] {
  return ctx.db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      hint: apiTokens.hint,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt))
    .all();
}

/** Legt ein Token an und gibt es genau dieses eine Mal im Klartext zurück. */
export function createToken(ctx: DbCtx, name: string): TokenInfo & { token: string } {
  const token = PREFIX + randomBytes(32).toString('base64url');
  const row = {
    id: 'a' + randomBytes(9).toString('base64url'),
    hash: hashOf(token),
    name: name.trim() || 'Token',
    hint: token.slice(0, PREFIX.length + 4),
    createdAt: new Date().toISOString(),
  };
  ctx.db.insert(apiTokens).values(row).run();
  return { id: row.id, name: row.name, hint: row.hint, createdAt: row.createdAt, lastUsedAt: null, token };
}

export function revokeToken(ctx: DbCtx, id: string): boolean {
  return ctx.db.delete(apiTokens).where(eq(apiTokens.id, id)).run().changes > 0;
}

/**
 * Prüft ein Token aus dem Authorization-Header. Der Vergleich läuft über den
 * Hash in einem eindeutigen Index – die Laufzeit verrät damit nichts über das
 * Token selbst.
 */
export function tokenValid(ctx: DbCtx, header: string | undefined): boolean {
  const token = header?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token?.startsWith(PREFIX)) return false;
  const hash = hashOf(token);
  const row = ctx.db.select({ id: apiTokens.id }).from(apiTokens).where(eq(apiTokens.hash, hash)).get();
  if (!row) return false;
  ctx.db.update(apiTokens).set({ lastUsedAt: new Date().toISOString() }).where(eq(apiTokens.id, row.id)).run();
  return true;
}
