import type { Category, Task } from './model.js';
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
