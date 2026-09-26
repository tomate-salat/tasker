import type { Category, Mark, Milestone, Prio, Project, Status, Task } from './model.js';
import { isArchived } from './model.js';
import { marksOf } from './outline.js';
import type { Workspace } from './workspace.js';

/**
 * Die Schnell-Erfassung aus dem Prototyp: eine Zeile Text wird zu einer
 * Aufgabe. Reine Funktion – sie liest den Bestand und gibt zurück, was
 * angelegt würde, ohne etwas zu ändern. Genau das braucht auch die Vorschau
 * beim Tippen.
 *
 * ```
 * Titel #label !1 >Ziel +Projekt ~status %Markierung &Kategorie @nach:Aufgabe
 * ```
 *
 * Werte mit Leerzeichen kommen in Anführungszeichen: `>"Vertical Slice"`.
 */

const KEYS = ['@nach:', '#', '!', '>', '+', '~', '%', '&'] as const;

/** Wohin die neue Aufgabe kommt. */
export type QuickTarget =
  | { kind: 'milestone'; milestone: Milestone }
  | { kind: 'group'; group: { id: string; title: string } }
  | { kind: 'task'; task: Task };

export type QuickAdd = {
  title: string;
  /** Das Projekt, in dem die Aufgabe landet – aus `+` oder das aktuelle. */
  projectId: string;
  tags: string[];
  prio: Prio;
  status: Status | null;
  target: QuickTarget | null;
  mark: Mark | null;
  category: Category | null;
  dep: Task | null;
  /** Was gesucht, aber nicht gefunden wurde – für die Vorschau. */
  missing: { field: 'Projekt' | 'Ort' | 'Markierung' | 'Kategorie' | 'Abhängigkeit'; query: string }[];
};

