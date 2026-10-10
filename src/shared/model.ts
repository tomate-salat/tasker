/**
 * Die Datentypen, mit denen Server und Client rechnen.
 *
 * Bewusst unabhängig vom Drizzle-Schema: der Server setzt die Zeilen aus den
 * Tabellen zu diesen Objekten zusammen (Labels und Abhängigkeiten werden dabei
 * zu Arrays), der Client bekommt genau diese Form.
 */

export const TASK_STATUS = ['open', 'progress', 'done', 'unclear', 'blocked'] as const;
export type Status = (typeof TASK_STATUS)[number];

/** 0 = keine, 1 = hoch, 2 = mittel, 3 = niedrig. */
export type Prio = 0 | 1 | 2 | 3;

export type Project = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  name: string;
  color: string;
  order: number;
  /** Vorgabe für das Titelbild der Karten – siehe `coverOf` in der Kartenansicht. */
  coverImageId: string | null;
};

export type Category = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  projectId: string;
  name: string;
  order: number;
  /** Vorgabe für das Titelbild der Karten – siehe `coverOf` in der Kartenansicht. */
  coverImageId: string | null;
};

export type Mark = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  /** Wie Kategorien gehören Markierungen zu einem Projekt. */
  projectId: string;
  emoji: string;
  name: string;
  order: number;
  /** Vorgabe für das Titelbild der Karten – siehe `coverOf` in der Kartenansicht. */
  coverImageId: string | null;
};

export type Group = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  projectId: string;
  title: string;
  order: number;
};

/** Fasst Milestones zu einer Version zusammen – siehe PHASE-2.md, „Releases“. */
export type Release = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  projectId: string;
  /** Die Versionsbezeichnung, freier Text wie „0.4.0“ – `version` ist schon vergeben. */
  name: string;
  title: string;
  /** Die Einleitung fürs Changelog. */
  desc: string;
  order: number;
  archivedAt: string | null;
};

/** Eine Veröffentlichung je Kanal (itch-Seite, Steam-Demo, …). */
export type ReleaseStage = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  releaseId: string;
  name: string;
  order: number;
  /** Gesetzt, sobald auf diesem Kanal veröffentlicht ist. */
  doneAt: string | null;
};

/** Eine Überschrift im Changelog eines Releases – steht zwischen den Einträgen der Tasks. */
export type ReleaseHeading = {
  id: string;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  releaseId: string;
  title: string;
  /** Platz in der Liste, gemeinsam mit `Task.changelogOrder`. */
  order: number;
};

export type Milestone = {
  id: string;
  /** Kurze, feste Nummer für Verweise im Text ($142) – gemeinsame Folge mit den Tasks. */
  ref: number;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  projectId: string;
  /** Das Release, zu dem dieser Milestone gehört – höchstens eines. */
  releaseId: string | null;
  title: string;
  desc: string;
  planned: boolean;
  status: Status;
  order: number;
  /** Reihenfolge in der Planung. */
  qorder: number;
  startDate: string | null;
  endDate: string | null;
  endAuto: boolean;
  archivedAt: string | null;
  /** IDs anderer Milestones, von denen dieser abhängt. */
  deps: string[];
};

export type Task = {
  id: string;
  /** Kurze, feste Nummer für Verweise im Text ($142) – gemeinsame Folge mit den Milestones. */
  ref: number;
  /** Zählt bei jeder Änderung hoch – Grundlage der Konflikterkennung. */
  version: number;
  projectId: string;
  parentId: string | null;
  milestoneId: string | null;
  groupId: string | null;
  doc: boolean;
  title: string;
  desc: string;
  prio: Prio;
  status: Status;
  doneAt: string | null;
  order: number;
  categoryId: string | null;
  markId: string | null;
  /** Fertig vorbereitet – nur an losen Wurzeln: steht dann in „Ready“ statt im Backlog. */
  ready: boolean;
  /** Titelbild der Karte (Kartenansicht, Versuch) – ID eines Galeriebildes. */
  coverImageId: string | null;
  /** Platz in „Im Spiel“ auf dem Tisch; bei Gleichstand gilt die Baumreihenfolge. */
  playOrder: number;
  /** Die Zeile fürs Changelog des Releases; leer heißt: noch nicht entschieden. */
  changelog: string;
  /** Bewusst kein Eintrag im Changelog. */
  changelogSkip: boolean;
  /** Platz in der Liste des Releases, gemeinsam mit den Überschriften. */
  changelogOrder: number;
  archivedAt: string | null;
  tags: string[];
  /** IDs anderer Tasks, von denen dieser abhängt. */
  deps: string[];
};

export type Data = {
  projects: Project[];
  categories: Category[];
  marks: Mark[];
  groups: Group[];
  milestones: Milestone[];
  releases: Release[];
  stages: ReleaseStage[];
  headings: ReleaseHeading[];
  tasks: Task[];
  /**
   * Archivierte Aufgaben, deren Ort noch aktiv ist, samt ihren Unteraufgaben.
   * Sie gehören nicht zu `tasks`: die Arbeitsansichten zeigen sie nicht, nur
   * Zähler und die Listen im Inspektor (siehe `Workspace.countedKids`).
   */
  archivedTasks?: Task[];
};

/** Dauerhafte Einstellungen – im Gegensatz zum reinen Anzeigezustand im Client. */
export type Settings = {
  /** Aufgaben pro Woche, Grundlage von Zeitplan und Prognose. */
  velocity: number;
  theme: 'system' | 'light' | 'dark';
  /**
   * Obergrenze je Bild in Kilobyte. Erreicht wird sie im Browser über die
   * Qualität und, wenn die nicht reicht, über die Kantenlänge – gerechnet wird
   * sie nicht, sondern gemessen.
   */
  imageMaxKb: number;
  /** Längere Kante eines Bildes in Pixeln; größeres wird verkleinert. */
  imageMaxEdge: number;
};

/** Erledigt ist kein eigenes Feld – es ist genau dieser Status. */
export const isDone = (x: { status: Status }): boolean => x.status === 'done';

export const isArchived = (x: { archivedAt: string | null }): boolean => x.archivedAt !== null;
