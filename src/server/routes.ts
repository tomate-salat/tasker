import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  archiveQuery,
  bulkBody,
  createSchemas,
  drawingCreate,
  drawingPatch,
  duplicateBody,
  kindSchema,
  moveBody,
  purgeBody,
  settingsBody,
  stepsBody,
  patchBody,
  patchSchemas,
  type Kind,
} from '../shared/api.js';
import { CLIENT_HEADER, type ChangeEvent } from '../shared/events.js';
import { loadLogs, logScopes } from './burnup.js';
import type { DbCtx } from './db.js';
import { createDrawing, loadDrawings, patchDrawing, removeDrawing } from './drawings.js';
import { appEvents, type EventBus } from './events.js';
import {
  Conflict,
  NotFound,
  applySteps,
  archive,
  bulk,
  create,
  duplicate,
  inBootstrap,
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
 *
 * Jede erfolgreiche Änderung meldet sich anschließend im Änderungs-Strom
 * (`GET /events`), damit ein zweiter Tab nicht auf einem alten Stand sitzt.
 */
export function dataRoutes(ctx: DbCtx, bus: EventBus = appEvents): Hono {
  const app = new Hono();
  const run = (...args: RunArgs) => runWith(ctx, ...args);

  /* ------------------------------------------------------------- Lesen */

  // Das Burnup-Protokoll kommt mit; ein neuer Tag bekommt dabei seinen Eintrag.
  app.get('/bootstrap', (c) => {
    logScopes(ctx);
    return c.json({ ...loadBootstrap(ctx), milestoneLog: loadLogs(ctx) });
  });

  app.get('/archive', (c) => {
    const q = archiveQuery.safeParse(c.req.query());
    if (!q.success) return c.json({ error: 'Ungültige Abfrage.' }, 400);
    return c.json(loadArchive(ctx, q.data));
  });

  app.get('/trash', (c) => c.json({ entries: loadTrash(ctx), days: TRASH_DAYS }));

  app.get('/settings', (c) => c.json(getSettings(ctx)));

  app.get('/drawings', (c) => {
    const taskId = c.req.query('taskId');
    if (!taskId) return c.json({ error: 'taskId fehlt.' }, 400);
    return c.json({ drawings: loadDrawings(ctx, taskId) });
  });

  /* ---------------------------------------------------- Änderungs-Strom */

  /**
   * Der Strom hält offen und schickt jede Änderung weiter. Alle 25 Sekunden
   * geht ein Lebenszeichen raus, sonst schließen Proxys die Verbindung.
   */
  app.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = bus.subscribe((envelope) => {
        void stream.writeSSE({ id: String(envelope.id), data: JSON.stringify(envelope) });
      });
      stream.onAbort(unsubscribe);

      await stream.writeSSE({ event: 'ready', data: '1', retry: 3000 });
      while (!stream.closed && !stream.aborted) {
        await stream.sleep(25_000);
        if (stream.closed || stream.aborted) break;
        await stream.writeSSE({ event: 'ping', data: '' });
      }
      unsubscribe();
    }),
  );

  /* ---------------------------------------------------------- Schreiben */

  app.patch('/settings', async (c) => {
    const body = settingsBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const next = putSettings(ctx, body.data);
    publish(c, bus, { type: 'settings', settings: next });
    return c.json(next);
  });

  app.post('/trash/:id/restore', (c) =>
    run(c, bus, () => restoreTrash(ctx, c.req.param('id'), { toEnd: true }), {
      event: () => ({ type: 'reload', reason: 'Aus dem Papierkorb geholt' }),
    }),
  );

  app.delete('/trash/:id', (c) =>
    run(c, bus, () => purgeTrash(ctx, [c.req.param('id')]), {
      event: () => ({ type: 'reload', reason: 'Endgültig gelöscht' }),
    }),
  );

  // „Papierkorb leeren“: der Client nennt, was er gerade zeigt.
  app.post('/trash/purge', async (c) => {
    const body = purgeBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => purgeTrash(ctx, body.data.ids), {
      event: () => ({ type: 'reload', reason: 'Papierkorb geleert' }),
    });
  });

  app.post('/move', async (c) => {
    const body = moveBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const { id, version, ...target } = body.data;
    // Verschieben rührt an Geschwistern und am ganzen Teilbaum – neu laden.
    return run(c, bus, () => move(ctx, id, version, target), {
      event: () => ({ type: 'reload', reason: 'Verschoben' }),
    });
  });

  app.post('/duplicate', async (c) => {
    const body = duplicateBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    // Die Kopie bringt einen ganzen Teilbaum mit – andere Tabs laden neu.
    return run(c, bus, () => duplicate(ctx, body.data.id), {
      status: 201,
      event: () => ({ type: 'reload', reason: 'Dupliziert' }),
    });
  });

  app.post('/bulk', async (c) => {
    const body = bulkBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    // Ein Stapel rührt an vielen Zeilen auf einmal – die anderen Tabs laden neu.
    return run(c, bus, () => bulk(ctx, body.data.items, body.data.action), {
      event: () => ({ type: 'reload', reason: 'Mehrfachauswahl geändert' }),
    });
  });

  /**
   * Mehrere Schritte in einer Transaktion. Damit läuft „Erledigte archivieren“
   * (Milestones und Aufgaben gemischt) und die Rücknahme: der Client schickt
   * die Gegen-Schritte zurück, die er beim Ausführen mitbekommen hat.
   */
  app.post('/steps', async (c) => {
    const body = stepsBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);

    // Die Änderungen eines `patch`-Schritts hängen am Typ und werden erst hier geprüft.
    for (const s of body.data.steps) {
      if (s.op !== 'patch') continue;
      const changes = patchSchemas[s.kind].safeParse(s.changes);
      if (!changes.success) return fail(c, changes.error);
      s.changes = changes.data as Record<string, unknown>;
    }

    return run(c, bus, () => applySteps(ctx, body.data.steps), {
      event: () => ({ type: 'reload', reason: 'Mehrere Änderungen' }),
    });
  });

  /* Zeichnungen hängen an einer Aufgabe, sind aber zu groß fürs Startpaket. */

  app.post('/drawings', async (c) => {
    const body = drawingCreate.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => createDrawing(ctx, body.data.taskId, body.data.name), {
      status: 201,
      event: (d) => ({ type: 'drawings', taskId: (d as { taskId: string }).taskId }),
    });
  });

  app.patch('/drawings/:id', async (c) => {
    const body = drawingPatch.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => patchDrawing(ctx, c.req.param('id'), body.data.version, body.data.changes), {
      event: (d) => ({ type: 'drawings', taskId: (d as { taskId: string }).taskId }),
    });
  });

  // Mit der Zeichnung ändert sich auch die Beschreibung der Aufgabe.
  app.delete('/drawings/:id', (c) =>
    run(c, bus, () => removeDrawing(ctx, c.req.param('id')), {
      event: () => ({ type: 'reload', reason: 'Zeichnung gelöscht' }),
    }),
  );

  /* ------------------------------------------------------- Objektrouten */

  app.post('/kind/:kind', async (c) => {
    const kind = parseKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Unbekannter Typ.' }, 404);

    const body = createSchemas[kind].safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => create(ctx, kind, body.data as Record<string, unknown>), {
      status: 201,
      event: (object) => ({ type: 'upsert', kind, object }),
    });
  });

  app.patch('/kind/:kind/:id', async (c) => {
    const kind = parseKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Unbekannter Typ.' }, 404);

    const body = patchBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);

    const changes = patchSchemas[kind].safeParse(body.data.changes);
    if (!changes.success) return fail(c, changes.error);

    return run(
      c,
      bus,
      () => patch(ctx, kind, c.req.param('id'), body.data.version, changes.data as Record<string, unknown>),
      {
        // Archiviertes gehört nicht in den aktiven Bestand der anderen Tabs – sie laden nur neu.
        event: (object) =>
          inBootstrap(ctx, kind, c.req.param('id'))
            ? { type: 'upsert', kind, object }
            : { type: 'reload', reason: 'Im Archiv geändert' },
      },
    );
  });

  app.delete('/kind/:kind/:id', (c) => {
    const kind = parseKind(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Unbekannter Typ.' }, 404);
    // Mit dem Eintrag gehen Unteraufgaben und Verweise – das ist kein Einzelstück.
    return run(c, bus, () => remove(ctx, kind, c.req.param('id')), {
      event: () => ({ type: 'reload', reason: 'Gelöscht' }),
    });
  });

  app.post('/kind/:kind/:id/archive', (c) => {
    const kind = archivable(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Nur Aufgaben und Milestones.' }, 400);
    return run(c, bus, () => archive(ctx, kind, c.req.param('id')), {
      event: () => ({ type: 'reload', reason: 'Archiviert' }),
    });
  });

  app.post('/kind/:kind/:id/restore', (c) => {
    const kind = archivable(c.req.param('kind'));
    if (!kind) return c.json({ error: 'Nur Aufgaben und Milestones.' }, 400);
    return run(c, bus, () => restore(ctx, kind, c.req.param('id'), { toEnd: true }), {
      event: () => ({ type: 'reload', reason: 'Aus dem Archiv geholt' }),
    });
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

/** Der schreibende Tab nennt sich im Header und überspringt seinen eigenen Hall. */
const publish = (c: Context, bus: EventBus, event: ChangeEvent): void => {
  bus.publish(event, c.req.header(CLIENT_HEADER) ?? null);
};

type RunArgs = Parameters<typeof runWith> extends [DbCtx, ...infer R] ? R : never;

/** Übersetzt die Fehler der Datenschicht in Antwortcodes und meldet Erfolge. */
function runWith(
  ctx: DbCtx,
  c: Context,
  bus: EventBus,
  fn: () => unknown,
  o: { status?: 200 | 201; event?: (result: unknown) => ChangeEvent } = {},
) {
  try {
    const result = fn();
    // Wie `logScopes` nach jedem `mut` im Prototyp: der Burnup kennt jede Änderung.
    logScopes(ctx);
    if (o.event) publish(c, bus, o.event(result));
    return c.json(result as object, o.status ?? 200);
  } catch (e) {
    if (e instanceof NotFound) return c.json({ error: 'Nicht gefunden.' }, 404);
    if (e instanceof Conflict) {
      // Der Client hat auf einem veralteten Stand gearbeitet und bekommt den aktuellen zurück.
      return c.json({ error: 'Inzwischen woanders geändert.', current: e.current }, 409);
    }
    return c.json({ error: e instanceof Error ? e.message : 'Fehler' }, 400);
  }
}
