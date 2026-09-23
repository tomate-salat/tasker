import { checklist } from '@shared/checklist.js';
import { isDone, type Task } from '@shared/model.js';
import type { OutlineRow, OutlineView } from '@shared/outline.js';
import { doneCount, statusSegments, total } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore, type View } from '../store.js';
import { addChild } from './actions.js';
import { bulkMenu } from './BulkBar.js';
import { cellMenu, type CellKind } from './cellMenu.js';
import { dragSource, dropTarget, useDragging, useZone } from './dnd.js';
import { PrioIcon, SegBar } from './icons.js';
import type { Menu } from './Menu.js';
import { rowMenu } from './rowMenu.js';
import { ChecklistBadge, DrawingBadge, LockBadge, StatusDot, TaskRow, TitleEdit } from './rows.js';
import './cards.css';

/**
 * Die Kartenansicht – ein Versuch, angelehnt an Codecks, auf Wunsch des
 * Nutzers neben der Liste. Plan, Ready und Backlog zeigen dann nur die
 * Aufgaben ohne Elternteil, als Karten nebeneinander. Den Baum darunter zeigt
 * der Inspektor (`Hierarchy`), und zwar immer von der Wurzel an – auch wenn
 * gerade eine Unteraufgabe ausgewählt ist.
 *
 * Alles hängt an `layout === 'cards'`; fliegt die Ansicht wieder raus, gehen
 * diese Datei, `cards.css` und die paar Aufrufe mit „Karten“ im Kommentar.
 */

/** Ob die Karten gerade gelten – nur in Plan, Ready und Backlog. */
export const cardsOn = (s: { layout: string; view: View }): boolean =>
  s.layout === 'cards' && (s.view === 'plan' || s.view === 'ready' || s.view === 'backlog');

/** Die oberste Aufgabe über `id` – deren Baum zeigt der Inspektor. */
export function hierarchyRoot(ws: Workspace, id: string | null): Task | null {
  const task = ws.task(id);
  if (!task || ws.isDoc(task)) return null;
  const root = ws.root(task);
  return ws.kids(root.id).length ? root : null;
}

/** Der Baum ab `root`, aufgeklappt wie in der Liste. */
export function treeRows(ws: Workspace, root: Task, collapsed: Record<string, boolean>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (t: Task, depth: number): void => {
    rows.push({ type: 'task', id: t.id, task: t, depth });
    if (collapsed[t.id]) return;
    for (const k of ws.kids(t.id)) walk(k, depth + 1);
  };
  // Tiefe 1 wie die Aufgaben in einem Behälter der Liste.
  walk(root, 1);
  return rows;
}

/**
 * Aus der Zeilenfolge der Liste die der Karten: Unteraufgaben fallen weg.
 * Für die Tastatur (`keys`) steht hinter der Karte, deren Baum gerade im
 * Inspektor offen ist, dieser Baum – so wandern die Pfeiltasten hinein.
 */
export function cardRows(
  ws: Workspace,
  rows: OutlineRow[],
  selected: string | null,
  collapsed: Record<string, boolean>,
): { shown: OutlineRow[]; keys: OutlineRow[] } {
  const shown = rows.filter((r) => r.type !== 'task' || !r.task.parentId);
  const root = hierarchyRoot(ws, selected);
  const keys = shown.flatMap((r) => (root && r.id === root.id ? treeRows(ws, root, collapsed) : [r]));
  return { shown, keys };
}

/** Aufeinanderfolgende Aufgaben werden zu einem Kartenraster zusammengefasst. */
export function chunkCards(rows: OutlineRow[]): (OutlineRow | Task[])[] {
  const out: (OutlineRow | Task[])[] = [];
  for (const r of rows) {
    if (r.type !== 'task') {
      out.push(r);
      continue;
    }
    const last = out[out.length - 1];
    if (Array.isArray(last)) last.push(r.task);
    else out.push([r.task]);
  }
  return out;
}

export function CardGrid({
  ws,
  tasks,
  view,
  menu,
}: {
  ws: Workspace;
  tasks: Task[];
  view: OutlineView;
  menu: Menu;
}) {
  return (
    <div className="card-grid" data-view={view}>
      {tasks.map((t) => (
        <TaskCard key={t.id} ws={ws} task={t} menu={menu} />
      ))}
    </div>
  );
}

/** Erstes Bild der Beschreibung – als Titelbild, in der kleinen Fassung. */
const IMAGE_RE = /!\[[^\]]*\]\((\/api\/bilder\/[^)\s?]+)[^)]*\)/;
const coverOf = (desc: string): string | null => {
  const m = IMAGE_RE.exec(desc);
  return m ? `${m[1]}?v=klein` : null;
};

