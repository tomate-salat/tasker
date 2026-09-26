import { eq } from 'drizzle-orm';
import { settings } from '../../db/schema.js';
import type { GraphLayout } from '../shared/api.js';
import type { Settings } from '../shared/model.js';
import { appDb, type DbCtx } from './db.js';

export type { Settings };

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

const DEFAULTS: Settings = { velocity: 8, theme: 'system', imageMaxKb: 500, imageMaxEdge: 2560 };

/** Zahl aus der Tabelle, mit Grenzen – Unsinn in der Zeile fällt auf die Vorgabe zurück. */
const num = (ctx: DbCtx, key: string, fallback: number, min: number, max: number): number => {
  const n = Number(getSetting(ctx, key) ?? fallback);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function getSettings(ctx: DbCtx): Settings {
  const theme = (getSetting(ctx, 'ui.theme') ?? DEFAULTS.theme) as Settings['theme'];
  return {
    velocity: num(ctx, 'ui.velocity', DEFAULTS.velocity, 1, 200),
    theme: ['system', 'light', 'dark'].includes(theme) ? theme : DEFAULTS.theme,
    imageMaxKb: num(ctx, 'bild.maxKb', DEFAULTS.imageMaxKb, 50, 5000),
    imageMaxEdge: num(ctx, 'bild.maxKante', DEFAULTS.imageMaxEdge, 400, 8000),
  };
}

export function putSettings(ctx: DbCtx, patch: Partial<Settings>): Settings {
  if (patch.velocity !== undefined) {
    setSetting(ctx, 'ui.velocity', String(Math.min(200, Math.max(1, Math.round(patch.velocity)))));
  }
  if (patch.theme !== undefined) setSetting(ctx, 'ui.theme', patch.theme);
  if (patch.imageMaxKb !== undefined) {
    setSetting(ctx, 'bild.maxKb', String(Math.min(5000, Math.max(50, Math.round(patch.imageMaxKb)))));
  }
  if (patch.imageMaxEdge !== undefined) {
    setSetting(
      ctx,
      'bild.maxKante',
      String(Math.min(8000, Math.max(400, Math.round(patch.imageMaxEdge)))),
    );
  }
  return getSettings(ctx);
}

/** Das Abhängigkeits-Board liegt je Projekt als eine Zeile hier – nur Positionen. */
export function getGraph(ctx: DbCtx, projectId: string): GraphLayout {
  try {
    const raw = JSON.parse(getSetting(ctx, `graph.${projectId}`) ?? '') as GraphLayout;
    return raw && typeof raw.nodes === 'object' ? raw : { nodes: {} };
  } catch {
    return { nodes: {} };
  }
}

export function putGraph(ctx: DbCtx, projectId: string, layout: GraphLayout): void {
  setSetting(ctx, `graph.${projectId}`, JSON.stringify(layout));
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
