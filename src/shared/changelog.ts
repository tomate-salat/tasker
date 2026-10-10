import type { Release, ReleaseHeading, Status, Task } from './model.js';
import { releaseLabel } from './release.js';

/**
 * Das Changelog eines Releases (siehe PHASE-2.md, „Releases“): die Zeilen
 * stehen an den Tasks, das Release sammelt sie ein. Dazwischen stehen
 * Überschriften, und die Reihenfolge legt der Nutzer von Hand fest.
 *
 * Gerechnet wird auf einer flachen Liste statt auf dem `Workspace`: ins
 * Changelog gehört auch Archiviertes, und das liefert der Server gesondert.
 */
export type ChangelogTask = Pick<
  Task,
  'id' | 'ref' | 'version' | 'parentId' | 'milestoneId' | 'title' | 'status' | 'changelog' | 'changelogSkip' | 'changelogOrder'
> & {
  /** Selbst archiviert oder mit einem Vorfahren im Archiv – dann fehlt die Aufgabe im aktiven Bestand. */
  archived: boolean;
};

export type ChangelogMilestone = {
  id: string;
  ref: number;
  title: string;
  status: Status;
  archived: boolean;
  /** Nicht zugeordnet, sondern über eine Abhängigkeit mitgezählt – siehe `effectiveReleases`. */
  inherited: boolean;
};

/** Was `GET /api/changelog/<release>` liefert. */
export type ChangelogData = { milestones: ChangelogMilestone[]; tasks: ChangelogTask[] };

/** Unentschieden, eine Zeile, oder bewusst keine. */
export type ChangelogState = 'open' | 'entry' | 'none';

export const changelogState = (t: Pick<Task, 'changelog' | 'changelogSkip'>): ChangelogState =>
  t.changelogSkip ? 'none' : t.changelog.trim() ? 'entry' : 'open';

export type ChangelogItem =
  | { kind: 'heading'; id: string; order: number; heading: ReleaseHeading }
  /** `done`: die Aufgabe ist erledigt – nur dann steht die Zeile im fertigen Changelog. */
  | { kind: 'entry'; id: string; order: number; task: ChangelogTask; done: boolean };

export type Changelog = {
  /** Einträge und Überschriften in der Reihenfolge des Nutzers. */
  items: ChangelogItem[];
  /** Erledigt, aber noch ohne Entscheidung. */
  undecided: ChangelogTask[];
};

export function buildChangelog(tasks: ChangelogTask[], headings: ReleaseHeading[]): Changelog {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const kidsOf = new Map<string, ChangelogTask[]>();
  for (const t of tasks) {
    if (!t.parentId) continue;
    const list = kidsOf.get(t.parentId);
    if (list) list.push(t);
    else kidsOf.set(t.parentId, [t]);
  }

  // Eine Unteraufgabe erbt die Entscheidung ihrer Eltern-Aufgabe.
  const inherits = (t: ChangelogTask): boolean => {
    const seen = new Set([t.id]);
    for (let p = byId.get(t.parentId ?? ''); p && !seen.has(p.id); p = byId.get(p.parentId ?? '')) {
      if (changelogState(p) !== 'open') return true;
      seen.add(p.id);
    }
    return false;
  };
  // Sind alle Unteraufgaben entschieden, ist es auch die Aufgabe darüber.
  const resolved = (t: ChangelogTask): boolean => {
    if (changelogState(t) !== 'open') return true;
    const kids = kidsOf.get(t.id) ?? [];
    return kids.length > 0 && kids.every(resolved);
  };

  const items: ChangelogItem[] = [
    ...headings.map((h): ChangelogItem => ({ kind: 'heading', id: h.id, order: h.order, heading: h })),
    ...tasks
      .filter((t) => changelogState(t) === 'entry')
      .map((t): ChangelogItem => ({
        kind: 'entry',
        id: t.id,
        order: t.changelogOrder,
        task: t,
        done: t.status === 'done',
      })),
  ].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

  return {
    items,
    undecided: tasks.filter((t) => t.status === 'done' && !resolved(t) && !inherits(t)),
  };
}

/**
 * Das fertige Changelog als Markdown: nur was erledigt ist. Eine Überschrift,
 * unter der (noch) nichts steht, fällt weg.
 */
export function changelogMarkdown(release: Pick<Release, 'name' | 'title' | 'desc'>, items: ChangelogItem[]): string {
  const out: string[] = [`## ${releaseLabel(release)}`];
  if (release.desc.trim()) out.push('', release.desc.trim());

  let pending: string | null = null;
  let listOpen = false;
  for (const item of items) {
    if (item.kind === 'heading') {
      pending = item.heading.title.trim() || 'Ohne Titel';
      continue;
    }
    if (!item.done) continue;
    if (pending !== null) {
      out.push('', `### ${pending}`, '');
      pending = null;
    } else if (!listOpen) out.push('');
    listOpen = true;
    out.push(`- ${item.task.changelog.trim()}`);
  }
  return `${out.join('\n')}\n`;
}

/**
 * Die Liste nach dem Verschieben: `id` kommt vor `beforeId` (oder ans Ende).
 * Zurück kommen nur die Plätze, die sich dadurch ändern.
 */
export function reorderChangelog(
  items: ChangelogItem[],
  id: string,
  beforeId: string | null,
): { item: ChangelogItem; order: number }[] {
  const moving = items.find((x) => x.id === id);
  if (!moving || id === beforeId) return [];
  const rest = items.filter((x) => x.id !== id);
  const at = beforeId ? rest.findIndex((x) => x.id === beforeId) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, moving);
  // Die vorhandenen Plätze werden neu verteilt – so bleibt alles unter dem, was später dazukommt.
  const orders = items.map((x) => x.order).sort((a, b) => a - b);
  const distinct = orders.every((o, i) => i === 0 || o > orders[i - 1]!);
  return rest
    .map((item, i) => ({ item, order: distinct ? orders[i]! : i + 1 }))
    .filter((x) => x.order !== x.item.order);
}
