import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { patchSchemas } from '../shared/api.js';
import type { ChangeEvent } from '../shared/events.js';
import { TASK_STATUS, type Milestone, type Task } from '../shared/model.js';
import { logScopes } from './burnup.js';
import type { DbCtx } from './db.js';
import type { EventBus } from './events.js';
import { Conflict, NotFound, create, inBootstrap, loadBootstrap, move, patch, type Bootstrap } from './repo.js';

/**
 * Der MCP-Endpunkt: Tasker für Claude Code und andere MCP-Clients. Die
 * Anmeldung (Bearer-Token) liegt davor, siehe index.ts.
 *
 * Zustandslos: jede Anfrage bekommt ihren eigenen Server samt Transport. Das
 * kostet fast nichts und erspart Sitzungen, die ein Neustart ohnehin verlöre.
 *
 * Die Werkzeuge rufen dieselbe Datenschicht wie die Routen und melden sich
 * danach im Änderungs-Strom – eine offene App sieht die Änderung sofort.
 * Gelöscht wird über MCP bewusst nichts.
 */
export async function handleMcp(ctx: DbCtx, bus: EventBus, req: Request): Promise<Response> {
  const server = buildServer(ctx, bus);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(req);
}

/* ---------------------------------------------------------------- Hilfen */

const STATUS_HELP =
  'open = offen, progress = in Arbeit, done = erledigt, unclear = unklar, blocked = blockiert';
const PRIO_HELP = '0 = keine, 1 = hoch, 2 = mittel, 3 = niedrig';

/** Eine Aufgabe oder ein Milestone per ID ("t…"/"m…") oder Nummer ("$142" oder "142"). */
const key = z.string().min(1).max(64);

function find<T extends { id: string; ref: number }>(list: T[], k: string): T | undefined {
  const n = k.match(/^\$?(\d+)$/)?.[1];
  return n ? list.find((x) => x.ref === Number(n)) : list.find((x) => x.id === k);
}

function taskOf(boot: Bootstrap, k: string): Task {
  const t = find(boot.tasks, k);
  if (!t) throw new Error(`Aufgabe ${k} gibt es nicht (oder sie ist archiviert).`);
  return t;
}

function milestoneOf(boot: Bootstrap, k: string): Milestone {
  const m = find(boot.milestones, k);
  if (!m) throw new Error(`Milestone ${k} gibt es nicht (oder er ist archiviert).`);
  return m;
}

/** Wo eine Aufgabe steht, in Worten – so wie die Reiter der App. */
function placeOf(boot: Bootstrap, t: Task): string {
  if (t.parentId) return `Unteraufgabe von $${boot.tasks.find((p) => p.id === t.parentId)?.ref ?? '?'}`;
  if (t.milestoneId) return `Milestone ${boot.milestones.find((m) => m.id === t.milestoneId)?.title ?? '?'}`;
  if (t.groupId) return `Gruppe ${boot.groups.find((g) => g.id === t.groupId)?.title ?? '?'}`;
  if (t.doc) return 'Dokumentation';
  return t.ready ? 'Ready' : 'Backlog';
}

function brief(boot: Bootstrap, t: Task) {
  return {
    id: t.id,
    ref: `$${t.ref}`,
    title: t.title,
    status: t.status,
    prio: t.prio,
    project: boot.projects.find((p) => p.id === t.projectId)?.name,
    place: placeOf(boot, t),
    ...(t.categoryId ? { category: boot.categories.find((c) => c.id === t.categoryId)?.name } : {}),
    ...(t.markId ? { mark: boot.marks.find((m) => m.id === t.markId)?.name } : {}),
    ...(t.tags.length ? { tags: t.tags } : {}),
  };
}

