import { z } from 'zod';
import { TASK_STATUS } from './model.js';

/** Was der Client anlegen und ändern darf – die Grenze zwischen außen und innen. */

const id = z.string().min(1).max(64);
const title = z.string().max(500);
const desc = z.string().max(200_000);
const prio = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const tag = z.string().min(1).max(60);
const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum muss YYYY-MM-DD sein')
  .nullable();

export const KINDS = ['project', 'category', 'mark', 'group', 'milestone', 'task'] as const;
export type Kind = (typeof KINDS)[number];
export const kindSchema = z.enum(KINDS);

export const createSchemas = {
  project: z.object({ name: title, color: z.string().max(32).optional() }),
  category: z.object({ projectId: id, name: title }),
  mark: z.object({ emoji: z.string().min(1).max(8), name: title }),
  group: z.object({ projectId: id, title }),
  milestone: z.object({
    projectId: id,
    title,
    desc: desc.optional(),
    planned: z.boolean().optional(),
  }),
  // Die Schnell-Erfassung setzt schon beim Anlegen mehr als nur den Titel,
  // deshalb darf `create` dieselben Felder wie `patch` entgegennehmen.
  task: z.object({
    projectId: id,
    title: title.optional(),
    desc: desc.optional(),
    parentId: id.nullable().optional(),
    milestoneId: id.nullable().optional(),
    groupId: id.nullable().optional(),
    doc: z.boolean().optional(),
    prio: prio.optional(),
    status: z.enum(TASK_STATUS).optional(),
    categoryId: id.nullable().optional(),
    markId: id.nullable().optional(),
    /** Nur für lose Wurzeln: gleich in „Ready“ anlegen. */
    ready: z.boolean().optional(),
    tags: z.array(tag).optional(),
    deps: z.array(id).optional(),
  }),
} satisfies Record<Kind, z.ZodType>;

export const patchSchemas = {
  project: z.object({ name: title, color: z.string().max(32), order: z.number() }).partial(),
  category: z.object({ name: title, order: z.number() }).partial(),
  mark: z.object({ emoji: z.string().min(1).max(8), name: title, order: z.number() }).partial(),
  group: z.object({ title, order: z.number() }).partial(),
  milestone: z
    .object({
      title,
      desc,
      /** „In anderes Projekt“: der Milestone nimmt seine Wurzelaufgaben mit. */
      projectId: id,
      planned: z.boolean(),
      status: z.enum(TASK_STATUS),
      order: z.number(),
      qorder: z.number(),
      startDate: isoDay,
      endDate: isoDay,
      endAuto: z.boolean(),
      deps: z.array(id),
    })
    .partial(),
  task: z
    .object({
      title,
      desc,
      prio,
      status: z.enum(TASK_STATUS),
      order: z.number(),
      categoryId: id.nullable(),
      markId: id.nullable(),
      /** Titelbild der Karte – ID eines Galeriebildes. */
      coverImageId: id.nullable(),
      doc: z.boolean(),
      tags: z.array(tag),
      deps: z.array(id),
    })
    .partial(),
} satisfies Record<Kind, z.ZodType>;

/** Jede Änderung nennt die Version, auf der sie beruht – sonst 409. */
export const patchBody = z.object({
  version: z.number().int().positive(),
  changes: z.record(z.string(), z.unknown()),
});

/** Wohin eine Aufgabe wandert – ohne zu sagen, welche. */
export const moveTarget = z.object({
  parentId: id.nullable().optional(),
  milestoneId: id.nullable().optional(),
  groupId: id.nullable().optional(),
  /**
   * Nur für lose Wurzeln: `ready` trennt Backlog und „Ready“; dort bestimmt die
   * Markierung die smarte Gruppe, ohne Markierung die Kategorie. Fehlt ein
   * Feld, bleibt es, wie es war.
   */
  markId: id.nullable().optional(),
  ready: z.boolean().optional(),
  categoryId: id.nullable().optional(),
  /** Nur nötig, wenn das Ziel kein eigenes Projekt mitbringt (Unsortiert, smarte Gruppe). */
  projectId: id.optional(),
  /** In die Dokumentation oder heraus. Fehlt das Feld, bleibt es, wie es war. */
  doc: z.boolean().optional(),
  order: z.number().optional(),
  /** Platz unter den künftigen Geschwistern; der Server nummeriert danach neu. */
  index: z.number().int().min(0).optional(),
});

