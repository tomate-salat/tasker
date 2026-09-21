import type { CodecksSummary } from '../shared/api.js';
import type { Prio, Status } from '../shared/model.js';
import type { DbCtx } from './db.js';
import { create } from './repo.js';

/**
 * Import aus dem CSV-Export von Codecks („Export as CSV“ über die Mehrfachauswahl).
 *
 * Zuordnung, wie mit dem Nutzer abgesprochen:
 * - Projekt → Projekt. Gibt es schon eines mit dem Namen, bricht der Import ab.
 * - Hero-Card → Aufgabe, ihre Karten → Unteraufgaben.
 * - Deck einer Karte ohne Hero-Card → Kategorie; Deck einer Karte unter einer
 *   Hero-Card → Label (dort ist das Deck das Fach: Art, Coding, …). Das Deck
 *   „Backlog“ ist nur der Ablageort und wird nichts.
 * - Milestone → geplanter Milestone mit festem Enddatum.
 * - Doc-Karte → Seite in der Dokumentation.
 * - Priorität 3/2/1 → hoch/mittel/niedrig; Tag „unclear“ → Status „Unklar“.
 * - Effort, Owner und Upvotes fallen weg.
 *
 * Der Export enthält keinen Arbeitsstand, deshalb kommt alles als offen an.
 */

export type CodecksCard = {
  id: string;
  title: string;
  content: string;
  priority: string;
  tags: string[];
  state: string;
  deck: string;
  parentId: string;
  project: string;
  milestone: string;
  milestoneDate: string;
};

const COLUMNS = {
  id: 'Card id',
  title: 'Title',
  content: 'Content',
  priority: 'Priority',
  tags: 'Project tags',
  state: 'Workflow state',
  deck: 'Deck name',
  parentId: 'Parent Card Id',
  project: 'Project name',
  milestone: 'Milestone name',
  milestoneDate: 'Milestone date',
} as const;

/** Das Deck, in dem Codecks neue Karten ablegt – kein inhaltlicher Ort. */
const PLAIN_DECK = 'Backlog';

/** Semikolon-getrennt, Felder in Anführungszeichen, Zeilenumbrüche im Feld erlaubt. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (src[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ';') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field || row.length) rows.push([...row, field.replace(/\r$/, '')]);
  return rows.filter((r) => r.some((f) => f !== ''));
}

export function readCodecksCsv(text: string): CodecksCard[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) throw new Error('Die Datei ist leer.');
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, name]) => [key, head.indexOf(name)]),
  ) as Record<keyof typeof COLUMNS, number>;
  const missing = Object.entries(index)
    .filter(([key, i]) => i < 0 && key !== 'parentId' && key !== 'milestone' && key !== 'milestoneDate')
    .map(([key]) => COLUMNS[key as keyof typeof COLUMNS]);
  if (missing.length) {
    throw new Error(`Das ist kein Codecks-Export mit allen nötigen Spalten – es fehlt: ${missing.join(', ')}.`);
  }

  const get = (r: string[], key: keyof typeof COLUMNS): string =>
    index[key] < 0 ? '' : (r[index[key]] ?? '').trim();
  return rows.map((r) => ({
    id: get(r, 'id'),
    title: get(r, 'title'),
    content: r[index.content] ?? '',
    priority: get(r, 'priority'),
    tags: get(r, 'tags')
      .split(/[,\s]+/)
      .map((t) => t.replace(/^#/, ''))
      .filter(Boolean),
    state: get(r, 'state'),
    deck: get(r, 'deck'),
    parentId: get(r, 'parentId'),
    project: get(r, 'project'),
    milestone: get(r, 'milestone'),
    milestoneDate: get(r, 'milestoneDate'),
  }));
}

const PRIO: Record<string, Prio> = { '3': 1, '2': 2, '1': 3 };

/** Codecks schreibt den Titel als erste Zeile in den Inhalt – der Rest ist die Beschreibung. */
export function descOf(card: CodecksCard): string {
  const lines = card.content.replace(/\r\n/g, '\n').split('\n');
  if (lines[0]?.trim() === card.title) lines.shift();
  return lines.join('\n').trim();
}

/** Labels kennen keine Leerzeichen („#game-design“ in der Schnellerfassung). */
export const deckLabel = (deck: string): string => deck.trim().toLowerCase().replace(/\s+/g, '-');

class DryRun extends Error {}

/**
 * Legt alles in einer Transaktion an. Mit `dryRun` läuft derselbe Weg und wird
 * am Ende zurückgerollt – die Vorschau zählt also genau, was ankäme.
 */
