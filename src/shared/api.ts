import { z } from 'zod';
import { TASK_STATUS } from './model.js';

/** Was der Client anlegen und ändern darf – die Grenze zwischen außen und innen. */

const id = z.string().min(1).max(64);
const title = z.string().max(500);
const desc = z.string().max(200_000);
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
    prio: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
    status: z.enum(TASK_STATUS).optional(),
    categoryId: id.nullable().optional(),
    markId: id.nullable().optional(),
    tags: z.array(z.string().min(1).max(60)).optional(),
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
      prio: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
      status: z.enum(TASK_STATUS),
      order: z.number(),
      categoryId: id.nullable(),
      markId: id.nullable(),
      doc: z.boolean(),
      tags: z.array(z.string().min(1).max(60)),
      deps: z.array(id),
    })
    .partial(),
} satisfies Record<Kind, z.ZodType>;

/** Jede Änderung nennt die Version, auf der sie beruht – sonst 409. */
export const patchBody = z.object({
  version: z.number().int().positive(),
  changes: z.record(z.string(), z.unknown()),
});

/** Verschieben innerhalb des Baums: neuer Platz plus neue Reihenfolge. */
export const moveBody = z.object({
  id,
  version: z.number().int().positive(),
  parentId: id.nullable().optional(),
  milestoneId: id.nullable().optional(),
  groupId: id.nullable().optional(),
  order: z.number().optional(),
  /** Platz unter den künftigen Geschwistern; der Server nummeriert danach neu. */
  index: z.number().int().min(0).optional(),
});

/**
 * Zeichnungen: die Szene ist der Excalidraw-Zustand und wird am Stück
 * gespeichert. Geprüft wird nur die Form, nicht jedes einzelne Element –
 * das Format gehört Excalidraw, nicht uns.
 */
export const sceneSchema = z.object({
  elements: z.array(z.unknown()).max(20_000),
  files: z.record(z.string(), z.unknown()).optional(),
});

export const drawingCreate = z.object({ taskId: id, name: title.optional() });

export const drawingPatch = z.object({
  version: z.number().int().positive(),
  changes: z.object({ name: title, scene: sceneSchema, order: z.number() }).partial(),
});

export const settingsBody = z
  .object({
    velocity: z.number().int().min(1).max(200),
    theme: z.enum(['system', 'light', 'dark']),
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