/** Codecks-Export als CSV-Text; mit `dryRun` nur zählen, was ankäme. */
export const codecksImportBody = z.object({
  csv: z.string().min(1).max(20_000_000),
  dryRun: z.boolean().optional(),
});

/** Codecks-Verweise ($3yw) in schon importierten Texten umwandeln – mit allen Exporten auf einmal. */
export const codecksRefsBody = z.object({
  csvs: z.array(z.string().min(1).max(20_000_000)).min(1).max(20),
  dryRun: z.boolean().optional(),
});

/** Ein Codecks-Verweis in einem Text und was aus ihm wird. */
export type CodecksRefChange = {
  code: string;
  /** Die Tasker-Nummer des Ziels – oder null, wenn es keins eindeutig gibt. */
  ref: number | null;
  /** Titel des Ziels in Tasker. */
  target: string | null;
  /** Ohne Ziel: Link auf die Karte in Codecks. */
  link: string | null;
  /** Warum es kein Ziel gibt. */
  reason: string | null;
};

export type CodecksRefsResult = {
  texts: { kind: 'task' | 'milestone'; id: string; title: string; changes: CodecksRefChange[] }[];
  /** Projekte, deren Verweise schon umgewandelt wurden – sie bleiben unberührt. */
  skipped: string[];
  /** Projekte aus dem Export, die es in Tasker nicht gibt. */
  unknownProjects: string[];
};

/** Was ein Codecks-Import anlegt – bei der Vorschau: anlegen würde. */
export type CodecksSummary = {
  projects: string[];
  categories: string[];
  labels: string[];
  milestones: string[];
  tasks: number;
  subtasks: number;
  docs: number;
  unclear: number;
};

/** „Duplizieren“ aus dem Kontextmenü: eine Aufgabe samt allem, was daran hängt. */
export const duplicateBody = z.object({ id });

/** „In Milestone umwandeln“: aus dem Task wird ein vorbereiteter Milestone. */
export const convertBody = z.object({ id, version: z.number().int().positive() });

/** Verschieben innerhalb des Baums: neuer Platz plus neue Reihenfolge. */
export const moveBody = moveTarget.extend({
  id,
  version: z.number().int().positive(),
});

/**
 * Mehrfachauswahl: eine Handlung auf vielen Aufgaben, als eine Transaktion.
 * Jede Aufgabe nennt ihre Version – passt eine nicht, bleibt alles, wie es war.
 *
 * Verschieben, Archivieren und In-den-Papierkorb nehmen Unteraufgaben ohnehin
 * mit; der Server überspringt deshalb Ausgewählte, deren Vorfahre auch dabei
 * ist. Das ist `topSelected` aus dem Prototyp.
 */
export const bulkBody = z.object({
  items: z.array(z.object({ id, version: z.number().int().positive() })).min(1).max(1000),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('patch'),
      changes: z
        .object({
          status: z.enum(TASK_STATUS),
          prio,
          categoryId: id.nullable(),
          markId: id.nullable(),
        })
        .partial(),
    }),
    z.object({ type: z.literal('tag'), tag, add: z.boolean() }),
    z.object({ type: z.literal('move'), target: moveTarget }),
    z.object({ type: z.literal('archive') }),
    z.object({ type: z.literal('trash') }),
  ]),
});

export type BulkAction = z.infer<typeof bulkBody>['action'];
export type BulkItem = z.infer<typeof bulkBody>['items'][number];

/**
 * Ein einzelner Schritt für `POST /api/steps`: eine Liste kleiner Operationen,
 * die zusammen in einer Transaktion laufen.
 *
 * Zwei Dinge brauchen das. „Erledigte archivieren“ fasst Milestones **und**
 * Aufgaben in einem Rutsch – das kann `/api/bulk` nicht, der kennt nur
 * Aufgaben. Und die **Rücknahme**: jede schreibende Route liefert die
 * Gegen-Schritte gleich mit, der Client legt sie auf seinen Stapel und schickt
 * sie bei „Rückgängig“ hierher zurück. Der Server führt damit keinen eigenen
 * Verlauf – er weiß nur, wie man etwas rückwärts tut.
 */