export function importCodecks(ctx: DbCtx, text: string, o: { dryRun?: boolean } = {}): CodecksSummary {
  const cards = readCodecksCsv(text);
  if (!cards.length) throw new Error('Die Datei enthält keine Karten.');
  let summary!: CodecksSummary;

  try {
    ctx.sqlite.transaction(() => {
      summary = write(ctx, cards);
      if (o.dryRun) throw new DryRun();
    })();
  } catch (e) {
    if (!(e instanceof DryRun)) throw e;
  }
  return summary;
}

function write(ctx: DbCtx, cards: CodecksCard[]): CodecksSummary {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const unknownParent = cards.find((c) => c.parentId && !byId.has(c.parentId));
  if (unknownParent) {
    throw new Error(
      `„${unknownParent.title}“ hängt an einer Hero-Card, die nicht im Export ist. Bitte die Hero-Card mit exportieren.`,
    );
  }

  const summary: CodecksSummary = {
    projects: [],
    categories: [],
    labels: [],
    milestones: [],
    tasks: 0,
    subtasks: 0,
    docs: 0,
    unclear: 0,
  };

  const projectIds = new Map<string, string>();
  const categoryIds = new Map<string, string>();
  const milestoneIds = new Map<string, string>();
  const taskIds = new Map<string, string>();

  const projectOf = (name: string): string => {
    const key = name || 'Codecks';
    let id = projectIds.get(key);
    if (id) return id;
    const exists = ctx.sqlite.prepare('SELECT 1 FROM project WHERE name = ?').get(key);
    if (exists) throw new Error(`Das Projekt „${key}“ gibt es schon – der Import würde es doppelt anlegen.`);
    id = (create(ctx, 'project', { name: key }) as { id: string }).id;
    projectIds.set(key, id);
    summary.projects.push(key);
    return id;
  };

  const categoryOf = (projectId: string, deck: string): string | null => {
    if (!deck || deck === PLAIN_DECK) return null;
    const key = `${projectId}\n${deck}`;
    let id = categoryIds.get(key);
    if (!id) {
      id = (create(ctx, 'category', { projectId, name: deck }) as { id: string }).id;
      categoryIds.set(key, id);
      summary.categories.push(deck);
    }
    return id;
  };

  const milestoneOf = (projectId: string, card: CodecksCard): string | null => {
    if (!card.milestone) return null;
    const key = `${projectId}\n${card.milestone}`;
    let id = milestoneIds.get(key);
    if (!id) {
      const date = /^\d{4}-\d{2}-\d{2}/.exec(card.milestoneDate)?.[0] ?? null;
      id = (
        create(ctx, 'milestone', {
          projectId,
          title: card.milestone,
          planned: true,
          endDate: date,
          endAuto: !date,
        }) as { id: string }
      ).id;
      milestoneIds.set(key, id);
      summary.milestones.push(card.milestone);
    }
    return id;
  };

  // Hero-Cards vor ihren Karten, sonst gibt es den Elternteil noch nicht.
  const ordered = [...cards.filter((c) => !c.parentId), ...cards.filter((c) => c.parentId)];

  for (const card of ordered) {
    const parent = card.parentId ? byId.get(card.parentId) : undefined;
    const projectId = projectOf(parent?.project || card.project);
    const doc = card.state === 'doc';
    const unclear = card.tags.includes('unclear');
    const tags = card.tags.filter((t) => t !== 'unclear');
    if (parent && card.deck && card.deck !== PLAIN_DECK) {
      const label = deckLabel(card.deck);
      if (!tags.includes(label)) tags.push(label);
      if (!summary.labels.includes(label)) summary.labels.push(label);
    }

    const status: Status = unclear ? 'unclear' : 'open';
    const task = create(ctx, 'task', {
      projectId,
      title: card.title,
      desc: descOf(card),
      prio: PRIO[card.priority] ?? 0,
      status,
      doc,
      tags,
      ...(parent
        ? { parentId: taskIds.get(parent.id) }
        : {
            milestoneId: doc ? null : milestoneOf(projectId, card),
            categoryId: doc ? null : categoryOf(projectId, card.deck),
          }),
    }) as { id: string };
    taskIds.set(card.id, task.id);

    if (doc) summary.docs++;
    else if (parent) summary.subtasks++;
    else summary.tasks++;
    if (unclear) summary.unclear++;
  }

  return summary;
}
