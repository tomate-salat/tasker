import type { BulkAction } from '@shared/api.js';
import type { Status, Task } from '@shared/model.js';
import { draftMilestones, groupsOf, plannedMilestones } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { PRIO_LABEL, STATUS_LABEL } from './icons.js';
import { useMenu, type Menu, type MenuItem } from './Menu.js';
import { readyTargets } from './rowMenu.js';

const STATUSES: Status[] = ['open', 'progress', 'done', 'unclear', 'blocked'];
const PRIOS = [0, 1, 2, 3] as const;

/**
 * Die Leiste, die bei einer Mehrfachauswahl unten einschwebt – aus dem
 * Prototyp übernommen. Jeder Knopf öffnet ein Menü und schickt genau eine
 * Anfrage für die ganze Auswahl.
 */
export function BulkBar({ ws }: { ws: Workspace }) {
  const { multi, clearMulti, bulk } = useStore();
  const menu = useMenu();
  const n = multi.size;
  if (!n) return null;

  const tasks = [...multi].map((id) => ws.task(id)).filter((t): t is Task => !!t);
  const word = (k: number): string => (k === 1 ? 'Aufgabe' : 'Aufgaben');
  const run = (action: BulkAction, what: string): void =>
    void bulk(action, (count) => `${count} ${word(count)}: ${what}`);

  return (
    <>
      <div className="bulk" role="toolbar" aria-label="Mehrfachauswahl">
        <span className="bulk-count">
          <b>{n}</b> {word(n)} ausgewählt
        </span>
        <span className="bulk-sep" />
        <Btn menu={menu} items={() => statusItems(tasks, run)}>
          Status
        </Btn>
        <Btn menu={menu} items={() => prioItems(tasks, run)}>
          Priorität
        </Btn>
        <Btn menu={menu} items={() => categoryItems(ws, tasks, run)}>
          Kategorie
        </Btn>
        <Btn menu={menu} items={() => markItems(ws, tasks, run)}>
          Markierung
        </Btn>
        <Btn menu={menu} items={() => labelItems(ws, tasks, run)}>
          Labels
        </Btn>
        <Btn menu={menu} items={() => moveItems(ws, tasks, run)}>
          Verschieben
        </Btn>
        <span className="bulk-sep" />
        <button
          className="bulk-btn"
          title="A"
          onClick={() => void bulk({ type: 'archive' }, (c) => `${c} ${word(c)} archiviert`)}
        >
          Archivieren
        </button>
        <button
          className="bulk-btn danger-text"
          title="Entf"
          onClick={() =>
            void bulk({ type: 'trash' }, (c) => `${c} ${word(c)} in den Papierkorb verschoben`)
          }
        >
          Papierkorb
        </button>
        <button
          className="icon-btn bulk-close"
          title="Auswahl aufheben (Esc)"
          aria-label="Auswahl aufheben"
          onClick={clearMulti}
        >
          ✕
        </button>
      </div>
      {menu.node}
    </>
  );
}

/**
 * Dasselbe als ein Menü – das bekommt der Rechtsklick auf eine ausgewählte
 * Zeile. Die Auswahl kommt hier aus dem Speicher, nicht aus Eigenschaften:
 * das Menü wird beim Öffnen gebaut, nicht beim Zeichnen.
 */
export function bulkMenu(ws: Workspace): MenuItem[] {
  const store = useStore.getState();
  const tasks = [...store.multi].map((id) => ws.task(id)).filter((t): t is Task => !!t);
  const word = (k: number): string => (k === 1 ? 'Aufgabe' : 'Aufgaben');
  const run: Run = (action, what) =>
    void store.bulk(action, (count) => `${count} ${word(count)}: ${what}`);

  return [
    { head: `${tasks.length} ausgewählt` },
    { label: 'Status', sub: statusItems(tasks, run) },
    { label: 'Priorität', sub: prioItems(tasks, run) },
    { label: 'Kategorie', sub: categoryItems(ws, tasks, run) },
    { label: 'Markierung', sub: markItems(ws, tasks, run) },
    { label: 'Labels', sub: labelItems(ws, tasks, run) },
    { label: 'Verschieben nach', sub: moveItems(ws, tasks, run) },
    { sep: true },
    {
      label: 'Archivieren',
      onSelect: () => void store.bulk({ type: 'archive' }, (c) => `${c} ${word(c)} archiviert`),
    },
    { label: 'Auswahl aufheben', onSelect: store.clearMulti },
    { sep: true },
    {
      label: 'In den Papierkorb',
      danger: true,
      onSelect: () =>
        void store.bulk({ type: 'trash' }, (c) => `${c} ${word(c)} in den Papierkorb verschoben`),
    },
  ];
}

