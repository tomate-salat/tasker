import { isDone, TASK_STATUS, type Group, type Milestone, type Prio, type Task } from '@shared/model.js';
import {
  doneInContainer,
  draftMilestones,
  groupsOf,
  isLooseRoot,
  plannedMilestones,
  type OutlineRow,
} from '@shared/outline.js';
import { effectiveCategory } from '@shared/inherit.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { addChild, addIn, addSibling, canMoveRow, moveRowBy, toBacklog } from './actions.js';
import { MS_STATUS, STATUS_LABEL } from './icons.js';
import type { MenuItem } from './Menu.js';

/**
 * Die Kontextmenüs einer einzelnen Zeile – aus dem Prototyp übernommen
 * (`taskMenu`, `docMenu`, `msMenu`, `grpMenu`). Für eine Mehrfachauswahl gilt
 * stattdessen `bulkMenu`.
 *
 * Die Menüs werden beim Öffnen gebaut und lesen den Speicher direkt: so zeigen
 * Häkchen und gesperrte Einträge immer den Stand von genau diesem Augenblick.
 */
export function rowMenu(ws: Workspace, row: OutlineRow): MenuItem[] {
  if (row.type === 'task') return ws.isDoc(row.task) ? docMenu(ws, row.task) : taskMenu(ws, row.task);
  if (row.type === 'milestone') return milestoneMenu(ws, row.milestone);
  if (row.type === 'group') return groupMenu(ws, row);
  return [];
}

const STATUSES = TASK_STATUS;
const PRIOS: Prio[] = [0, 1, 2, 3];

export function taskMenu(ws: Workspace, t: Task): MenuItem[] {
  const store = useStore.getState();
  const done = isDone(t);

  return [
    { label: 'Details öffnen', onSelect: () => store.select(t.id) },
    { label: 'Umbenennen', kbd: 'F2', onSelect: () => store.edit(t.id) },
    {
      label: done ? 'Als offen markieren' : 'Als erledigt markieren',
      kbd: 'Leertaste',
      onSelect: () => void store.patch('task', t.id, { status: done ? 'open' : 'done' }),
    },
    { label: 'Status', sub: statusSub(t) },
    { label: 'Kategorie', sub: categorySub(ws, t) },
    { label: 'Markierung', sub: markSub(ws, t) },
    { sep: true },
    { label: 'Neuer Task darunter', kbd: 'Enter', onSelect: () => void addSibling(ws, t) },
    { label: 'Neue Unteraufgabe', kbd: '⇧ Enter', onSelect: () => void addChild(t) },
    { sep: true },
    {
      label: 'Priorität',
      chips: PRIOS.map((v) => ({
        label: v ? `P${v}` : '–',
        on: t.prio === v,
        onSelect: () => void store.patch('task', t.id, { prio: v }),
      })),
    },
    { sep: true },
    { label: 'Verschieben nach', sub: moveSub(ws, t) },
    { label: 'In anderes Projekt', sub: taskProjectSub(ws, t) },
    { label: 'In den Backlog', kbd: 'B', disabled: isLooseRoot(t), onSelect: () => void toBacklog(t) },
    { sep: true },
    { label: 'Duplizieren', onSelect: () => void store.duplicateTask(t.id) },
    { label: 'Archivieren', kbd: 'A', onSelect: () => void store.archiveItem('task', t.id) },
    { sep: true },
    {
      label: 'In den Papierkorb',
      kbd: 'Entf',
      danger: true,
      onSelect: () => void store.remove('task', t.id),
    },
  ];
}

/** Eine Dokumentationsseite kennt weder Status noch Priorität. */
export function docMenu(ws: Workspace, t: Task): MenuItem[] {
  const store = useStore.getState();
  return [
    { label: 'Details öffnen', onSelect: () => store.select(t.id) },
    { label: 'Umbenennen', kbd: 'F2', onSelect: () => store.edit(t.id) },
    { sep: true },
    { label: 'Neue Seite darunter', kbd: 'Enter', onSelect: () => void addSibling(ws, t) },
    { label: 'Neue Unterseite', kbd: '⇧ Enter', onSelect: () => void addChild(t) },
    { sep: true },
    { label: 'Kategorie', sub: categorySub(ws, t) },
    { label: 'Verschieben nach', sub: moveSub(ws, t) },
    { label: 'In anderes Projekt', sub: taskProjectSub(ws, t, { doc: true }) },
    { sep: true },
    { label: 'Duplizieren', onSelect: () => void store.duplicateTask(t.id) },
    { label: 'Archivieren', kbd: 'A', onSelect: () => void store.archiveItem('task', t.id) },
    { sep: true },
    {
      label: 'In den Papierkorb',
      kbd: 'Entf',
      danger: true,
      onSelect: () => void store.remove('task', t.id),
    },
  ];
}

