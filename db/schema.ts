/**
 * Drizzle-Schema für Tasker. Abgeleitet aus dem Prototyp-State (`S` in
 * prototype/index.html), siehe PHASE-2.md, Abschnitt 3.
 *
 * Konventionen:
 * - `id` ist ein Text-Schlüssel, so wie im Prototyp ('t1', 'm3', …).
 * - Zeitpunkte sind ISO-Strings, Tage sind 'YYYY-MM-DD'. Beides bleibt in der
 *   Datenbankdatei lesbar, was bei einer Datei, die man selbst sichert, viel wert ist.
 * - `version` zählt bei jeder Änderung hoch und dient der Konflikterkennung,
 *   wenn mehrere Tabs oder Geräte gleichzeitig offen sind.
 * - Reiner Anzeigezustand (Auswahl, geöffneter Inspektor, zugeklappte Zeilen)
 *   steht bewusst NICHT hier, sondern im Client.
 */
import { relations, sql } from 'drizzle-orm';
import {
  type AnySQLiteColumn,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

/** Fortschrittskette plus die beiden Sonderstatus. */
export const TASK_STATUS = ['open', 'progress', 'done', 'unclear', 'blocked'] as const;
export const MILESTONE_STATUS = ['open', 'progress', 'done', 'unclear', 'blocked'] as const;

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

/** Spalten, die jede inhaltliche Tabelle hat. */
const tracked = {
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
  version: integer('version').notNull().default(1),
};

/* ------------------------------------------------------------------ Projekte */

export const projects = sqliteTable('project', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#2A6B5A'),
  order: integer('sort_order').notNull().default(0),
  ...tracked,
});

/** Kategorien gehören zu einem Projekt und vererben sich im Baum nach unten. */
export const categories = sqliteTable(
  'category',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    order: integer('sort_order').notNull().default(0),
    ...tracked,
  },
  (t) => [index('category_project_idx').on(t.projectId)],
);

/** Markierungen (Emoji + Name) gelten projektübergreifend. */
export const marks = sqliteTable('mark', {
  id: text('id').primaryKey(),
  emoji: text('emoji').notNull(),
  name: text('name').notNull(),
  order: integer('sort_order').notNull().default(0),
  ...tracked,
});

/* ---------------------------------------------------------------- Milestones */

export const milestones = sqliteTable(
  'milestone',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    desc: text('desc').notNull().default(''),
    /** Eingeplant (mit Zeitraum) oder nur gesammelt. */
    planned: integer('planned', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: MILESTONE_STATUS }).notNull().default('open'),
    order: integer('sort_order').notNull().default(0),
    /** Reihenfolge in der Planungsansicht, unabhängig von der Listenreihenfolge. */
    qorder: integer('queue_order').notNull().default(0),
    startDate: text('start_date'),
    endDate: text('end_date'),
    /** Enddatum stammt aus der Prognose, nicht von Hand gesetzt. */
    endAuto: integer('end_auto', { mode: 'boolean' }).notNull().default(false),
    archivedAt: text('archived_at'),
    ...tracked,
  },
  (t) => [index('milestone_project_idx').on(t.projectId)],
);

/** Gruppen sind die leichte Zwischenebene im Backlog. */
export const groups = sqliteTable(
  'group',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    order: integer('sort_order').notNull().default(0),
    ...tracked,
  },
  (t) => [index('group_project_idx').on(t.projectId)],
);

/* --------------------------------------------------------------------- Tasks */

/**
 * Ein einziger Task-Typ, beliebig tief verschachtelt (Hierarchie-Modell A).
 * Ein Task hängt entweder an einem Elternteil, an einem Milestone, an einer
 * Gruppe – oder an nichts, dann liegt er lose im Backlog.
 *
 * `done` gibt es bewusst nicht mehr: im Prototyp war es immer `status === 'done'`
 * und damit eine zweite Wahrheit, die auseinanderlaufen kann.
 */
export const tasks = sqliteTable(
  'task',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => tasks.id, { onDelete: 'cascade' }),
    milestoneId: text('milestone_id').references(() => milestones.id, { onDelete: 'set null' }),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'set null' }),
    /** Dokument statt Aufgabe – eigene Ansicht, eigener Inspektor. */
    doc: integer('doc', { mode: 'boolean' }).notNull().default(false),
    title: text('title').notNull().default(''),
    desc: text('desc').notNull().default(''),
    /** 0 = keine, 1 = hoch, 2 = mittel, 3 = niedrig (wie im Prototyp). */
    prio: integer('prio').notNull().default(0),
    status: text('status', { enum: TASK_STATUS }).notNull().default('open'),
    doneAt: text('done_at'),
    order: integer('sort_order').notNull().default(0),
    categoryId: text('category_id').references(() => categories.id, { onDelete: 'set null' }),
    markId: text('mark_id').references(() => marks.id, { onDelete: 'set null' }),
    /** Gesetzt nur beim ausdrücklich archivierten Eintrag. */
    archivedAt: text('archived_at'),
    /**
     * ID des archivierten Vorfahren (Task oder Milestone), wenn dieser Task nur
     * mitgegangen ist. Abgeleitet, aber gespeichert: so ist „was ist aktiv?“ ein
     * indizierter Filter statt einer rekursiven Abfrage bei jedem Laden.
     * Gepflegt beim Archivieren, Wiederherstellen und Verschieben.
     */
    hiddenBy: text('hidden_by'),
    ...tracked,
  },
  (t) => [
    index('task_project_idx').on(t.projectId),
    index('task_parent_idx').on(t.parentId),
    index('task_milestone_idx').on(t.milestoneId),
    index('task_group_idx').on(t.groupId),
    index('task_status_idx').on(t.status),
    index('task_active_idx').on(t.hiddenBy, t.archivedAt),
  ],
);

