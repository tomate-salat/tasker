import { Hono, type Context } from 'hono';
import {
  archiveQuery,
  createSchemas,
  kindSchema,
  moveBody,
  settingsBody,
  patchBody,
  patchSchemas,
  type Kind,
} from '../shared/api.js';
import type { DbCtx } from './db.js';
import {
  Conflict,
  NotFound,
  archive,
  create,
  loadArchive,
  loadBootstrap,
  move,
  patch,
  remove,
  restore,
  restoreTrash,
  loadTrash,
  purgeTrash,
  TRASH_DAYS,
} from './repo.js';
import { getSettings, putSettings } from './settings.js';

/**
 * Alle Datenrouten. Die Anmeldung liegt davor, siehe index.ts.
 *
 * Die Objektrouten liegen unter `/kind/<typ>`, damit sie sich mit festen Pfaden
 * wie `/move` oder `/trash` nicht überschneiden können. Sonst hinge die
 * Korrektheit an der Registrierungsreihenfolge und kippte beim nächsten
 * eingefügten Endpunkt.
 */
export function dataRoutes(ctx: DbCtx): Hono {
  const app = new Hono();

  app.get('/bootstrap', (c) => c.json(loadBootstrap(ctx)));

  app.get('/archive', (c) => {
    const q = archiveQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'Ungültige Abfrage.' }, 400);
    return c.json(loadArchive(ctx, q.data));
  });

  app.get('/trash', (c) => c.json({ entries: loadTrash(ctx), days: TRASH_DAYS }));

  app.post('/trash/:id/restore', (c) => run(c, () => restoreTrash(ctx, c.req.param('id'))));

  app.delete('/trash/:id', (c) => {
    purgeTrash(ctx, c.req.param('id'));
    return c.json({ ok: true });
  });

  app.get('/settings', (c) => c.json(getSettings(ctx)));

  app.patch('/settings', async (c) => {
    const body = settingsBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return c.json(putSettings(ctx, body.data));
  });

  app.post('/move', async (c) => {
    const body = moveBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const { id, version, ...target } = body.data;
    return run(c, () => move(ctx, id, version, target));
  });

  app.post('/kind/:kind', async (c) => {
    const kind = parseKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Unbekannter Typ.' }, 404);

    const body = createSchemas[kind].safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return c.json(create(ctx, kind, body.data as Record<string, unknown>), 201);
  });

  app.patch('/kind/:kind/:id', async (c) => {
    const kind = parseKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Unbekannter Typ.' }, 404);

    const body = patchBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);

    const changes = patchSchemas[kind].safeParse(body.data.changes);
    if (!changes.success) return fail(c, changes.error);

    return run(c, () =>
      patch(ctx, kind, c.req.param('id'), body.data.version, changes.data as Record<string, unknown>),
    );
  });

  app.delete('/kind/:kind/:id', (c) => {
    const kind = parseKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Unbekannter Typ.' }, 404);
    return run(c, () => remove(ctx, kind, c.req.param('id')));
  });

  app.post('/kind/:kind/:id/archive', (c) => {
    const kind = archivable(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Nur Aufgaben und Milestones.' }, 400);
    return run(c, () => archive(ctx, kind, c.req.param('id')));
  });

  app.post('/kind/:kind/:id/restore', (c) => {
    const kind = archivable(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Nur Aufgaben und Milestones.' }, 400);
    return run(c, () => restore(ctx, kind, c.req.param('id')));
  });

  return app;
}

/* ---------------------------------------------------------------- Hilfen */

const json = (c: Context): Promise<unknown> => c.req.json().catch(() => null);

const parseKind = (raw: string): Kind | null => {
  const k = kindSchema.safeParse(raw);
  return k.success ? k.data : null;
};

const archivable = (raw: string): 'task' | 'milestone' | null =>
  raw === 'task' || raw === 'milestone' ? raw : null;

const fail = (c: Context, error: { issues: { path: PropertyKey[]; message: string }[] }) => {
  const first = error.issues[0];
  const where = first?.path.length ? `${first.path.join('.')}: ` : '';
  return c.json({ error: `${where}${first?.message ?? 'Ungültige Anfrage.'}` }, 400);
};

/** Übersetzt die Fehler der Datenschicht in Antwortcodes. */
function run(c: Context, fn: () => unknown) {
  try {
    return c.json(fn() as object);
  } catch (e) {
    if (e instanceof NotFound) return c.json({ error: 'Nicht gefunden.' }, 404);
    if (e instanceof Conflict) {
      // Der Client hat auf einem veralteten Stand gearbeitet und bekommt den aktuellen zurück.
      return c.json({ error: 'Inzwischen woanders geändert.', current: e.current }, 409);
    }
    return c.json({ error: e instanceof Error ? e.message : 'Fehler' }, 400);
  }
}