function TaskCard({ ws, task, menu }: { ws: Workspace; task: Task; menu: Menu }) {
  const { selected, select, editing, multi, toggleMulti, rangeMulti, clearMulti } = useStore();
  const target = { type: 'task', task } as const;
  const zone = useZone(target);
  const dragging = useDragging(task.id);
  const kids = ws.kids(task.id);
  const mark = ws.mark(task.markId);
  const cover = coverOf(task.desc);
  const segments = statusSegments(ws, task);
  const cl = checklist(task.desc);
  // Ist eine Unteraufgabe dieser Karte ausgewählt, bleibt die Karte markiert.
  const holds = selected !== task.id && hierarchyRoot(ws, selected)?.id === task.id;
  const implicit =
    !isDone(task) &&
    task.status === 'open' &&
    kids.length > 0 &&
    ws.desc(task).some((d) => d.status === 'progress');

  const cell =
    (kind: CellKind) =>
    (e: React.MouseEvent<HTMLElement>): void => {
      e.stopPropagation();
      menu.openAt(e.currentTarget, cellMenu(kind, task.id));
    };

  return (
    <div
      data-row={task.id}
      data-axis="x"
      className={[
        'tcard',
        cover ? 'has-cover' : '',
        multi.has(task.id) ? 'multi' : '',
        selected === task.id && !multi.size ? 'sel' : '',
        holds ? 'holds' : '',
        isDone(task) ? 'done' : '',
        dragging ? 'dragging' : '',
        zone ? `dz-${zone}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) toggleMulti(task.id);
        else if (e.shiftKey) rangeMulti(task.id);
        else {
          clearMulti();
          select(task.id);
        }
      }}
      {...dragSource('task', task.id, !editing)}
      {...dropTarget(target)}
    >
      {cover && <div className="tcard-cover" style={{ backgroundImage: `url(${cover})` }} />}

      <div className="tcard-head">
        {mark && (
          <span
            className="mk-emoji cell"
            role="button"
            tabIndex={-1}
            title={`${mark.name} – klicken zum Ändern`}
            onClick={cell('mark')}
          >
            {mark.emoji}
          </span>
        )}
        {/* Mit Unteraufgaben wird der Titel im Baum des Inspektors bearbeitet. */}
        {editing === task.id && !kids.length ? (
          <TitleEdit kind="task" id={task.id} title={task.title} />
        ) : (
          <span className="tcard-title" onDoubleClick={() => useStore.getState().edit(task.id)}>
            {task.title || <em>Ohne Titel</em>}
          </span>
        )}
      </div>

      <div className="tcard-foot">
        <div className="tcard-meta">
          <StatusDot task={task} implicit={implicit} />
          {task.prio ? (
            <span className="cell" role="button" tabIndex={-1} onClick={cell('prio')}>
              <PrioIcon prio={task.prio} cell />
            </span>
          ) : null}
          {!mark && (
            <span
              className="mk-add cell"
              role="button"
              tabIndex={-1}
              title="Markierung setzen"
              onClick={cell('mark')}
            >
              ＋
            </span>
          )}
          <LockBadge ws={ws} task={task} />
          <ChecklistBadge desc={task.desc} />
          <DrawingBadge ownerId={task.id} />
          {kids.length > 0 && (
            <span className="tcard-count" title={`${doneCount(ws, task)} von ${total(ws, task)} Aufgaben erledigt`}>
              {doneCount(ws, task)}/{total(ws, task)}
            </span>
          )}
        </div>
        {(kids.length > 0 || cl.total > 0) && <SegBar segments={segments} />}
      </div>
    </div>
  );
}

/**
 * Der Baum einer Karte im Inspektor: dieselben Zeilen wie in der Liste, mit
 * Auswahl, Ziehen, Kontextmenü und Titelbearbeitung. Er steht am Ende des
 * Inspektors (Wunsch des Nutzers).
 */
export function Hierarchy({ ws, id, menu }: { ws: Workspace; id: string | null; menu: Menu }) {
  const state = useStore();
  const root = cardsOn(state) ? hierarchyRoot(ws, id) : null;
  if (!root) return null;
  const rows = treeRows(ws, root, state.collapsed);
  const current = ws.task(state.selected);

  return (
    <section className="d-section hier-sec">
      <div className="h3row">
        <h3>
          Hierarchie · {doneCount(ws, root)}/{total(ws, root)}
        </h3>
        {current && !state.multi.size && (
          <button className="linkish" onClick={() => void addChild(current)}>
            + Unteraufgabe
          </button>
        )}
      </div>
      <div
        className={`list hier ${state.multi.size ? 'has-multi' : ''}`}
        onContextMenu={(e) => {
          const el = e.target as HTMLElement;
          const rid = el.closest('[data-row]')?.getAttribute('data-row');
          if (!rid || el.closest('input, textarea')) return;
          e.preventDefault();
          if (state.multi.has(rid)) {
            menu.openAtPoint(e.clientX, e.clientY, bulkMenu(ws));
            return;
          }
          const row = rows.find((r) => r.id === rid);
          if (!row) return;
          state.clearMulti();
          state.select(rid);
          menu.openAtPoint(e.clientX, e.clientY, rowMenu(ws, row));
        }}
      >
        {rows.map(
          (r) =>
            r.type === 'task' && <TaskRow key={r.id} ws={ws} task={r.task} depth={r.depth} menu={menu} />,
        )}
      </div>
    </section>
  );
}

/** Umschalter Liste/Karten in der Reiterleiste. */
export function LayoutSwitch() {
  const state = useStore();
  const { view, layout, setLayout } = state;
  if (view !== 'plan' && view !== 'ready' && view !== 'backlog') return null;
  return (
    <span className="layout-switch" role="group" aria-label="Darstellung">
      <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="Als Liste">
        Liste
      </button>
      <button className={layout === 'cards' ? 'on' : ''} onClick={() => setLayout('cards')} title="Als Karten">
        Karten
      </button>
    </span>
  );
}