export function parseQuickAdd(ws: Workspace, text: string, currentProjectId: string): QuickAdd {
  const tags: string[] = [];
  const missing: QuickAdd['missing'] = [];
  let prio: Prio = 0;
  let status: Status | null = null;
  let targetQuery: string | null = null;
  let projectQuery: string | null = null;
  let markQuery: string | null = null;
  let categoryQuery: string | null = null;
  let depQuery: string | null = null;

  const rest = text.replace(
    /(^|\s)(@nach:|[#!>+~%&])("([^"]*)"|\S+)/g,
    (whole, space: string, key: string, raw: string, quoted: string | undefined) => {
      const value = quoted ?? raw;
      if (!value) return whole;
      switch (key) {
        case '#':
          tags.push(value.toLowerCase());
          return space;
        case '!': {
          const n = Number(value);
          // Alles außer 1–3 ist kein Prioritätszeichen, sondern Text.
          if (n !== 1 && n !== 2 && n !== 3) return whole;
          prio = n as Prio;
          return space;
        }
        case '~': {
          const st = STATUS_LETTER[value.toLowerCase()[0] ?? ''];
          if (!st) return whole;
          status = st;
          return space;
        }
        case '>':
          targetQuery = value;
          return space;
        case '+':
          projectQuery = value;
          return space;
        case '%':
          markQuery = value;
          return space;
        case '&':
          categoryQuery = value;
          return space;
        default:
          depQuery = value;
          return space;
      }
    },
  );

  let title = rest.replace(/\s+/g, ' ').trim();

  const project = projectQuery ? findProject(ws, projectQuery) : null;
  if (projectQuery && !project) missing.push({ field: 'Projekt', query: projectQuery });
  const projectId = project?.id ?? currentProjectId;

  let mark: Mark | null = null;
  if (markQuery) {
    mark = findMark(ws, markQuery, projectId);
    if (!mark) missing.push({ field: 'Markierung', query: markQuery });
  } else {
    // Ein Titel, der mit dem Emoji einer Markierung beginnt, bekommt sie automatisch.
    const hit = marksOf(ws, projectId).find((m) => emoji(m.emoji) && emoji(title).startsWith(emoji(m.emoji)));
    if (hit) {
      mark = hit;
      title = title.replace(/^\S+\s*/, '').trim();
    }
  }

  let target: QuickTarget | null = null;
  if (targetQuery) {
    // Erst im gewählten Projekt suchen; ohne ausdrückliches `+` notfalls überall.
    target = findTarget(ws, targetQuery, [projectId]);
    if (!target && !project) {
      target = findTarget(ws, targetQuery, ws.projects.map((p) => p.id));
    }
    if (!target) missing.push({ field: 'Ort', query: targetQuery });
  }

  let category: Category | null = null;
  if (categoryQuery) {
    category = findCategory(ws, categoryQuery, targetProject(target) ?? projectId);
    if (!category) missing.push({ field: 'Kategorie', query: categoryQuery });
  }

  let dep: Task | null = null;
  if (depQuery) {
    dep = findDep(ws, depQuery, targetProject(target) ?? projectId);
    if (!dep) missing.push({ field: 'Abhängigkeit', query: depQuery });
  }

  return {
    title,
    projectId: targetProject(target) ?? projectId,
    tags: [...new Set(tags)],
    prio,
    status,
    target,
    mark,
    category,
    dep,
    missing,
  };
}

/** Was daraus an `POST /api/kind/task` geht. */
export function quickAddInput(r: QuickAdd): Record<string, unknown> {
  return {
    projectId: r.projectId,
    title: r.title,
    ...(r.target?.kind === 'milestone' ? { milestoneId: r.target.milestone.id } : {}),
    ...(r.target?.kind === 'group' ? { groupId: r.target.group.id } : {}),
    ...(r.target?.kind === 'task' ? { parentId: r.target.task.id } : {}),
    ...(r.prio ? { prio: r.prio } : {}),
    ...(r.status ? { status: r.status } : {}),
    ...(r.mark ? { markId: r.mark.id } : {}),
    ...(r.category ? { categoryId: r.category.id } : {}),
    ...(r.tags.length ? { tags: r.tags } : {}),
    ...(r.dep ? { deps: [r.dep.id] } : {}),
  };
}

/** Wie die Vorschau den Zielort nennt. */
export function targetLabel(target: QuickTarget | null): string {
  if (!target) return 'Backlog › Unsortiert';
  if (target.kind === 'milestone') {
    return `◆ ${target.milestone.title}${target.milestone.planned ? '' : ' (Backlog)'}`;
  }
  if (target.kind === 'group') return `Backlog › ${target.group.title}`;
  return `unter „${target.task.title}“`;
}

/* ------------------------------------------------------------------ Intern */

const STATUS_LETTER: Record<string, Status> = {
  o: 'open',
  u: 'unclear',
  p: 'progress',
  i: 'progress',
  b: 'blocked',
  e: 'done',
  d: 'done',
};

/** Groß-/Kleinschreibung und Trennzeichen sollen beim Suchen nicht stören. */
const norm = (s: string): string => s.toLowerCase().replace(/[-_]/g, ' ').trim();

/** Emoji ohne Variationsselektor, damit ✏ und ✏️ dasselbe sind. */
const emoji = (s: string): string => s.replace(/️/g, '');

const targetProject = (t: QuickTarget | null): string | null =>
  t === null
    ? null
    : t.kind === 'milestone'
      ? t.milestone.projectId
      : t.kind === 'task'
        ? t.task.projectId
        : null;

function findProject(ws: Workspace, q: string): Project | null {
  const n = norm(q);
  return (
    ws.projects.find((p) => norm(p.name) === n) ??
    ws.projects.find((p) => norm(p.name).startsWith(n)) ??
    ws.projects.find((p) => norm(p.name).includes(n)) ??
    null
  );
}

/** Nur die Markierungen des Projekts – jedes hat seine eigenen. */
function findMark(ws: Workspace, q: string, projectId: string): Mark | null {
  const n = q.toLowerCase();
  const own = marksOf(ws, projectId);
  return (
    own.find((m) => m.name.toLowerCase() === n) ??
    own.find((m) => m.name.toLowerCase().startsWith(n)) ??
    own.find((m) => emoji(m.emoji) === emoji(q)) ??
    null
  );
}

function findCategory(ws: Workspace, q: string, projectId: string): Category | null {
  const n = norm(q);
  const inProject = ws.categories.filter((c) => c.projectId === projectId);
  return (
    inProject.find((c) => norm(c.name) === n) ??
    inProject.find((c) => norm(c.name).startsWith(n)) ??
    null
  );
}

function findDep(ws: Workspace, q: string, projectId: string): Task | null {
  const n = norm(q);
  return (
    ws.tasks
      .filter((t) => t.projectId === projectId && ws.isActive(t) && norm(t.title).includes(n))
      // Der kürzeste Treffer ist der genaueste.
      .sort((a, b) => a.title.length - b.title.length)[0] ?? null
  );
}

/**
 * Milestones vor Gruppen vor Aufgaben – ein `>Vertical Slice` meint eher den
 * Milestone als eine gleichnamige Unteraufgabe.
 */
function findTarget(ws: Workspace, q: string, projectIds: string[]): QuickTarget | null {
  const n = norm(q);
  const candidates: { target: QuickTarget; title: string; rank: number }[] = [
    ...ws.milestones
      .filter((m) => projectIds.includes(m.projectId) && !isArchived(m))
      .map((m) => ({ target: { kind: 'milestone' as const, milestone: m }, title: m.title, rank: 0 })),
    ...ws.groups
      .filter((g) => projectIds.includes(g.projectId))
      .map((g) => ({ target: { kind: 'group' as const, group: g }, title: g.title, rank: 1 })),
    ...ws.tasks
      .filter((t) => projectIds.includes(t.projectId) && ws.isActive(t))
      .map((t) => ({ target: { kind: 'task' as const, task: t }, title: t.title, rank: 2 })),
  ];

  return (
    candidates.find((c) => norm(c.title) === n)?.target ??
    candidates
      .filter((c) => norm(c.title).includes(n))
      .sort((a, b) => a.rank - b.rank || a.title.length - b.title.length)[0]?.target ??
    null
  );
}
