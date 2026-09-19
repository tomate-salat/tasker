import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.js';
import { appDb, type DbCtx } from './db.js';

/**
 * Schlüssel-Wert-Tabelle für alles, wovon es genau eine Zeile gibt:
 * Konto und dauerhafte Einstellungen. Ein einziger Nutzer, deshalb ohne user_id.
 *
 * Die Datenbank wird übergeben, nicht importiert – sonst hängen Tests und
 * Routen an der Datenbank der Anwendung statt an ihrer eigenen.
 */
export function getSetting(ctx: DbCtx, key: string): string | null {
  const row = ctx.db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(ctx: DbCtx, key: string, value: string): void {
  ctx.db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedAt: new Date().toISOString() },
    })
    .run();
}

/** Dauerhafte Einstellungen – im Gegensatz zum reinen Anzeigezustand im Client. */
export type Settings = {
  /** Aufgaben pro Woche, Grundlage von Zeitplan und Prognose. */
  velocity: number;
  theme: 'system' | 'light' | 'dark';
};

const DEFAULTS: Settings = { velocity: 8, theme: 'system' };

export function getSettings(ctx: DbCtx): Settings {
  const velocity = Number(getSetting(ctx, 'ui.velocity') ?? DEFAULTS.velocity);
  const theme = (getSetting(ctx, 'ui.theme') ?? DEFAULTS.theme) as Settings['theme'];
  return {
    velocity: Number.isFinite(velocity) ? Math.min(200, Math.max(1, velocity)) : DEFAULTS.velocity,
    theme: ['system', 'light', 'dark'].includes(theme) ? theme : DEFAULTS.theme,
  };
}

export function putSettings(ctx: DbCtx, patch: Partial<Settings>): Settings {
  if (patch.velocity !== undefined) {
    setSetting(ctx, 'ui.velocity', String(Math.min(200, Math.max(1, Math.round(patch.velocity)))));
  }
  if (patch.theme !== undefined) setSetting(ctx, 'ui.theme', patch.theme);
  return getSettings(ctx);
}

export const ACCOUNT = {
  email: 'account.email',
  name: 'account.name',
  avatar: 'account.avatar',
  passwordHash: 'account.passwordHash',
} as const;

/** Das Konto der Anwendung liegt immer in deren eigener Datenbank. */
export const accountSetting = (key: string): string | null => getSetting(appDb, key);
export const setAccountSetting = (key: string, value: string): void => setSetting(appDb, key, value);