function detail(boot: Bootstrap, t: Task) {
  const ref = (id: string) => {
    const x = boot.tasks.find((o) => o.id === id);
    return x ? `$${x.ref} ${x.title}` : id;
  };
  return {
    ...brief(boot, t),
    version: t.version,
    desc: t.desc,
    doc: t.doc,
    ready: t.ready,
    projectId: t.projectId,
    parentId: t.parentId,
    milestoneId: t.milestoneId,
    groupId: t.groupId,
    categoryId: t.categoryId,
    markId: t.markId,
    doneAt: t.doneAt,
    deps: t.deps.map(ref),
    subtasks: boot.tasks.filter((c) => c.parentId === t.id).map((c) => brief(boot, c)),
  };
}

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

/** Fehler gehen als Werkzeug-Ergebnis zurück, damit das Modell sie lesen und reagieren kann. */
async function safely(fn: () => unknown) {
  try {
    return text(await fn());
  } catch (e) {
    const message =
      e instanceof NotFound
        ? 'Nicht gefunden.'
        : e instanceof Conflict
          ? 'Inzwischen woanders geändert – bitte neu lesen.'
          : e instanceof Error
            ? e.message
            : 'Fehler';
    return { ...text(message), isError: true };
  }
}

/* ------------------------------------------------------------- Werkzeuge */