export function milestoneMenu(ws: Workspace, m: Milestone): MenuItem[] {
  const store = useStore.getState();
  const collapsed = !!store.collapsed[m.id];
  const donePending = doneInContainer(ws, m.projectId, { milestoneId: m.id });

  return [
    { label: 'Details öffnen', onSelect: () => store.select(m.id) },
    { label: 'Umbenennen', kbd: 'F2', onSelect: () => store.edit(m.id) },
    {
      label: 'Neuer Task darin',
      kbd: 'Enter',
      onSelect: () => void addIn(m.projectId, { milestoneId: m.id }),
    },
    { sep: true },
    {
      label: 'Status',
      sub: (['open', 'progress', 'done'] as const).map((s) => ({
        label: MS_STATUS[s],
        check: m.status === s,
        onSelect: () => void store.patch('milestone', m.id, { status: s }),
      })),
    },
    {
      label: m.planned ? 'Zurück in den Backlog' : 'In den Plan',
      onSelect: () => void store.patch('milestone', m.id, { planned: !m.planned }),
    },
    {
      label: 'Nach oben',
      disabled: !canMoveRow(ws, m, -1),
      onSelect: () => void moveRowBy(ws, m, -1),
    },
    {
      label: 'Nach unten',
      disabled: !canMoveRow(ws, m, 1),
      onSelect: () => void moveRowBy(ws, m, 1),
    },
    {
      label: 'In anderes Projekt',
      sub: ws.projects.map((p) => ({
        label: p.name,
        check: p.id === m.projectId,
        onSelect: () => {
          if (p.id === m.projectId) return;
          // Der Milestone nimmt seine Aufgaben mit; das erledigt der Server.
          void store.patch('milestone', m.id, { projectId: p.id });
        },
      })),
    },
    {
      label: collapsed ? 'Aufklappen' : 'Zuklappen',
      kbd: collapsed ? '→' : '←',
      onSelect: () => store.setCollapsed(m.id, !collapsed),
    },
    { sep: true },
    {
      label: 'Erledigte Tasks archivieren',
      disabled: !donePending.length,
      onSelect: () => void archiveTasks(donePending),
    },
    {
      label: 'Milestone archivieren',
      kbd: 'A',
      onSelect: () => void store.archiveItem('milestone', m.id),
    },
    { sep: true },
    {
      label: 'In den Papierkorb',
      kbd: 'Entf',
      danger: true,
      onSelect: () => void store.remove('milestone', m.id),
    },
  ];
}

/** Gruppen, „Unsortiert“ und die smarten Gruppen – drei Varianten, wie im Prototyp. */
export function groupMenu(ws: Workspace, row: Extract<OutlineRow, { type: 'group' }>): MenuItem[] {
  const store = useStore.getState();
  const collapsed = !!store.collapsed[row.id];
  const donePending = doneInContainer(ws, row.projectId, row.place);

  const common: MenuItem[] = [
    {
      label: collapsed ? 'Aufklappen' : 'Zuklappen',
      onSelect: () => store.setCollapsed(row.id, !collapsed),
    },
    {
      label: 'Erledigte archivieren',
      disabled: !donePending.length,
      onSelect: () => void archiveTasks(donePending),
    },
  ];

  if (row.mark) {
    return [
      { label: 'Neuer Task hier', onSelect: () => void addIn(row.projectId, row.place) },
      ...common,
      { sep: true },
      { label: 'Markierungen verwalten …', onSelect: () => store.setDialog('marks') },
    ];
  }

  if (!row.group) {
    return [
      { label: 'Neuer Task hier', onSelect: () => void addIn(row.projectId, row.place) },
      ...common,
      { sep: true },
      { label: 'Neue Gruppe', onSelect: () => void newGroup(row.projectId) },
    ];
  }

  const g: Group = row.group;
  return [
    { label: 'Neuer Task in dieser Gruppe', onSelect: () => void addIn(row.projectId, row.place) },
    { label: 'Umbenennen', onSelect: () => store.edit(g.id) },
    {
      label: 'Nach oben',
      disabled: !canMoveRow(ws, g, -1),
      onSelect: () => void moveRowBy(ws, g, -1),
    },
    {
      label: 'Nach unten',
      disabled: !canMoveRow(ws, g, 1),
      onSelect: () => void moveRowBy(ws, g, 1),
    },
    ...common,
    { sep: true },
    { label: 'Neue Gruppe', onSelect: () => void newGroup(row.projectId) },
    { label: 'Gruppe löschen', danger: true, onSelect: () => void store.remove('group', g.id) },
  ];
}

/* ------------------------------------------------------------- Untermenüs */

const statusSub = (t: Task): MenuItem[] =>
  STATUSES.map((s) => ({
    label: STATUS_LABEL[s],
    check: t.status === s,
    onSelect: () => void useStore.getState().patch('task', t.id, { status: s }),
  }));

