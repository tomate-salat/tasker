import { effectiveCategory, effectiveTags } from './inherit.js';
import type { Group, Milestone, Project, Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Die sichtbare Zeilenfolge einer Ansicht – einmal berechnet, von der Anzeige
 * und von der Tastatursteuerung gemeinsam benutzt. Würden beide die Reihenfolge
 * getrennt bestimmen, liefen Pfeiltasten und Bildschirm irgendwann auseinander.
 *
 * Der Bereich kann ein Projekt sein oder alle; bei mehreren bekommt jedes eine
 * Überschrift, wie im Prototyp.
 */

export type OutlineRow =
  | { type: 'project'; id: string; project: Project }
  | { type: 'milestone'; id: string; milestone: Milestone }
  | { type: 'group'; id: string; title: string; group: Group | null; count: number }
  | { type: 'task'; id: string; task: Task; depth: number };

export type OutlineView = 'plan' | 'backlog' | 'docs';

/** Filter aus der Seitenleiste. Ein gesetzter Wert schränkt ein, `null` nicht. */
export type OutlineFilter = {
  tag?: string | null;
  categoryId?: string | null;
  markId?: string | null;
};

export function outline(
  ws: Workspace,
  o: {
    view: OutlineView;
    projectIds: string[];
    collapsed: Record<string, boolean>;
    filter?: OutlineFilter;
  },
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const filtering = isFiltering(o.filter);
  const show = visibility(ws, o.filter);
  // Wird gefiltert, sind zugeklappte Äste offen – sonst versteckt man das Gesuchte.
  const open = (id: string): boolean => filtering || !o.collapsed[id];
  const many = o.projectIds.length > 1;

  const walk = (task: Task, depth: number): void => {
    if (!show(task)) return;
    rows.push({ type: 'task', id: task.id, task, depth });
    if (!open(task.id)) return;
    for (const k of ws.kids(task.id)) walk(k, depth + 1);
  };

  for (const projectId of o.projectIds) {
    const project = ws.project(projectId);
    if (!project) continue;
    const before = rows.length;

    if (o.view === 'plan') {
      const milestones = ws.milestones
        .filter((m) => m.projectId === projectId)
        .sort((a, b) => Number(b.planned) - Number(a.planned) || a.qorder - b.qorder);
      for (const m of milestones) {
        const roots = ws.msRoots(m);
        if (filtering && !roots.some(show)) continue;
        rows.push({ type: 'milestone', id: m.id, milestone: m });
        if (open(m.id)) for (const t of roots) walk(t, 0);
      }
    } else if (o.view === 'docs') {
      for (const t of docRoots(ws, projectId)) walk(t, 0);
    } else {
      const groups = ws.groups
        .filter((g) => g.projectId === projectId)
        .sort((a, b) => a.order - b.order);
      for (const g of groups) {
        const tasks = ws.tasks
          .filter((t) => t.groupId === g.id && !t.parentId)
          .sort((a, b) => a.order - b.order);
        if (filtering && !tasks.some(show)) continue;
        rows.push({ type: 'group', id: g.id, title: g.title, group: g, count: tasks.length });
        if (open(g.id)) for (const t of tasks) walk(t, 0);
      }

      const loose = looseTasks(ws, projectId);
      if (loose.length && (!filtering || loose.some(show))) {
        const id = unsortedId(projectId);
        rows.push({ type: 'group', id, title: 'Unsortiert', group: null, count: loose.length });
        if (open(id)) for (const t of loose) walk(t, 0);
      }
    }

    // Die Projektüberschrift kommt nur, wenn darunter auch etwas steht.
    if (many && rows.length > before) {
      rows.splice(before, 0, { type: 'project', id: projectId, project });
    }
  }

  return rows;
}

const isFiltering = (f: OutlineFilter | undefined): boolean =>
  !!(f && (f.tag || f.categoryId || f.markId));

/**
 * Ein Task ist sichtbar, wenn er selbst passt oder eine seiner Unteraufgaben –
 * sonst verschwände der Ast, in dem der Treffer hängt.
 */
function visibility(ws: Workspace, f: OutlineFilter | undefined): (t: Task) => boolean {
  if (!isFiltering(f)) return () => true;

  const matches = (t: Task): boolean => {
    if (f?.tag && !effectiveTags(ws, t).tags.includes(f.tag)) return false;
    if (f?.categoryId && effectiveCategory(ws, t)?.category.id !== f.categoryId) return false;
    if (f?.markId && t.markId !== f.markId) return false;
    return true;
  };

  const show = (t: Task): boolean => matches(t) || ws.kids(t.id).some(show);
  return show;
}

/** Der Sammelbereich im Backlog ist keine echte Gruppe, hat aber eine ID für den Klappzustand. */
export const unsortedId = (projectId: string): string => `unsorted:${projectId}`;

export const docRoots = (ws: Workspace, projectId: string): Task[] =>
  ws.tasks
    .filter((t) => t.projectId === projectId && t.doc && !t.parentId)
    .sort((a, b) => a.order - b.order);

/** Die Aufgaben auf derselben Ebene, in Reihenfolge – Grundlage von Einrücken und Umsortieren. */
export function siblings(ws: Workspace, t: Task): Task[] {
  if (t.parentId) return ws.kids(t.parentId);
  const ms = ws.milestone(t.milestoneId);
  if (ms) return ws.msRoots(ms);
  if (t.groupId) {
    return ws.tasks
      .filter((x) => x.groupId === t.groupId && !x.parentId)
      .sort((a, b) => a.order - b.order);
  }
  return ws.isDoc(t) ? docRoots(ws, t.projectId) : looseTasks(ws, t.projectId);
}

/** Wo eine Aufgabe hängt – dieselben Felder, die `POST /api/move` erwartet. */
export const container = (t: Task): { parentId: string | null; milestoneId: string | null; groupId: string | null } => ({
  parentId: t.parentId,
  milestoneId: t.milestoneId,
  groupId: t.groupId,
});

export const looseTasks = (ws: Workspace, projectId: string): Task[] =>
  ws.tasks
    .filter((t) => t.projectId === projectId && !t.parentId && !t.milestoneId && !t.groupId && !t.doc)
    .sort((a, b) => a.order - b.order);