/** Labels. Im Prototyp ein Array am Task, hier eine Zuordnung – abfragbar und zählbar. */
export const taskTags = sqliteTable(
  'task_tag',
  {
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    tag: text('tag').notNull(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.tag] }), index('task_tag_tag_idx').on(t.tag)],
);

/**
 * Abhängigkeiten für Tasks und Milestones in einer Tabelle. `kind` sagt, worauf
 * sich die IDs beziehen; deshalb gibt es hier bewusst keinen Fremdschlüssel.
 * „from hängt ab von to“, also wird `from` durch `to` blockiert.
 */
export const dependencies = sqliteTable(
  'dependency',
  {
    kind: text('kind', { enum: ['task', 'milestone'] }).notNull(),
    fromId: text('from_id').notNull(),
    toId: text('to_id').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.fromId, t.toId] }),
    index('dependency_to_idx').on(t.kind, t.toId),
  ],
);

/** Zeichnungen gehören zu einem Task und werden über ![[zeichnung:Name]] eingebettet. */
export const drawings = sqliteTable(
  'drawing',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    order: integer('sort_order').notNull().default(0),
    /** Die Formen als JSON – sie werden nie einzeln abgefragt, nur als Ganzes. */
    shapes: text('shapes', { mode: 'json' }).notNull().default(sql`'[]'`),
    ...tracked,
  },
  (t) => [index('drawing_task_idx').on(t.taskId)],
);

/** Tagespunkte für den Burnup eines Milestones (im Prototyp `m.log`). */
export const milestoneLog = sqliteTable(
  'milestone_log',
  {
    milestoneId: text('milestone_id')
      .notNull()
      .references(() => milestones.id, { onDelete: 'cascade' }),
    /** 'YYYY-MM-DD' */
    day: text('day').notNull(),
    /** Umfang an diesem Tag. */
    scope: integer('scope').notNull(),
    /** Davon erledigt. */
    done: integer('done').notNull(),
  },
  (t) => [primaryKey({ columns: [t.milestoneId, t.day] })],
);

/* ------------------------------------------------------- Papierkorb, Konto, Sitzung */

/**
 * Gelöschtes wandert mit allem, was daran hängt, als JSON hierher und läuft
 * nach einer Frist ab. Das Wiederherstellen schreibt es zurück in die Tabellen.
 */
export const trash = sqliteTable(
  'trash',
  {
    id: text('id').primaryKey(),
    kind: text('kind', { enum: ['task', 'milestone', 'group', 'project'] }).notNull(),
    title: text('title').notNull(),
    projectId: text('project_id'),
    /** Vollständige Kopie der gelöschten Objekte. */
    payload: text('payload', { mode: 'json' }).notNull(),
    deletedAt: text('deleted_at').notNull().default(now),
  },
  (t) => [index('trash_deleted_idx').on(t.deletedAt)],
);

/**
 * Alles, wovon es genau eine Zeile gibt: Konto (E-Mail, Name, Avatar,
 * Passwort-Hash) und dauerhafte Einstellungen (Theme, Tempo, zuletzt gewähltes
 * Projekt). Ein einziger Nutzer, deshalb keine `user_id` an den Tabellen.
 */
export const settings = sqliteTable('setting', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Angemeldete Sitzungen, damit „Abmelden“ tatsächlich abmeldet. */
export const sessions = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    createdAt: text('created_at').notNull().default(now),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull().default(now),
    userAgent: text('user_agent'),
  },
  (t) => [index('session_expires_idx').on(t.expiresAt)],
);

/* ----------------------------------------------------------------- Relationen */

export const projectRelations = relations(projects, ({ many }) => ({
  categories: many(categories),
  milestones: many(milestones),
  groups: many(groups),
  tasks: many(tasks),
}));

export const taskRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, { fields: [tasks.projectId], references: [projects.id] }),
  parent: one(tasks, { fields: [tasks.parentId], references: [tasks.id], relationName: 'subtasks' }),
  children: many(tasks, { relationName: 'subtasks' }),
  milestone: one(milestones, { fields: [tasks.milestoneId], references: [milestones.id] }),
  group: one(groups, { fields: [tasks.groupId], references: [groups.id] }),
  category: one(categories, { fields: [tasks.categoryId], references: [categories.id] }),
  mark: one(marks, { fields: [tasks.markId], references: [marks.id] }),
  tags: many(taskTags),
  drawings: many(drawings),
}));

export const milestoneRelations = relations(milestones, ({ one, many }) => ({
  project: one(projects, { fields: [milestones.projectId], references: [projects.id] }),
  tasks: many(tasks),
  log: many(milestoneLog),
}));

/* ---------------------------------------------------------------------- Typen */

export type Project = typeof projects.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Mark = typeof marks.$inferSelect;
export type Milestone = typeof milestones.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type TaskTag = typeof taskTags.$inferSelect;
export type Dependency = typeof dependencies.$inferSelect;
export type Drawing = typeof drawings.$inferSelect;
export type MilestoneLogEntry = typeof milestoneLog.$inferSelect;
export type TrashEntry = typeof trash.$inferSelect;
export type Session = typeof sessions.$inferSelect;

export type TaskStatus = (typeof TASK_STATUS)[number];
export type MilestoneStatus = (typeof MILESTONE_STATUS)[number];
