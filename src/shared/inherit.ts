import type { Category, Mark, Project, Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Kategorien werden nach unten vererbt: ohne eigene gilt die des nächsten
 * übergeordneten Tasks. `from` ist null, wenn die Kategorie dem Task selbst
 * gehört, sonst der Task, von dem sie stammt.
 *
 * Abgeleitet, nie gespeichert – wird eine Unteraufgabe verschoben, ändert sich
 * ihre geerbte Kategorie dadurch automatisch.
 */
export function effectiveCategory(
  ws: Workspace,
  t: Task,
): { category: Category; from: Task | null } | null {
  let x: Task | null = t;
  const seen = new Set<string>();
  while (x && !seen.has(x.id)) {
    seen.add(x.id);
    const category = ws.category(x.categoryId);
    if (category) return { category, from: x === t ? null : x };
    x = ws.task(x.parentId);
  }
  return null;
}

/** Die Markierung eines Tasks, ohne eigene die des nächsten Vorfahren – wie `effectiveCategory`. */
export function effectiveMark(ws: Workspace, t: Task): Mark | null {
  const seen = new Set<string>();
  for (let x: Task | null = t; x && !seen.has(x.id); x = ws.task(x.parentId)) {
    seen.add(x.id);
    const mark = ws.mark(x.markId);
    if (mark) return mark;
  }
  return null;
}

/** Wem das Titelbild einer Karte gehört – der Task selbst oder eine Vorgabe darüber. */
export type CoverFrom =
  | { kind: 'task'; task: Task }
  | { kind: 'category'; category: Category }
  | { kind: 'mark'; mark: Mark }
  | { kind: 'project'; project: Project };

/**
 * Das Titelbild einer Karte (Kartenansicht, Versuch) über die Kette
 * Projekt → Kategorie → Markierung → Task → Unteraufgabe → …: es gilt das
 * spezifischste gesetzte Bild, das Projekt ist die letzte Vorgabe. Zuerst der
 * Task und seine Vorfahren (der nächste gewinnt), dann seine Markierung, dann
 * seine Kategorie – beide wie die Kategorie auch geerbt –, zuletzt das Projekt.
 *
 * Abgeleitet, nie gespeichert – wie `effectiveCategory`.
 */
export function effectiveCover(ws: Workspace, t: Task): { imageId: string; from: CoverFrom } | null {
  const chain: Task[] = [];
  const seen = new Set<string>();
  for (let x: Task | null = t; x && !seen.has(x.id); x = ws.task(x.parentId)) {
    seen.add(x.id);
    chain.push(x);
  }

  const task = chain.find((x) => x.coverImageId);
  if (task?.coverImageId) return { imageId: task.coverImageId, from: { kind: 'task', task } };

  const mark = effectiveMark(ws, t);
  if (mark?.coverImageId) return { imageId: mark.coverImageId, from: { kind: 'mark', mark } };

  const category = effectiveCategory(ws, t)?.category;
  if (category?.coverImageId) return { imageId: category.coverImageId, from: { kind: 'category', category } };

  const project = ws.project(t.projectId);
  if (project?.coverImageId) return { imageId: project.coverImageId, from: { kind: 'project', project } };

  return null;
}

/** Für Tooltips: woher ein geerbtes Titelbild kommt. */
export function coverFromLabel(from: CoverFrom): string {
  switch (from.kind) {
    case 'task':
      return `„${from.task.title || 'Ohne Titel'}“`;
    case 'category':
      return `der Kategorie „${from.category.name}“`;
    case 'mark':
      return `der Markierung ${from.mark.emoji} ${from.mark.name}`;
    case 'project':
      return `dem Projekt „${from.project.name}“`;
  }
}

export type EffectiveTags = {
  /** Eigene zuerst, danach die geerbten. */
  tags: string[];
  own: string[];
  /** Aus Unteraufgaben übernommen, mit Herkunft für den Tooltip. */
  extra: { tag: string; from: Task }[];
};

/**
 * Die Labels, die in diesen Projekten schon vorkommen, sortiert – die
 * Vorschläge beim Vergeben. Labels anderer Projekte bleiben dort.
 */
export function projectTags(ws: Workspace, projectIds: Iterable<string>): string[] {
  const ids = new Set(projectIds);
  return [...new Set(ws.tasks.filter((t) => ids.has(t.projectId)).flatMap((t) => t.tags))].sort();
}

/**
 * Labels wandern umgekehrt nach oben: ein Task zeigt zusätzlich alle Labels
 * seiner Unteraufgaben. Gespeichert bleibt bei jedem Task nur, was direkt an
 * ihm hängt.
 */
export function effectiveTags(ws: Workspace, t: Task): EffectiveTags {
  const own = t.tags;
  const seen = new Set(own);
  const extra: { tag: string; from: Task }[] = [];

  for (const d of ws.desc(t)) {
    for (const tag of d.tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      extra.push({ tag, from: d });
    }
  }

  return { tags: [...own, ...extra.map((x) => x.tag)], own, extra };
}
