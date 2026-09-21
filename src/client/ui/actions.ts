import type { Group, Milestone, Project, Task } from '@shared/model.js';
import {
  container,
  draftMilestones,
  groupsOf,
  plannedMilestones,
  siblings,
  type Placement,
} from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';

/**
 * Handlungen, die Tastatur und Kontextmenü gemeinsam brauchen. Sie stehen hier,
 * damit beide Wege dasselbe tun – im Prototyp ist es auch dieselbe Funktion.
 */

/** Neue Aufgabe anlegen und gleich den Titel bearbeiten. */
export async function addAndEdit(input: Record<string, unknown>): Promise<void> {
  const store = useStore.getState();
  const id = await store.addTask({ title: '', ...input });
  if (id) store.edit(id, true);
}

/** Neue Aufgabe direkt unter der aktuellen, nicht am Ende der Liste. */
export async function addSibling(ws: Workspace, t: Task): Promise<void> {
  const store = useStore.getState();
  const at = siblings(ws, t).indexOf(t) + 1;
  // Neben einer Doku-Seite der obersten Ebene entsteht wieder eine Seite, keine Aufgabe.
  const place = { ...container(t), ...(t.doc && !t.parentId ? { doc: true } : {}) };
  const id = await store.addTask({ title: '', projectId: t.projectId, ...place });
  if (!id) return;
  await store.moveTask(id, { ...place, index: at });
  store.edit(id, true);
}

export async function addChild(t: Task): Promise<void> {
  const store = useStore.getState();
  store.setCollapsed(t.id, false);
  await addAndEdit({ projectId: t.projectId, parentId: t.id });
}

/**
 * Legt eine Aufgabe in einem Behälter an – hinter dem „+“ einer Gruppe und
 * hinter „Neuer Task hier“ im Kontextmenü. Die Markierung gehört dazu: sie
 * entscheidet über die smarte Gruppe.
 */
export async function addIn(projectId: string, place: Placement): Promise<void> {
  const store = useStore.getState();
  const box = place.milestoneId ?? place.groupId;
  if (box) store.setCollapsed(box, false);
  await addAndEdit({
    projectId,
    milestoneId: place.milestoneId ?? null,
    groupId: place.groupId ?? null,
    markId: place.markId ?? null,
  });
}

/** `Tab`: unter die Aufgabe darüber. */
export async function indent(ws: Workspace, t: Task): Promise<void> {
  const store = useStore.getState();
  const list = siblings(ws, t);
  const before = list[list.indexOf(t) - 1];
  if (!before) {
    store.say('Keine Aufgabe darüber, unter die eingerückt werden könnte.');
    return;
  }
  store.setCollapsed(before.id, false);
  await store.moveTask(t.id, { parentId: before.id, index: ws.kids(before.id).length });
}

/** `⇧ Tab`: eine Ebene hinauf, direkt hinter die bisherige Elternaufgabe. */
export async function outdent(ws: Workspace, t: Task): Promise<void> {
  const store = useStore.getState();
  const parent = ws.task(t.parentId);
  if (!parent) {
    store.say('Liegt schon auf der obersten Ebene.');
    return;
  }
  const list = siblings(ws, parent);
  await store.moveTask(t.id, { ...container(parent), index: list.indexOf(parent) + 1 });
}

/** Aus Milestone oder Gruppe heraus zurück in den losen Backlog. */
export const toBacklog = (t: Task): Promise<void> =>
  useStore.getState().moveTask(t.id, { parentId: null, milestoneId: null, groupId: null });

/**
 * Milestone oder Gruppe eine Stelle nach oben oder unten. Beide Zeilen ändern
 * sich, deshalb gehen die zwei Änderungen als **ein** Schritt-Paar zum Server:
 * so hängt auch nur ein Eintrag im Rücknahme-Stapel.
 */
export async function moveRowBy(
  ws: Workspace,
  item: Milestone | Group,
  delta: 1 | -1,
): Promise<void> {
  const list = neighbours(ws, item);
  const other = list[list.indexOf(item) + delta];
  if (!other) return;
  // Eingeplante Milestones stehen nach `qorder`, alles andere nach `order`.
  const key = 'planned' in item && item.planned ? 'qorder' : 'order';
  const kind = 'planned' in item ? 'milestone' : 'group';
  const value = (x: Milestone | Group): unknown => (x as unknown as Record<string, unknown>)[key];

  await useStore.getState().runSteps(
    [
      { op: 'patch', kind, id: item.id, version: item.version, changes: { [key]: value(other) } },
      { op: 'patch', kind, id: other.id, version: other.version, changes: { [key]: value(item) } },
    ],
    () => 'Verschoben',
  );
}

/** Projekt in der Seitenleiste eine Stelle nach oben oder unten – ein Schritt-Paar. */
export async function moveProjectBy(ws: Workspace, p: Project, delta: 1 | -1): Promise<void> {
  const other = ws.projects[ws.projects.indexOf(p) + delta];
  if (!other) return;
  await useStore.getState().runSteps(
    [
      { op: 'patch', kind: 'project', id: p.id, version: p.version, changes: { order: other.order } },
      { op: 'patch', kind: 'project', id: other.id, version: other.version, changes: { order: p.order } },
    ],
    () => 'Verschoben',
  );
}

/** Ob es über oder unter dieser Zeile noch eine gleichrangige gibt. */
export function canMoveRow(ws: Workspace, item: Milestone | Group, delta: 1 | -1): boolean {
  const list = neighbours(ws, item);
  return !!list[list.indexOf(item) + delta];
}

const neighbours = (ws: Workspace, item: Milestone | Group): (Milestone | Group)[] =>
  'planned' in item
    ? item.planned
      ? plannedMilestones(ws, item.projectId)
      : draftMilestones(ws, item.projectId)
    : groupsOf(ws, item.projectId);
