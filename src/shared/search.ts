import { effectiveTags } from './inherit.js';
import { isArchived, isDone, type Milestone, type Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Die Suche über den aktiven Bestand (Wunsch des Nutzers, über den Prototyp
 * hinaus): Titel und Beschreibung von Aufgaben, Dokumenten und Milestones.
 * Gerechnet wird im Client – der Bestand liegt ohnehin im Speicher. Das Archiv
 * gehört nicht dazu, das durchsucht der Server.
 */
export type SearchQuery = {
  /** Wörter, die alle in Titel oder Beschreibung vorkommen müssen – kleingeschrieben. */
  words: string[];
  /** `#bug`: nur Aufgaben mit einem Label, das so anfängt. */
  tags: string[];
  /** Die Eingabe ist eine Nummer (`142`, `$142`) – ihre Ziffern. */
  ref: string | null;
  /** Mit `$` davor zählt allein die Nummer, sonst auch der Text. */
  refOnly: boolean;
};

export type SearchHit = {
  kind: 'task' | 'milestone';
  id: string;
  ref: number;
  projectId: string;
  title: string;
  doc: boolean;
  done: boolean;
  item: Task | Milestone;
  /** Steht ein Wort nur in der Beschreibung: der Ausschnitt um die Fundstelle. */
  snippet: string | null;
};

export function parseQuery(raw: string): SearchQuery {
  const text = raw.trim().toLowerCase();
  const num = /^(\$?)(\d+)$/.exec(text);
  if (num) return { words: num[1] ? [] : [text], tags: [], ref: num[2] ?? null, refOnly: !!num[1] };
  const tokens = text.split(/\s+/).filter(Boolean);
  return {
    words: tokens.filter((t) => !isTag(t)),
    tags: tokens.filter(isTag).map((t) => t.slice(1)),
    ref: null,
    refOnly: false,
  };
}

const isTag = (token: string): boolean => token.length > 1 && token.startsWith('#');

export const isEmptyQuery = (q: SearchQuery): boolean => !q.words.length && !q.tags.length && !q.ref;

const SNIPPET_BEFORE = 30;
const SNIPPET_LENGTH = 110;

/** Der Text um die erste Fundstelle, auf eine Zeile gebracht. */
function snippetOf(desc: string, words: string[]): string | null {
  const flat = desc.replace(/\s+/g, ' ').trim();
  const low = flat.toLowerCase();
  const at = Math.min(...words.map((w) => low.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at)) return null;
  const start = Math.max(0, at - SNIPPET_BEFORE);
  const end = Math.min(flat.length, start + SNIPPET_LENGTH);
  return `${start > 0 ? '… ' : ''}${flat.slice(start, end)}${end < flat.length ? ' …' : ''}`;
}

const isTask = (x: Task | Milestone): x is Task => !('planned' in x);

/** Im aktiven Bestand – nur das findet die Suche. */
export const isLive = (ws: Workspace, x: Task | Milestone): boolean =>
  isTask(x) ? ws.isActive(x) : !isArchived(x);

/** Ein Eintrag als Treffer, ohne Fundstelle – auch für „Zuletzt geöffnet“. */
export const hitOf = (ws: Workspace, x: Task | Milestone): SearchHit => ({
  kind: isTask(x) ? 'task' : 'milestone',
  id: x.id,
  ref: x.ref,
  projectId: x.projectId,
  title: x.title,
  doc: isTask(x) && ws.isDoc(x),
  done: isDone(x),
  item: x,
  snippet: null,
});

/**
 * Die Treffer in Anzeigereihenfolge: das eigene Projekt zuerst, dann die
 * übrigen in ihrer Reihenfolge; darin Erledigtes zuletzt, davor Nummer vor
 * Titelanfang vor Titel vor Beschreibung.
 *
 * `projectId` ist das eigene Projekt; ohne `all` bleibt die Suche darin.
 */
export function searchWorkspace(
  ws: Workspace,
  q: SearchQuery,
  o: { projectId: string | null; all: boolean },
): SearchHit[] {
  if (isEmptyQuery(q)) return [];
  const first = q.words[0] ?? '';
  const scored: { hit: SearchHit; score: number }[] = [];

  const consider = (x: Task | Milestone, kind: SearchHit['kind']): void => {
    if (!o.all && o.projectId && x.projectId !== o.projectId) return;
    const task = kind === 'task' ? (x as Task) : null;
    if (q.tags.length) {
      if (!task) return;
      const tags = effectiveTags(ws, task).tags.map((t) => t.toLowerCase());
      if (!q.tags.every((want) => tags.some((t) => t.startsWith(want)))) return;
    }

    const title = x.title.toLowerCase();
    const inTitle = q.words.every((w) => title.includes(w));
    const number = String(x.ref);
    let score: number;
    if (q.ref && number === q.ref) score = 0;
    else if (q.ref && number.startsWith(q.ref)) score = 1;
    else if (q.refOnly) return;
    else if (inTitle) score = first && title.startsWith(first) ? 2 : 3;
    else {
      const desc = x.desc.toLowerCase();
      if (!q.words.every((w) => title.includes(w) || desc.includes(w))) return;
      score = 4;
    }

    scored.push({ score, hit: { ...hitOf(ws, x), snippet: score === 4 ? snippetOf(x.desc, q.words) : null } });
  };

  for (const m of ws.milestones) if (isLive(ws, m)) consider(m, 'milestone');
  for (const t of ws.tasks) if (isLive(ws, t)) consider(t, 'task');

  const order = new Map(
    [...ws.projects].sort((a, b) => a.order - b.order).map((p, i) => [p.id, i + 1] as const),
  );
  const rank = (h: SearchHit): number => (h.projectId === o.projectId ? 0 : (order.get(h.projectId) ?? 999));

  return scored
    .sort(
      (a, b) =>
        rank(a.hit) - rank(b.hit) ||
        Number(a.hit.done) - Number(b.hit.done) ||
        a.score - b.score ||
        a.hit.title.localeCompare(b.hit.title, 'de', { sensitivity: 'base' }) ||
        a.hit.ref - b.hit.ref,
    )
    .map((s) => s.hit);
}

/**
 * Zerlegt einen Text an den Fundstellen, für die Hervorhebung: abwechselnd
 * Text ohne und mit Treffer, beginnend ohne.
 */
export function splitMatches(text: string, words: string[]): string[] {
  const found = words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!found.length) return [text];
  return text.split(new RegExp(`(${found.join('|')})`, 'gi'));
}