/**
 * Klick auf eine Zelle einer ausgewählten Zeile: das Menü gilt der ganzen
 * Auswahl, genau wie im Prototyp (`openCell` mit `bulkItems`).
 */
export function bulkCellMenu(ws: Workspace, kind: 'mark' | 'prio' | 'cat' | 'tags'): MenuItem[] {
  const store = useStore.getState();
  const tasks = [...store.multi].map((id) => ws.task(id)).filter((t): t is Task => !!t);
  const word = (k: number): string => (k === 1 ? 'Aufgabe' : 'Aufgaben');
  const run: Run = (action, what) =>
    void store.bulk(action, (count) => `${count} ${word(count)}: ${what}`);

  if (kind === 'prio') return prioItems(tasks, run);
  if (kind === 'mark') return markItems(ws, tasks, run);
  if (kind === 'cat') return categoryItems(ws, tasks, run);
  return labelItems(ws, tasks, run);
}

function Btn({
  menu,
  items,
  children,
}: {
  menu: Menu;
  items: () => MenuItem[];
  children: React.ReactNode;
}) {
  return (
    <button
      className="bulk-btn"
      aria-haspopup="menu"
      onClick={(e) => menu.openAt(e.currentTarget, items(), e.detail === 0)}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- Die Menüs */

type Run = (action: BulkAction, what: string) => void;

/** Das Häkchen steht nur, wenn die ganze Auswahl denselben Wert hat. */
const allSame = <T,>(tasks: Task[], read: (t: Task) => T, value: T): boolean =>
  tasks.length > 0 && tasks.every((t) => read(t) === value);

const statusItems = (tasks: Task[], run: Run): MenuItem[] =>
  STATUSES.map((s) => ({
    label: STATUS_LABEL[s],
    check: allSame(tasks, (t) => t.status, s),
    onSelect: () => run({ type: 'patch', changes: { status: s } }, `Status → ${STATUS_LABEL[s]}`),
  }));

const prioItems = (tasks: Task[], run: Run): MenuItem[] =>
  PRIOS.map((v) => ({
    label: v ? `P${v} · ${PRIO_LABEL[v]}` : 'Keine',
    check: allSame(tasks, (t) => t.prio, v),
    onSelect: () =>
      run({ type: 'patch', changes: { prio: v } }, `Priorität → ${v ? PRIO_LABEL[v] : 'keine'}`),
  }));

/** Kategorien gehören einem Projekt – gemischte Auswahl kann das nicht. */
function categoryItems(ws: Workspace, tasks: Task[], run: Run): MenuItem[] {
  const projectIds = [...new Set(tasks.map((t) => t.projectId))];
  if (projectIds.length !== 1) {
    return [{ label: 'Nur für Aufgaben aus einem Projekt', disabled: true }];
  }
  const own = ws.categories
    .filter((c) => c.projectId === projectIds[0])
    .sort((a, b) => a.order - b.order);

  return [
    {
      label: 'Keine',
      check: allSame(tasks, (t) => t.categoryId, null),
      onSelect: () => run({ type: 'patch', changes: { categoryId: null } }, 'Kategorie entfernt'),
    },
    ...own.map((c) => ({
      label: c.name,
      check: allSame(tasks, (t) => t.categoryId, c.id),
      onSelect: () =>
        run({ type: 'patch', changes: { categoryId: c.id } }, `Kategorie → ${c.name}`),
    })),
  ];
}

const markItems = (ws: Workspace, tasks: Task[], run: Run): MenuItem[] => [
  {
    label: 'Keine',
    check: allSame(tasks, (t) => t.markId, null),
    onSelect: () => run({ type: 'patch', changes: { markId: null } }, 'Markierung entfernt'),
  },
  ...ws.marks.map((k) => ({
    label: `${k.emoji} ${k.name}`,
    check: allSame(tasks, (t) => t.markId, k.id),
    onSelect: () =>
      run({ type: 'patch', changes: { markId: k.id } }, `Markierung → ${k.emoji} ${k.name}`),
  })),
];

function labelItems(ws: Workspace, tasks: Task[], run: Run): MenuItem[] {
  const all = [...new Set(ws.tasks.flatMap((t) => t.tags))].sort();
  const present = [...new Set(tasks.flatMap((t) => t.tags))].sort();

  return [
    {
      label: 'Hinzufügen',
      sub: all.length
        ? all.map((g) => ({
            label: `#${g}`,
            check: tasks.every((t) => t.tags.includes(g)),
            onSelect: () => run({ type: 'tag', tag: g, add: true }, `Label #${g} hinzugefügt`),
          }))
        : [{ label: 'Noch keine Labels', disabled: true }],
    },
    {
      label: 'Entfernen',
      sub: present.length
        ? present.map((g) => ({
            label: `#${g}`,
            onSelect: () => run({ type: 'tag', tag: g, add: false }, `Label #${g} entfernt`),
          }))
        : [{ label: 'Keine Labels vorhanden', disabled: true }],
    },
  ];
}

/**
 * Die Ziele wie im Kontextmenü: Dokumentation, „Ready“ mit den smarten
 * Gruppen, Backlog mit Unsortiert und den eigenen Gruppen, dann die Milestones. Ganz unten der
 * Weg in ein anderes Projekt, der immer im Unsortierten landet.
 */
function moveItems(ws: Workspace, tasks: Task[], run: Run): MenuItem[] {
  const projectIds = [...new Set(tasks.map((t) => t.projectId))];

  const toProject: MenuItem[] = ws.projects.map((p) => ({
    label: p.name,
    check: projectIds.length === 1 && projectIds[0] === p.id,
    onSelect: () =>
      run(
        {
          type: 'move',
          target: {
            parentId: null,
            milestoneId: null,
            groupId: null,
            ready: false,
            doc: false,
            projectId: p.id,
          },
        },
        `nach ${p.name} › Unsortiert verschoben`,
      ),
  }));

  if (projectIds.length !== 1) {
    return [
      { head: 'Aufgaben aus mehreren Projekten' },
      { label: 'In Projekt (Backlog)', sub: toProject },
    ];
  }

  const projectId = projectIds[0] as string;
  const to = (target: Record<string, unknown>, label: string): MenuItem => ({
    label,
    onSelect: () =>
      run({ type: 'move', target: { projectId, ...target } }, `verschoben nach ${label}`),
  });
  const loose = { parentId: null, milestoneId: null, groupId: null };

  const items: MenuItem[] = [
    { head: 'Dokumentation' },
    to({ ...loose, doc: true }, '📄 Dokumentation'),
    ...readyTargets(ws, projectId).map(([target, label]) =>
      'head' in target ? { head: label } : to({ ...loose, doc: false, ...target }, label),
    ),
    { head: 'Backlog' },
    to({ ...loose, ready: false, doc: false }, 'Unsortiert'),
    ...groupsOf(ws, projectId).map((g) =>
      to({ ...loose, groupId: g.id, doc: false }, g.title || 'Neue Gruppe'),
    ),
  ];

  const milestones = (list: ReturnType<typeof plannedMilestones>, head: string): void => {
    if (!list.length) return;
    items.push({ head });
    for (const m of list)
      items.push(to({ milestoneId: m.id, doc: false }, `◆ ${m.title || 'Ohne Titel'}`));
  };
  milestones(plannedMilestones(ws, projectId), 'Milestones im Plan');
  milestones(draftMilestones(ws, projectId), 'Vorbereitete Milestones');

  items.push({ sep: true }, { label: 'In anderes Projekt', sub: toProject });
  return items;
}
