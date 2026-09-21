import { useEffect, useRef } from 'react';
import { inheritedBlock, ownBlockers } from '@shared/blocking.js';
import { checklist } from '@shared/checklist.js';
import { effectiveCategory, effectiveTags } from '@shared/inherit.js';
import { isDone, type Milestone, type Task } from '@shared/model.js';
import type { OutlineRow } from '@shared/outline.js';
import { doneCount, progressPct, total } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { categoryHue, tagHue } from './colors.js';
import type { Dnd } from './dnd.js';
import { addChild, addSibling, indent, outdent } from './actions.js';
import { cellMenu, type CellKind } from './cellMenu.js';
import { CHECK_ICON, CHEVRON_DOWN, CHEVRON_RIGHT, DEFAULT_MARK, DOC_ICON, DRAW_ICON, LOCK_ICON, PrioIcon, statusMark, STATUS_LABEL } from './icons.js';
import type { Menu } from './Menu.js';

/**
 * Die Zeilen der Liste, Aufbau wie im Prototyp: links die festen Spalten
 * (Markierung, Priorität), dann der eingerückte Baum, danach Kategorie,
 * Labels und rechts der Zähler mit Fortschrittsbalken.
 */
export function TaskRow({
  ws,
  task,
  depth,
  dnd,
  doc = false,
  menu,
}: {
  ws: Workspace;
  task: Task;
  depth: number;
  dnd?: Dnd;
  doc?: boolean;
  /** Das Menü der Liste – die Zellen öffnen darin ihre Auswahl. */
  menu?: Menu;
}) {
  const { selected, select, collapsed, toggle, editing, multi, toggleMulti, rangeMulti, clearMulti } =
    useStore();
  const kids = ws.kids(task.id);
  const open = !collapsed[task.id];
  const mark = ws.mark(task.markId);
  const zone = dnd?.drop?.id === task.id ? dnd.drop.zone : null;
  const tot = total(ws, task);
  const done = doneCount(ws, task);
  const cl = checklist(task.desc);
  const showBar = kids.length > 0 || cl.total > 0;

  // Klick auf eine Zelle öffnet ihr Menü darunter, statt die Zeile auszuwählen.
  const cell =
    (kind: CellKind) =>
    (e: React.MouseEvent<HTMLElement>): void => {
      e.stopPropagation();
      menu?.openAt(e.currentTarget, cellMenu(kind, task.id));
    };

  // Offener Elternteil, unter dem trotzdem gearbeitet wird.
  const implicit =
    !isDone(task) &&
    task.status === 'open' &&
    kids.length > 0 &&
    ws.desc(task).some((d) => d.status === 'progress');

  return (
    <div
      data-row={task.id}
      className={[
        'row task-row',
        doc ? 'doc-row' : 'prio-left',
        multi.has(task.id) ? 'multi' : '',
        selected === task.id && !multi.size ? 'sel' : '',
        isDone(task) ? 'done' : '',
        kids.length ? 'has-kids' : '',
        dnd?.dragId === task.id ? 'dragging' : '',
        zone ? `dz-${zone}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--d': depth } as React.CSSProperties}
      onClick={(e) => {
        // Strg wählt einzeln dazu, Umschalt den Bereich – sonst gilt nur diese Zeile.
        if (e.ctrlKey || e.metaKey) toggleMulti(task.id);
        else if (e.shiftKey) rangeMulti(task.id);
        else {
          clearMulti();
          select(task.id);
        }
      }}
      draggable={!editing}
      onDragStart={() => dnd?.start(task.id)}
      onDragEnd={() => dnd?.end()}
      onDragOver={(e) => dnd?.overTask(e, task.id)}
      onDrop={(e) => dnd?.release(e)}
    >
      {doc ? (
        <>
          <Caret open={open} hasKids={kids.length > 0} onToggle={() => toggle(task.id)} />
          <span className="doc-ico">{DOC_ICON}</span>
          {mark && (
            <span className="mk-emoji" title={mark.name}>
              {mark.emoji}
            </span>
          )}
        </>
      ) : (
        <>
          <span
            className="mark-gut cell"
            role="button"
            tabIndex={-1}
            title={`${mark ? mark.name : 'Aufgabe (keine eigene Markierung)'} – klicken zum Ändern`}
            onClick={cell('mark')}
          >
            <span className={`mk-emoji ${mark ? '' : 'mk-default'}`}>
              {mark ? mark.emoji : DEFAULT_MARK.emoji}
            </span>
          </span>
          <span className="prio-gut cell" role="button" tabIndex={-1} onClick={cell('prio')}>
            <PrioIcon prio={task.prio} cell />
          </span>
          <Caret open={open} hasKids={kids.length > 0} onToggle={() => toggle(task.id)} />
          <StatusDot task={task} implicit={implicit} />
        </>
      )}

      {editing === task.id ? (
        <TitleEdit kind="task" id={task.id} title={task.title} />
      ) : (
        <span className="title" onDoubleClick={() => useStore.getState().edit(task.id)}>
          {task.title || <em>{doc ? 'Neue Seite' : 'Ohne Titel'}</em>}
        </span>
      )}

      <ChecklistBadge desc={task.desc} />
      <DrawingBadge taskId={task.id} />
      {!doc && <LockBadge ws={ws} task={task} />}

      <CategoryCell ws={ws} task={task} onClick={cell('cat')} />
      <TagCell ws={ws} task={task} onClick={cell('tags')} />

      <span className="meta">
        {doc ? (
          <span className="pts" title={`${kids.length} Unterseiten`}>
            {kids.length || ''}
          </span>
        ) : (
          <>
            <span className="pts sum" title={`${done} von ${tot} Aufgaben erledigt`}>
              {kids.length ? `${done}/${tot}` : ''}
            </span>
            <span
              className={`bar ${showBar ? '' : 'empty'}`}
              {...(showBar
                ? {
                    title: `${progressPct(ws, task)} % erledigt${cl.total ? ' (inkl. Checkliste)' : ''}`,
                  }
                : {})}
            >
              {showBar && <i style={{ width: `${progressPct(ws, task)}%` }} />}
            </span>
          </>
        )}
      </span>
    </div>
  );
}

/** Milestone-Kopfzeile: Titel, Status, Zeitraum und Fortschritt. */
export function MilestoneRow({
  ws,
  milestone,
  dnd,
  right,
  stats,
  pct,
}: {
  ws: Workspace;
  milestone: Milestone;
  dnd?: Dnd;
  right?: React.ReactNode;
  stats: { done: number; total: number };
  pct: number;
}) {
  const { selected, select, collapsed, toggle, editing } = useStore();
  const open = !collapsed[milestone.id];
  const waiting = milestone.deps
    .map((id) => ws.milestone(id))
    .filter((m): m is Milestone => !!m && m.status !== 'done');
  const active = dnd?.drop?.id === milestone.id;

  return (
    <div
      data-row={milestone.id}
      className={`row ms-row ${selected === milestone.id ? 'sel' : ''} ${active ? 'dz-into' : ''}`}
      onClick={() => select(milestone.id)}
      onDragOver={(e) =>
        dnd?.overContainer(e, {
          id: milestone.id,
          projectId: milestone.projectId,
          place: { milestoneId: milestone.id },
        })
      }
      onDrop={(e) => dnd?.release(e)}
    >
      <Caret open={open} hasKids onToggle={() => toggle(milestone.id)} />
      <span className="ico ms" title="Milestone">
        ◆
      </span>
      {editing === milestone.id ? (
        <TitleEdit kind="milestone" id={milestone.id} title={milestone.title} />
      ) : (
        <span className="title" onDoubleClick={() => useStore.getState().edit(milestone.id)}>
          {milestone.title || <em>Neuer Milestone</em>}
        </span>
      )}
      <ChecklistBadge desc={milestone.desc} />
      <span className="ms-spacer" />

      {waiting.length > 0 && (
        <span className="lock" title={`Wartet auf: ${waiting.map((m) => m.title).join(', ')}`}>
          {LOCK_ICON}
        </span>
      )}

      {right}

      <span className="meta">
        <span className="pts sum" title={`${stats.done} von ${stats.total} Aufgaben erledigt`}>
          {stats.done}/{stats.total}
        </span>
        <span className="bar">
          <i style={{ width: `${pct}%` }} />
        </span>
      </span>
    </div>
  );
}

/**
 * Überschriftzeile für Gruppen, den Sammelbereich „Unsortiert“ und die smarten
 * Gruppen. Eine smarte Gruppe ist keine Ablage, sondern die Markierung selbst:
 * was hier landet, bekommt sie automatisch.
 */
export function GroupRow({
  row,
  count,
  onAdd,
  dnd,
}: {
  row: Extract<OutlineRow, { type: 'group' }>;
  /** Offene Aufgaben in dieser Gruppe. */
  count: number;
  onAdd: () => void;
  dnd?: Dnd;
}) {
  const { collapsed, toggle, editing, edit, remove, setDialog } = useStore();
  const { id, group, mark } = row;
  const open = !collapsed[id];
  const active = dnd?.drop?.id === id;

  return (
    <div
      data-row={id}
      className={[
        'row grp-row',
        !group && !mark ? 'unsorted' : '',
        mark ? 'smart' : '',
        active ? 'dz-into' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      {...(mark ? { title: `Smarte Gruppe: Tasks hier bekommen automatisch ${mark.emoji} ${mark.name}` } : {})}
      onDragOver={(e) =>
        dnd?.overContainer(e, { id, projectId: row.projectId, place: row.place })
      }
      onDrop={(e) => dnd?.release(e)}
    >
      <Caret open={open} hasKids onToggle={() => toggle(id)} />
      {mark && <span className="mk-emoji">{mark.emoji}</span>}

      {group && editing === group.id ? (
        <TitleEdit kind="group" id={group.id} title={group.title} />
      ) : (
        <span className="title">{row.title}</span>
      )}

      {mark && <span className="smart-badge">smart</span>}
      <span className="ms-spacer" />

      <span className="row-actions">
        <button
          title={mark ? `Task mit ${mark.name} anlegen` : 'Task in dieser Gruppe anlegen'}
          aria-label="Task anlegen"
          onClick={onAdd}
        >
          +
        </button>
        {mark && (
          <button
            title="Markierungen verwalten"
            aria-label="Markierungen verwalten"
            onClick={() => setDialog('marks')}
          >
            ✎
          </button>
        )}
        {group && (
          <>
            <button title="Umbenennen" aria-label="Umbenennen" onClick={() => edit(group.id)}>
              ✎
            </button>
            <button
              title="Gruppe löschen"
              aria-label="Gruppe löschen"
              onClick={() => void remove('group', group.id)}
            >
              ✕
            </button>
          </>
        )}
      </span>

      <span className="grp-count">{count} offen</span>
    </div>
  );
}

/** Abschnittsüberschrift im Backlog, rechts daneben die passende Handlung. */
export function SectionRow({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="sec">
      {title}
      {action}
    </div>
  );
}

/** Leerer Behälter: gestrichelter Kasten, in den man ziehen kann. */
export function EmptyDrop({
  row,
  onAdd,
  dnd,
}: {
  row: Extract<OutlineRow, { type: 'empty' }>;
  onAdd: () => void;
  dnd?: Dnd;
}) {
  const active = dnd?.drop?.id === row.id;
  return (
    <div
      className={`drop-empty ${active ? 'dz-on' : ''}`}
      onDragOver={(e) => dnd?.overContainer(e, { id: row.id, projectId: row.projectId, place: row.place })}
      onDrop={(e) => dnd?.release(e)}
    >
      Leer – Tasks hierher ziehen oder{' '}
      <button className="linkish" onClick={onAdd}>
        Task anlegen
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------- Teile */

function Caret({
  open,
  hasKids,
  onToggle,
}: {
  open: boolean;
  hasKids: boolean;
  onToggle: () => void;
}) {
  if (!hasKids) return <span className="caret" />;
  return (
    <button
      className="caret"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={open ? 'Zuklappen' : 'Aufklappen'}
    >
      {open ? CHEVRON_DOWN : CHEVRON_RIGHT}
    </button>
  );
}

export function StatusDot({ task, implicit }: { task: Task; implicit: boolean }) {
  const label = implicit ? 'Offen · eine Unteraufgabe ist in Arbeit' : STATUS_LABEL[task.status];
  return (
    <span
      className={`check status-dot st-${task.status} ${implicit ? 'implicit-progress' : ''}`}
      role="img"
      title={`${label} · S: nächster Status · Leertaste: erledigt`}
      aria-label={`Status ${STATUS_LABEL[task.status]}${implicit ? ', Unteraufgabe in Arbeit' : ''}`}
    >
      {statusMark(task.status)}
    </span>
  );
}

/** Checklisten in der Beschreibung zählen mit – als kleines Kästchen mit Zahl. */
export function ChecklistBadge({ desc }: { desc: string }) {
  const c = checklist(desc);
  if (!c.total) return null;
  return (
    <span
      className={`cl-count ${c.done === c.total ? 'full' : ''}`}
      title={`Checkliste in der Beschreibung: ${c.done} von ${c.total} erledigt`}
    >
      {CHECK_ICON}
      {c.done}/{c.total}
    </span>
  );
}

/** Zeigt an, dass an der Aufgabe eine Zeichnung hängt. */
function DrawingBadge({ taskId }: { taskId: string }) {
  const { boot, select } = useStore();
  const drawings = (boot?.drawings ?? []).filter((d) => d.taskId === taskId);
  if (!drawings.length) return null;
  const names = drawings.map((d) => d.name).join(', ');
  return (
    <button
      className="draw-badge"
      title={drawings.length === 1 ? `Zeichnung „${names}“` : `${drawings.length} Zeichnungen: ${names}`}
      aria-label="Zeichnungen"
      onClick={(e) => {
        e.stopPropagation();
        select(taskId);
      }}
    >
      {DRAW_ICON}
      {drawings.length > 1 ? drawings.length : ''}
    </button>
  );
}

/** Schloss, wenn die Aufgabe blockiert ist – eigene und geerbte Gründe im Titel. */
function LockBadge({ ws, task }: { ws: Workspace; task: Task }) {
  const own = ownBlockers(ws, task);
  const inherited = inheritedBlock(ws, task);
  const reasons = [
    own.length ? `Blockiert durch: ${own.map((b) => b.title).join(', ')}` : '',
    ...inherited.deps.map((x) => `Geerbt von „${x.via.title}“: ${x.blocker.title}`),
    inherited.statusVia ? `„${inherited.statusVia.title}“ ist als Blockiert markiert` : '',
  ].filter(Boolean);

  if (!reasons.length) return null;
  return (
    <span className={`lock ${own.length ? '' : 'inherited'}`} title={reasons.join('\n')}>
      {LOCK_ICON}
    </span>
  );
}

type CellClick = (e: React.MouseEvent<HTMLElement>) => void;

/** Eigene Spalte: die Kategorie, geerbte blass. Ein Klick öffnet die Auswahl. */
function CategoryCell({ ws, task, onClick }: { ws: Workspace; task: Task; onClick: CellClick }) {
  const effective = effectiveCategory(ws, task);
  if (!effective) {
    return (
      <span className="cat-col cell" role="button" tabIndex={-1} title="Kategorie ändern" onClick={onClick}>
        <span className="prio-none" title="Keine Kategorie">
          –
        </span>
      </span>
    );
  }

  const index = ws.categories
    .filter((c) => c.projectId === effective.category.projectId)
    .sort((a, b) => a.order - b.order)
    .findIndex((c) => c.id === effective.category.id);

  return (
    <span
      className="cat-col cell"
      role="button"
      tabIndex={-1}
      title={
        effective.from
          ? `Geerbt von „${effective.from.title}“ – klicken zum Ändern`
          : 'Kategorie ändern'
      }
      onClick={onClick}
    >
      <span className="cat-sw" style={{ '--h': categoryHue(index) } as React.CSSProperties} />
      <span className={effective.from ? 'inherited-val' : ''}>{effective.category.name}</span>
    </span>
  );
}

/** Eigene Spalte: Labels, die aus Unteraufgaben stammen, stehen blass dahinter. */
function TagCell({ ws, task, onClick }: { ws: Workspace; task: Task; onClick: CellClick }) {
  const tags = effectiveTags(ws, task);
  return (
    <span
      className="tags cell"
      role="button"
      tabIndex={-1}
      title={
        tags.extra.length
          ? 'Blasse Labels kommen aus Unteraufgaben – klicken zum Ändern'
          : 'Labels ändern'
      }
      onClick={onClick}
    >
      {!tags.own.length && !tags.extra.length && <span className="cell-empty">+ Label</span>}
      {tags.own.map((tag) => (
        <span key={tag} className="tag" style={tagStyle(tag)}>
          {tag}
        </span>
      ))}
      {tags.extra.map((x) => (
        <span
          key={x.tag}
          className="tag inherited-val"
          style={tagStyle(x.tag)}
          title={`Aus Unteraufgabe „${x.from.title}“`}
        >
          {x.tag}
        </span>
      ))}
    </span>
  );
}

/**
 * Titel direkt in der Zeile bearbeiten – Tasten wie im Prototyp (`edit-title`):
 * `Enter` bestätigt und legt bei Aufgaben gleich die nächste an, `⇧ Enter` eine
 * Unteraufgabe, `Tab`/`⇧ Tab` rückt beim Tippen ein und aus, `Escape` verwirft.
 * Eine eben angelegte Zeile, die leer bleibt oder abgebrochen wird, verschwindet.
 */
function TitleEdit({
  kind,
  id,
  title,
}: {
  kind: 'task' | 'group' | 'milestone';
  id: string;
  title: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Nach Enter, Escape oder Tab kommt noch ein Blur hinterher – der darf nichts mehr tun.
  const closed = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  /** Beendet die Bearbeitung; gibt den Titel zurück, der danach gilt (leer = keiner). */
  const finish = async (value: string, cancel = false): Promise<string> => {
    if (closed.current) return '';
    closed.current = true;
    const store = useStore.getState();
    const next = value.trim();
    const isNew = store.editingNew;
    store.edit(null);
    if (isNew && (cancel || !next)) {
      await store.discard(kind, id);
      return '';
    }
    // Ein geleertes Feld lässt den alten Titel stehen, wie im Prototyp.
    if (!cancel && next && next !== title) await store.patch(kind, id, { title: next });
    return cancel || !next ? title : next;
  };

  const next = async (child: boolean, value: string): Promise<void> => {
    const kept = await finish(value);
    const ws = useStore.getState().ws;
    const t = ws?.task(id);
    if (kind !== 'task' || !kept || !ws || !t) return;
    await (child ? addChild(t) : addSibling(ws, t));
  };

  const shift = async (out: boolean, value: string): Promise<void> => {
    closed.current = true;
    const store = useStore.getState();
    const text = value.trim();
    if (text && text !== title) await store.patch('task', id, { title: text });
    const ws = useStore.getState().ws;
    const t = ws?.task(id);
    if (ws && t) await (out ? outdent(ws, t) : indent(ws, t));
    // Weiter tippen an der neuen Stelle; die Zeile gilt jetzt nicht mehr als neu.
    useStore.getState().edit(id);
    closed.current = false;
    ref.current?.focus();
  };

  return (
    <input
      ref={ref}
      className="title-edit"
      defaultValue={title}
      aria-label="Name"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => void finish(e.target.value)}
      onKeyDown={(e) => {
        const value = e.currentTarget.value;
        if (e.key === 'Enter') {
          e.preventDefault();
          void next(e.shiftKey, value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          void finish(value, true);
        } else if (e.key === 'Tab' && kind === 'task') {
          e.preventDefault();
          void shift(e.shiftKey, value);
        }
      }}
    />
  );
}

/** Dieselbe Farbableitung wie im Prototyp: gleicher Name, gleicher Farbton. */
export function tagStyle(tag: string): React.CSSProperties {
  return { '--h': tagHue(tag) } as React.CSSProperties;
}