/** Eine Zeile des Papierkorbs, so wie sie in der Datenbank steht. */
export const trashRow = z.object({
  id,
  kind: z.string().max(20),
  title: z.string().max(2000),
  project_id: id.nullable(),
  payload: z.string(),
  deleted_at: z.string().max(40),
});

export type TrashRow = z.infer<typeof trashRow>;

/** „Endgültig löschen“ für einen oder mehrere Einträge („Papierkorb leeren“). */
export const purgeBody = z.object({ ids: z.array(id).min(1).max(10_000) });

/* ---------------------------------------------------- Ordner der Galerie */

const folderName = z.string().min(1).max(120);

export const folderCreate = z.object({
  projectId: id.nullable().default(null),
  parentId: id.nullable().default(null),
  name: folderName,
});

export const folderPatch = z
  .object({ name: folderName, parentId: id.nullable() })
  .partial()
  .refine((b) => b.name !== undefined || b.parentId !== undefined, {
    message: 'Nichts zu ändern',
  });

/** Bilder in einen Ordner legen – `folderId: null` heißt: ganz nach oben. */
export const folderSort = z.object({
  ids: z.array(id).min(1).max(1000),
  folderId: id.nullable(),
});

export const stepSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('patch'),
    kind: kindSchema,
    id,
    version: z.number().int().positive(),
    changes: z.record(z.string(), z.unknown()),
  }),
  z.object({
    op: z.literal('move'),
    id,
    version: z.number().int().positive(),
    target: moveTarget,
  }),
  z.object({ op: z.literal('archive'), kind: z.enum(['task', 'milestone']), id }),
  z.object({ op: z.literal('unarchive'), kind: z.enum(['task', 'milestone']), id }),
  z.object({ op: z.literal('trash'), kind: kindSchema, id }),
  /**
   * Weg, ohne Umweg über den Papierkorb – für Zwischenstände, die nur eine
   * Rücknahme wieder loswerden muss, etwa der Milestone aus „In Milestone
   * umwandeln“. Im Papierkorb wäre er nur Ballast.
   */
  z.object({ op: z.literal('purge'), kind: kindSchema, id }),
  z.object({ op: z.literal('untrash'), trashId: id }),
  /**
   * Endgültig Gelöschtes zurück in den Papierkorb – wie im Prototyp, wo auch
   * „Endgültig löschen“ ein „Rückgängig“ hat. Die Zeilen kennt nur noch der
   * Client, also schickt er sie mit.
   */
  z.object({ op: z.literal('unpurge'), rows: z.array(trashRow).min(1).max(1000) }),
]);

export const stepsBody = z.object({ steps: z.array(stepSchema).min(1).max(1000) });

export type Step = z.infer<typeof stepSchema>;

/** Was eine schreibende Route zurückgibt, wenn sie rückgängig gemacht werden kann. */
export type Undoable = { count: number; undo: Step[] };

/**
 * Zeichnungen: die Szene ist der Excalidraw-Zustand und wird am Stück
 * gespeichert. Geprüft wird nur die Form, nicht jedes einzelne Element –
 * das Format gehört Excalidraw, nicht uns.
 */
export const sceneSchema = z.object({
  elements: z.array(z.unknown()).max(20_000),
  files: z.record(z.string(), z.unknown()).optional(),
});

/** Eine Zeichnung gehört einer Aufgabe oder einem Milestone – genau einem von beiden. */
export const drawingCreate = z
  .object({ taskId: id.optional(), milestoneId: id.optional(), name: title.optional() })
  .refine((b) => !b.taskId !== !b.milestoneId, { message: 'taskId oder milestoneId angeben' });

export const drawingPatch = z.object({
  version: z.number().int().positive(),
  changes: z.object({ name: title, scene: sceneSchema, order: z.number() }).partial(),
});

export const settingsBody = z
  .object({
    velocity: z.number().int().min(1).max(200),
    theme: z.enum(['system', 'light', 'dark']),
    imageMaxKb: z.number().int().min(50).max(5000),
    imageMaxEdge: z.number().int().min(400).max(8000),
  })
  .partial();

export const archiveQuery = z.object({
  q: z.string().max(200).optional(),
  projectId: id.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Verweise ins Archiv: eine aktive Aufgabe darf von einer archivierten
 * abhängen. Damit der Inspektor den Titel zeigen kann, kommt dieser Platzhalter
 * mit – statt das ganze Archiv zu laden.
 */
export type Stub = { id: string; title: string; archived: true };
