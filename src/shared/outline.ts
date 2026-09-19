import type { Group, Milestone, Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Die sichtbare Zeilenfolge einer Ansicht – einmal berechnet, von der Anzeige
 * und von der Tastatursteuerung gemeinsam benutzt. Würden beide die Reihenfolge
 * getrennt bestimmen, liefen Pfeiltasten und Bildschirm irgendwann auseinander.
 */

export type OutlineRow =
  | { type: 'milestone'; id: string; milestone: Milestone }
  | { type: 'group'; id: string; title: string; group: Group | null; count: number }
  | { type: 'task'; id: string; task: Task; depth: number };

export type OutlineView = 'plan' | 'backlog' | 'docs';

export function outline(
  ws: Workspace,
  o: { view: OutlineView; projectId: string; collapsed: Record<string, boolean> },
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const open = (id: string): boolean => !o.collapsed[id];

  const walk = (task: Task, depth: number): void => {
    rows.push({ type: 'task', id: task.id, task, depth });
    if (!open(task.id)) return;
    for (const k of ws.kids(task.id)) walk(k, depth + 1);
  };

  if (o.view === 'plan') {
    const milestones = ws.milestones
      .filter((m) => m.projectId === o.projectId)
      .sort((a, b) => Number(b.planned) - Number(a.planned) || a.qorder - b.qorder);
    for (const m of milestones) {
      rows.push({ type: 'milestone', id: m.id, milestone: m });
      if (open(m.id)) for (const t of ws.msRoots(m)) walk(t, 0);
    }
    return rows;
  }

  if (o.view === 'docs') {
    for (const t of docRoots(ws, o.projectId)) walk(t, 0);
    return rows;
  }

  const groups = ws.groups
    .filter((g) => g.projectId === o.projectId)
    .sort((a, b) => a.order - b.order);
  for (const g of groups) {
    const tasks = ws.tasks
      .filter((t) => t.groupId === g.id && !t.parentId)
      .sort((a, b) => a.order - b.order);
    rows.push({ type: 'group', id: g.id, title: g.title, group: g, count: tasks.length });
    if (open(g.id)) for (const t of tasks) walk(t, 0);
  }

  const loose = looseTasks(ws, o.projectId);
  if (loose.length) {
    const id = unsortedId(o.projectId);
    rows.push({ type: 'group', id, title: 'Unsortiert', group: null, count: loose.length });
    if (open(id)) for (const t of loose) walk(t, 0);
  }

  return rows;
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