export function categorySub(ws: Workspace, t: Task): MenuItem[] {
  const store = useStore.getState();
  const effective = effectiveCategory(ws, t);
  const own = ws.categories
    .filter((c) => c.projectId === t.projectId)
    .sort((a, b) => a.order - b.order);

  return [
    ...(effective?.from
      ? [{ head: `Geerbt: ${effective.category.name} (von „${effective.from.title}“)` }]
      : []),
    {
      label: effective?.from ? 'Keine eigene' : 'Keine',
      check: !t.categoryId,
      onSelect: () => void store.patch('task', t.id, { categoryId: null }),
    },
    ...own.map((c) => ({
      label: c.name,
      check: t.categoryId === c.id,
      onSelect: () => void store.patch('task', t.id, { categoryId: c.id }),
    })),
    { sep: true },
    { label: 'Kategorien verwalten …', onSelect: () => store.setDialog('categories') },
  ];
}

export function markSub(ws: Workspace, t: Task): MenuItem[] {
  const store = useStore.getState();
  return [
    {
      label: 'Keine',
      check: !t.markId,
      onSelect: () => void store.patch('task', t.id, { markId: null }),
    },
    ...ws.marks.map((k) => ({
      label: `${k.emoji} ${k.name}`,
      check: t.markId === k.id,
      onSelect: () => void store.patch('task', t.id, { markId: k.id }),
    })),
    { sep: true },
    { label: 'Markierungen verwalten …', onSelect: () => store.setDialog('marks') },
  ];
}

/**
 * Die Ziele innerhalb des Projekts: Dokumentation, Backlog mit Unsortiert und
 * den smarten Gruppen, die eigenen Gruppen, dann die Milestones. Das Häkchen
 * steht beim Behälter, in dem die Aufgabe schon liegt.
 */
function moveSub(ws: Workspace, t: Task): MenuItem[] {
  const store = useStore.getState();
  const projectId = t.projectId;
  const loose = { parentId: null, milestoneId: null, groupId: null };
  // Eine Unteraufgabe liegt in keinem Behälter – dann passt nirgends ein Haken.
  const here = t.parentId ? null : key(t);

  const to = (target: Record<string, unknown>, label: string): MenuItem => ({
    label,
    check: here === keyOf(target),
    onSelect: () => {
      if (here === keyOf(target)) return;
      void store.moveTask(t.id, { projectId, ...target, index: Number.MAX_SAFE_INTEGER });
    },
  });

  const items: MenuItem[] = [
    { head: 'Dokumentation' },
    to({ ...loose, markId: null, doc: true }, '📄 Dokumentation'),
    { head: 'Backlog' },
    to({ ...loose, markId: null, doc: false }, 'Unsortiert'),
    ...ws.marks.map((k) => to({ ...loose, markId: k.id, doc: false }, `${k.emoji} ${k.name}`)),
    ...groupsOf(ws, projectId).map((g) =>
      to({ ...loose, groupId: g.id, markId: null, doc: false }, g.title || 'Neue Gruppe'),
    ),
  ];

  const milestones = (list: Milestone[], head: string): void => {
    if (!list.length) return;
    items.push({ head });
    for (const m of list) {
      items.push(to({ ...loose, milestoneId: m.id, doc: false }, `◆ ${m.title || 'Ohne Titel'}`));
    }
  };
  milestones(plannedMilestones(ws, projectId), 'Milestones im Plan');
  milestones(draftMilestones(ws, projectId), 'Vorbereitete Milestones');

  return items;
}

/** „In anderes Projekt“: die Aufgabe landet dort im Backlog, eine Seite in der Doku. */
function taskProjectSub(ws: Workspace, t: Task, o: { doc?: boolean } = {}): MenuItem[] {
  const store = useStore.getState();
  return ws.projects.map((p) => ({
    label: p.name,
    check: p.id === t.projectId,
    onSelect: () => {
      if (p.id === t.projectId) return;
      void store.moveTask(t.id, {
        parentId: null,
        milestoneId: null,
        groupId: null,
        markId: null,
        doc: !!o.doc,
        projectId: p.id,
        index: Number.MAX_SAFE_INTEGER,
      });
    },
  }));
}

/* ----------------------------------------------------------------- Hilfen */

/** Ein Behälter als Zeichenkette, damit sich Ziel und Ist vergleichen lassen. */
const keyOf = (t: Record<string, unknown>): string =>
  t['doc']
    ? 'doc'
    : t['milestoneId']
      ? `m:${String(t['milestoneId'])}`
      : t['groupId']
        ? `g:${String(t['groupId'])}`
        : `k:${String(t['markId'] ?? '')}`;

const key = (t: Task): string =>
  keyOf({ doc: t.doc, milestoneId: t.milestoneId, groupId: t.groupId, markId: t.markId });

/** Mehrere Aufgaben in einem Zug archivieren – ein Eintrag im Rücknahme-Stapel. */
const archiveTasks = (tasks: Task[]): Promise<void> =>
  useStore.getState().runSteps(
    tasks.map((t) => ({ op: 'archive' as const, kind: 'task' as const, id: t.id })),
    (n) => `${n} ${n === 1 ? 'Aufgabe' : 'Aufgaben'} archiviert`,
  );

/** „Neue Gruppe“: leer anlegen und gleich den Namen tippen, wie im Prototyp. */
async function newGroup(projectId: string): Promise<void> {
  const store = useStore.getState();
  const id = await store.addGroup('', projectId);
  if (id) store.edit(id);
}
