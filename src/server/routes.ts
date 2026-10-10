import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  archiveQuery,
  bulkBody,
  codecksImportBody,
  codecksRefsBody,
  checklistBody,
  convertBody,
  createSchemas,
  drawingCreate,
  drawingPatch,
  duplicateBody,
  folderCreate,
  folderPatch,
  folderSort,
  graphLayout,
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
import type { Task } from '../shared/model.js';
import { loadLogs, logScopes } from './burnup.js';
import { convertCodecksRefs, importCodecks } from './codecks.js';
import type { DbCtx } from './db.js';
import { drawable, renderDrawing } from './drawingImage.js';
import { createDrawing, drawingPreview, loadDrawings, patchDrawing, removeDrawing } from './drawings.js';
import { appEvents, type EventBus } from './events.js';
import {
  addFolder,
  deleteFolder,
  getFolder,
  getImage,
  imageBytes,
  listFolders,
  listImages,
  moveFolder,
  moveImages,
  putImage,
  renameFolder,
  trashImage,
  untrashImage,
  usage,
} from './images.js';
import { newId } from './ids.js';
import {
  Conflict,
  NotFound,
  applySteps,
  archive,
  bulk,
  checklistToSubtasks,
  convertToMilestone,
  create,
  duplicate,
  inBootstrap,
  loadArchive,
  loadBootstrap,
  loadChangelog,
  move,
  patch,
  remove,
  restore,
  restoreTrash,
  loadTrash,
  purgeTrash,
  TRASH_DAYS,
} from './repo.js';
import { getGraph, getSettings, putGraph, putSettings } from './settings.js';

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
/** Längere Kante eines Zeichnungsbilds, wenn der Client keine nennt. */
const DRAWING_EDGE = 1600;

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

  // Milestones und Aufgaben eines Releases samt Archiviertem – daraus baut der Client das Changelog.
  app.get('/changelog/:releaseId', (c) => run(c, bus, () => loadChangelog(ctx, c.req.param('releaseId'))));

  app.get('/trash', (c) => c.json({ entries: loadTrash(ctx), days: TRASH_DAYS }));

  app.get('/settings', (c) => c.json(getSettings(ctx)));

  app.get('/graph/:id', (c) => c.json(getGraph(ctx, c.req.param('id'))));

  app.get('/drawings', (c) => {
    const taskId = c.req.query('taskId');
    const milestoneId = c.req.query('milestoneId');
    if (!taskId === !milestoneId) return c.json({ error: 'taskId oder milestoneId angeben.' }, 400);
    const owner = taskId
      ? ({ kind: 'task', id: taskId } as const)
      : ({ kind: 'milestone', id: milestoneId as string } as const);
    return c.json({ drawings: loadDrawings(ctx, owner) });
  });

  /**
   * Eine Zeichnung als PNG, für Clients ohne Excalidraw (das Godot-Addon).
   * Gefunden wird sie wie im Text: über den Besitzer und den Namen aus
   * `![[zeichnung:Name]]`. Das PNG entsteht bei jedem Abruf aus dem SVG, das
   * die Web-App beim Speichern hinterlegt hat – am ETag (er trägt die Version)
   * erkennt der Client, ob seins noch gilt, und bekommt dann 304.
   *
   * 204 heißt: zu dieser Zeichnung gibt es kein Bild. Sie ist leer, oder sie
   * wurde seit dem letzten Ändern nicht in der Web-App gespeichert.
   *
   * Eigener Pfad statt `/drawings/bild`, damit er sich mit `/drawings/:id`
   * nicht überschneidet.
   */
  app.get('/zeichnungsbild', async (c) => {
    const taskId = c.req.query('taskId');
    const milestoneId = c.req.query('milestoneId');
    const name = c.req.query('name');
    if (!taskId === !milestoneId || !name) {
      return c.json({ error: 'taskId oder milestoneId und name angeben.' }, 400);
    }
    const owner = taskId
      ? ({ kind: 'task', id: taskId } as const)
      : ({ kind: 'milestone', id: milestoneId as string } as const);
    const drawing = drawingPreview(ctx, owner, name);
    if (!drawing) return c.json({ error: 'Nicht gefunden.' }, 404);

    const dark = c.req.query('thema') === 'dunkel';
    const wanted = Number(c.req.query('kante') ?? DRAWING_EDGE);
    const maxEdge = Number.isFinite(wanted) ? Math.min(4000, Math.max(64, Math.round(wanted))) : DRAWING_EDGE;

    const headers = {
      'Cache-Control': 'private, no-cache',
      ETag: `"${drawing.id}-${drawing.version}-${maxEdge}${dark ? 'd' : 'h'}"`,
    };
    if (c.req.header('if-none-match') === headers.ETag) return c.body(null, 304, headers);
    if (!drawing.svg || !drawable(drawing.svg)) return c.body(null, 204, headers);

    try {
      const png = await renderDrawing(drawing.svg, { dark, maxEdge });
      return c.body(png as unknown as ArrayBuffer, 200, {
        ...headers,
        'Content-Type': 'image/png',
        'Content-Length': String(png.length),
      });
    } catch (e) {
      console.error(`Zeichnung ${drawing.id} ließ sich nicht zeichnen:`, e);
      return c.json({ error: 'Die Zeichnung ließ sich nicht als Bild ausgeben.' }, 500);
    }
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

  /* --------------------------------------------------------------- Bilder */

  /**
   * Der Bestand für die Galerie: nur die Angaben, nie die Bytes. Wer ein Bild
   * verwendet, wird hier nachgesehen und nicht mitgeschrieben – siehe images.ts.
   */
  app.get('/bilder', (c) => {
    const uses = usage(ctx);
    return c.json({
      images: listImages(ctx).map((m) => ({ ...m, usage: uses.get(m.id) ?? null })),
      folders: listFolders(ctx),
    });
  });

  /**
   * Die Bytes. Der Pfad enthält den Inhalts-Hash, dasselbe Bild liegt also nie
   * unter zwei Adressen und eine Adresse nie auf zwei Bildern – deshalb darf
   * der Browser es für immer behalten.
   */
  app.get('/bilder/:id', (c) => {
    const small = c.req.query('v') === 'klein';
    const found = imageBytes(ctx, c.req.param('id'), small ? 'klein' : 'gross');
    if (!found) return c.json({ error: 'Nicht gefunden.' }, 404);
    return c.body(found.bytes as unknown as ArrayBuffer, 200, {
      'Content-Type': found.mime,
      'Content-Length': String(found.bytes.length),
      'Cache-Control': 'public, max-age=31536000, immutable',
      ETag: `"${c.req.param('id')}${small ? '-k' : ''}"`,
    });
  });

  /**
   * Hochgeladen wird fertig: der Browser hat schon verkleinert und nach WebP
   * umgewandelt (siehe imageFile.ts). Hier wird nur noch die Grenze als Netz
   * geprüft und gehasht.
   */
  app.post('/bilder', async (c) => {
    const body = await c.req.parseBody().catch(() => null);
    if (!body) return c.json({ error: 'Kein Bild empfangen.' }, 400);
    const bild = body['bild'];
    const vorschau = body['vorschau'];
    if (!(bild instanceof File) || !(vorschau instanceof File)) {
      return c.json({ error: 'Kein Bild empfangen.' }, 400);
    }
    if (!ALLOWED.has(bild.type)) return c.json({ error: `${bild.type} wird nicht angenommen.` }, 400);

    const limit = getSettings(ctx).imageMaxKb * 1024;
    // Etwas Luft: die Grenze zieht der Browser, hier hängt nur das Netz.
    if (bild.size > limit * 1.5) return c.json({ error: 'Das Bild ist zu groß.' }, 413);

    const width = Number(body['breite']);
    const height = Number(body['hoehe']);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
      return c.json({ error: 'Maße fehlen.' }, 400);
    }

    const meta = putImage(ctx, {
      projectId: typeof body['projekt'] === 'string' && body['projekt'] ? body['projekt'] : null,
      // Die Galerie schickt mit, in welchem Ordner sie gerade steht.
      folderId: typeof body['ordner'] === 'string' && body['ordner'] ? body['ordner'] : null,
      name: typeof body['name'] === 'string' && body['name'] ? body['name'].slice(0, 200) : 'Bild',
      mime: bild.type,
      width: Math.round(width),
      height: Math.round(height),
      bytes: Buffer.from(await bild.arrayBuffer()),
      thumb: Buffer.from(await vorschau.arrayBuffer()),
    });
    publish(c, bus, { type: 'reload', reason: 'Bild hinzugefügt' });
    return c.json(meta, 201);
  });

  /**
   * Löschen heißt beim Bild: in den Papierkorb. Die Bytes bleiben liegen, frei
   * wird der Platz erst beim Leeren – wie bei allem anderen auch.
   */
  app.post('/bilder/:id/loeschen', (c) =>
    run(c, bus, () => {
      // Die Nummer des Eintrags geht mit – „Endgültig löschen“ leert ihn gleich.
      const trashId = newId('x');
      const meta = trashImage(ctx, c.req.param('id'), trashId);
      if (!meta) throw new NotFound();
      return { ...meta, trashId };
    }),
  );

  app.post('/bilder/:id/zurueck', (c) =>
    run(c, bus, () => {
      if (!untrashImage(ctx, c.req.param('id'))) throw new NotFound();
      return getImage(ctx, c.req.param('id'));
    }),
  );

  /* ------------------------------------------------- Ordner der Galerie */

  /**
   * Eigener Pfad statt `/bilder/ordner`: so kann sich nichts mit `/bilder/:id`
   * überschneiden, und die Reihenfolge der Registrierung bleibt gleichgültig.
   */
  app.post('/bildordner', async (c) => {
    const body = folderCreate.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => addFolder(ctx, { id: newId('o'), ...body.data }), { status: 201 });
  });

  app.patch('/bildordner/:id', async (c) => {
    const body = folderPatch.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => {
      const id = c.req.param('id');
      let meta = getFolder(ctx, id);
      if (!meta) throw new NotFound();
      if (body.data.parentId !== undefined) {
        // `null` kommt auch zurück, wenn der Ordner in sich selbst sollte.
        meta = moveFolder(ctx, id, body.data.parentId);
        if (!meta) throw new Conflict('Ein Ordner kann nicht in sich selbst liegen.');
      }
      if (body.data.name !== undefined) meta = renameFolder(ctx, id, body.data.name);
      return meta;
    });
  });

  /**
   * Ohne `inhalt=weg` hebt das Löschen den Inhalt eine Ebene höher, es geht
   * also nichts verloren. Mit dem Zusatz wandern die Bilder des ganzen Astes in
   * den Papierkorb – von dort sind sie einzeln wieder herauszuholen.
   */
  app.delete('/bildordner/:id', (c) =>
    run(c, bus, () => {
      const res = deleteFolder(ctx, c.req.param('id'), {
        withContents: c.req.query('inhalt') === 'weg',
        trashId: () => newId('x'),
      });
      if (!res) throw new NotFound();
      return res;
    }),
  );

  app.post('/bildordner/einsortieren', async (c) => {
    const body = folderSort.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => ({ moved: moveImages(ctx, body.data.ids, body.data.folderId) }));
  });

  /* ---------------------------------------------------------- Schreiben */

  app.patch('/settings', async (c) => {
    const body = settingsBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const next = putSettings(ctx, body.data);
    publish(c, bus, { type: 'settings', settings: next });
    return c.json(next);
  });

  app.put('/graph/:id', async (c) => {
    const body = graphLayout.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    putGraph(ctx, c.req.param('id'), body.data);
    return c.json(body.data);
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

  app.post('/convert', async (c) => {
    const body = convertBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    // Aus einem Task wird ein Milestone, die Unteraufgaben ziehen um – neu laden.
    return run(c, bus, () => convertToMilestone(ctx, body.data.id, body.data.version), {
      status: 201,
      event: () => ({ type: 'reload', reason: 'In Milestone umgewandelt' }),
    });
  });

  app.post('/checklist', async (c) => {
    const body = checklistBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const { id, version, items, headings } = body.data;
    // Neue Unteraufgaben und eine geänderte Beschreibung – neu laden.
    return run(c, bus, () => checklistToSubtasks(ctx, id, version, items, headings), {
      status: 201,
      event: () => ({ type: 'reload', reason: 'Checkboxen umgewandelt' }),
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

  // Vorschau und Import laufen denselben Weg; nur der echte Import meldet sich im Strom.
  app.post('/import/codecks', async (c) => {
    const body = codecksImportBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const { csv, dryRun } = body.data;
    return run(c, bus, () => importCodecks(ctx, csv, { dryRun }), {
      ...(dryRun ? {} : { event: () => ({ type: 'reload', reason: 'Aus Codecks importiert' }) as const }),
    });
  });

  app.post('/import/codecks-refs', async (c) => {
    const body = codecksRefsBody.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const { csvs, dryRun } = body.data;
    return run(c, bus, () => convertCodecksRefs(ctx, csvs, { dryRun }), {
      ...(dryRun ? {} : { event: () => ({ type: 'reload', reason: 'Codecks-Verweise umgewandelt' }) as const }),
    });
  });

  /* Zeichnungen hängen an einer Aufgabe oder einem Milestone, sind aber zu groß fürs Startpaket. */

  const drawingEvent = (d: unknown): ChangeEvent => {
    const { taskId, milestoneId } = d as { taskId: string | null; milestoneId: string | null };
    return { type: 'drawings', ownerId: (taskId ?? milestoneId) as string };
  };

  app.post('/drawings', async (c) => {
    const body = drawingCreate.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    const { taskId, milestoneId, name } = body.data;
    const owner = taskId
      ? ({ kind: 'task', id: taskId } as const)
      : ({ kind: 'milestone', id: milestoneId as string } as const);
    return run(c, bus, () => createDrawing(ctx, owner, name), { status: 201, event: drawingEvent });
  });

  app.patch('/drawings/:id', async (c) => {
    const body = drawingPatch.safeParse(await json(c));
    if (!body.success) return fail(c, body.error);
    return run(c, bus, () => patchDrawing(ctx, c.req.param('id'), body.data.version, body.data.changes), {
      event: drawingEvent,
    });
  });

  // Mit der Zeichnung ändert sich auch die Beschreibung ihres Besitzers.
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
      // Ein neues Release bringt die Kanäle des vorherigen mit – das ist kein Einzelstück.
      event: (object) =>
        kind === 'release' ? { type: 'reload', reason: 'Release angelegt' } : { type: 'upsert', kind, object },
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
        // Der Status einer Unteraufgabe kann den der Eltern-Aufgaben mitziehen.
        event: (object) =>
          !inBootstrap(ctx, kind, c.req.param('id'))
            ? { type: 'reload', reason: 'Im Archiv geändert' }
            : kind === 'task' && 'status' in changes.data && (object as Task).parentId
              ? { type: 'reload', reason: 'Status geändert' }
              : { type: 'upsert', kind, object },
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

/**
 * Angenommen wird nur, was der Browser selbst erzeugt hat. WebP ist der
 * Normalfall; PNG bleibt für den Fall offen, dass ein Browser kein WebP
 * kodieren kann. Animierte GIFs lehnt schon der Client ab – über den Canvas
 * bliebe nur das erste Einzelbild übrig.
 */
const ALLOWED = new Set(['image/webp', 'image/png']);

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