function buildServer(ctx: DbCtx, bus: EventBus): McpServer {
  const server = new McpServer(
    { name: 'tasker', version: '0.1.0' },
    {
      instructions:
        'Tasker ist die Aufgabenverwaltung des Nutzers. Aufgaben haben eine feste Nummer ($142), ' +
        'über die sie im Text verwiesen werden. Zuerst `list_projects` für den Überblick, dann ' +
        '`list_tasks` oder `get_task`. Aufgaben lassen sich anlegen und ändern, nicht löschen.',
    },
  );

  // Nach jeder Änderung wie in den Routen: Burnup nachführen, andere Tabs benachrichtigen.
  const changed = (event: ChangeEvent): void => {
    logScopes(ctx);
    bus.publish(event, null);
  };

  server.registerTool(
    'list_projects',
    {
      title: 'Projekte',
      description:
        'Alle Projekte mit ihren Milestones, Gruppen und Kategorien sowie die projektübergreifenden ' +
        'Markierungen. Liefert die IDs, die die anderen Werkzeuge brauchen.',
      annotations: { readOnlyHint: true },
    },
    () =>
      safely(() => {
        const boot = loadBootstrap(ctx);
        return {
          projects: boot.projects.map((p) => ({
            id: p.id,
            name: p.name,
            milestones: boot.milestones
              .filter((m) => m.projectId === p.id)
              .map((m) => ({ id: m.id, ref: `$${m.ref}`, title: m.title, status: m.status, planned: m.planned })),
            groups: boot.groups.filter((g) => g.projectId === p.id).map((g) => ({ id: g.id, title: g.title })),
            categories: boot.categories
              .filter((c) => c.projectId === p.id)
              .map((c) => ({ id: c.id, name: c.name })),
            openTasks: boot.tasks.filter((t) => t.projectId === p.id && t.status !== 'done' && !t.doc).length,
          })),
          marks: boot.marks.map((m) => ({ id: m.id, emoji: m.emoji, name: m.name })),
        };
      }),
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'Aufgaben suchen',
      description:
        'Aktive (nicht archivierte) Aufgaben, gefiltert. Ohne Filter alle offenen Aufgaben. ' +
        'Liefert nur eine Kurzfassung – die Beschreibung gibt es mit `get_task`.',
      inputSchema: {
        projectId: z.string().optional().describe('Nur dieses Projekt.'),
        milestone: key.optional().describe('Nur dieser Milestone (ID oder $Nummer).'),
        parent: key.optional().describe('Nur die direkten Unteraufgaben dieser Aufgabe.'),
        status: z.array(z.enum(TASK_STATUS)).optional().describe(`Nur diese Status. ${STATUS_HELP}`),
        includeDone: z.boolean().optional().describe('Auch erledigte zeigen (Vorgabe: nein).'),
        includeDocs: z.boolean().optional().describe('Auch Dokumentationsseiten zeigen (Vorgabe: nein).'),
        query: z.string().max(200).optional().describe('Suchtext in Titel und Beschreibung.'),
        limit: z.number().int().min(1).max(500).optional().describe('Höchstens so viele (Vorgabe: 100).'),
      },
      annotations: { readOnlyHint: true },
    },
    (a) =>
      safely(() => {
        const boot = loadBootstrap(ctx);
        const ms = a.milestone ? milestoneOf(boot, a.milestone) : null;
        const parent = a.parent ? taskOf(boot, a.parent) : null;
        const q = a.query?.toLowerCase();
        const hits = boot.tasks.filter(
          (t) =>
            (!a.projectId || t.projectId === a.projectId) &&
            (!ms || t.milestoneId === ms.id) &&
            (!parent || t.parentId === parent.id) &&
            (a.status ? a.status.includes(t.status) : a.includeDone || t.status !== 'done') &&
            (a.includeDocs || !t.doc) &&
            (!q || t.title.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)),
        );
        const limit = a.limit ?? 100;
        return { total: hits.length, tasks: hits.slice(0, limit).map((t) => brief(boot, t)) };
      }),
  );

  server.registerTool(
    'get_task',
    {
      title: 'Aufgabe lesen',
      description: 'Eine Aufgabe vollständig: Beschreibung (Markdown), Unteraufgaben, Abhängigkeiten.',
      inputSchema: { task: key.describe('ID oder $Nummer der Aufgabe.') },
      annotations: { readOnlyHint: true },
    },
    (a) =>
      safely(() => {
        const boot = loadBootstrap(ctx);
        return detail(boot, taskOf(boot, a.task));
      }),
  );

  server.registerTool(
    'create_task',
    {
      title: 'Aufgabe anlegen',
      description:
        'Legt eine Aufgabe an. Ohne Ort landet sie im Backlog des Projekts. Mit `parent` wird sie ' +
        'Unteraufgabe, mit `milestone` kommt sie in den Milestone. Das Projekt ergibt sich aus ' +
        'Elternaufgabe oder Milestone, sonst muss `projectId` gesetzt sein.',
      inputSchema: {
        title: z.string().min(1).max(500),
        desc: z.string().max(200_000).optional().describe('Beschreibung in Markdown.'),
        projectId: z.string().optional(),
        parent: key.optional().describe('Elternaufgabe (ID oder $Nummer).'),
        milestone: key.optional().describe('Milestone (ID oder $Nummer).'),
        groupId: z.string().optional().describe('Gruppe im Backlog.'),
        ready: z.boolean().optional().describe('Gleich in „Ready“ statt ins Backlog (nur ohne Ort).'),
        doc: z.boolean().optional().describe('Als Dokumentationsseite statt als Aufgabe.'),
        status: z.enum(TASK_STATUS).optional().describe(STATUS_HELP),
        prio: z.number().int().min(0).max(3).optional().describe(PRIO_HELP),
        categoryId: z.string().optional(),
        markId: z.string().optional(),
        tags: z.array(z.string().min(1).max(60)).optional(),
        deps: z.array(key).optional().describe('Aufgaben, auf die diese wartet (ID oder $Nummer).'),
      },
    },
    (a) =>
      safely(() => {
        const boot = loadBootstrap(ctx);
        const parent = a.parent ? taskOf(boot, a.parent) : null;
        const ms = !parent && a.milestone ? milestoneOf(boot, a.milestone) : null;
        const group = !parent && !ms && a.groupId ? boot.groups.find((g) => g.id === a.groupId) : null;
        if (a.groupId && !parent && !ms && !group) throw new Error(`Gruppe ${a.groupId} gibt es nicht.`);
        const projectId = parent?.projectId ?? ms?.projectId ?? group?.projectId ?? a.projectId;
        if (!projectId) throw new Error('projectId fehlt (oder parent/milestone angeben).');
        if (!boot.projects.some((p) => p.id === projectId)) throw new Error(`Projekt ${projectId} gibt es nicht.`);

        const input: Record<string, unknown> = {
          projectId,
          title: a.title,
          parentId: parent?.id ?? null,
          milestoneId: ms?.id ?? null,
          groupId: group?.id ?? null,
        };
        for (const f of ['desc', 'ready', 'doc', 'status', 'prio', 'categoryId', 'markId', 'tags'] as const) {
          if (a[f] !== undefined) input[f] = a[f];
        }
        if (a.deps) input['deps'] = a.deps.map((d) => taskOf(boot, d).id);

        const created = create(ctx, 'task', input) as Task;
        changed({ type: 'upsert', kind: 'task', object: created });
        const after = loadBootstrap(ctx);
        return detail(after, taskOf(after, created.id));
      }),
  );

  // Was sich per `patch` ändern lässt; Reihenfolge und Titelbild bleiben der App.
  const { order: _order, coverImageId: _cover, ...taskFields } = patchSchemas.task.shape;

  server.registerTool(
    'update_task',
    {
      title: 'Aufgabe ändern',
      description:
        'Ändert eine Aufgabe. Nur die angegebenen Felder werden angefasst. `tags` und `deps` ' +
        'ersetzen die bisherige Liste. Ort ändern: `parent`, `milestone` oder `groupId` setzen – ' +
        'mit leerem Text ("") löst sich die Aufgabe davon und landet im Backlog.',
      inputSchema: {
        task: key.describe('ID oder $Nummer der Aufgabe.'),
        ...taskFields,
        status: taskFields.status.describe(STATUS_HELP),
        prio: z.number().int().min(0).max(3).optional().describe(PRIO_HELP),
        deps: z.array(key).optional().describe('Aufgaben, auf die diese wartet (ID oder $Nummer).'),
        parent: z.string().max(64).optional().describe('Neue Elternaufgabe, "" = keine.'),
        milestone: z.string().max(64).optional().describe('Neuer Milestone, "" = keiner.'),
        groupId: z.string().max(64).optional().describe('Neue Gruppe, "" = keine.'),
        projectId: z.string().optional().describe('In anderes Projekt (nur für lose Aufgaben nötig).'),
        ready: z.boolean().optional().describe('Nur lose Aufgaben: „Ready“ statt Backlog.'),
        version: z.number().int().positive().optional().describe('Erwartete Version; ohne gilt die aktuelle.'),
      },
    },
    (a) =>
      safely(() => {
        let boot = loadBootstrap(ctx);
        const t = taskOf(boot, a.task);
        let version = a.version ?? t.version;
        const { task: _t, version: _v, parent, milestone, groupId, projectId, ready, deps, ...fields } = a;

        // Erst der Ort: `move` nimmt den ganzen Teilbaum mit.
        const relocate = parent !== undefined || milestone !== undefined || groupId !== undefined;
        if (relocate || projectId !== undefined || ready !== undefined) {
          const target = relocate
            ? {
                parentId: parent ? taskOf(boot, parent).id : null,
                milestoneId: milestone ? milestoneOf(boot, milestone).id : null,
                groupId: groupId || null,
              }
            : { parentId: t.parentId, milestoneId: t.milestoneId, groupId: t.groupId };
          const moved = move(ctx, t.id, version, {
            ...target,
            ...(projectId !== undefined ? { projectId } : {}),
            ...(ready !== undefined ? { ready } : {}),
          }) as Task;
          changed({ type: 'reload', reason: 'Über MCP verschoben' });
          version = moved.version;
          boot = loadBootstrap(ctx);
        }

        const changes: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) changes[k] = v;
        if (deps) changes['deps'] = deps.map((d) => taskOf(boot, d).id);

        if (Object.keys(changes).length) {
          const updated = patch(ctx, 'task', t.id, version, changes);
          changed(
            inBootstrap(ctx, 'task', t.id)
              ? { type: 'upsert', kind: 'task', object: updated }
              : { type: 'reload', reason: 'Über MCP geändert' },
          );
          boot = loadBootstrap(ctx);
        }
        return detail(boot, taskOf(boot, t.id));
      }),
  );

  return server;
}
