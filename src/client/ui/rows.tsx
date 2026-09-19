import { useEffect, useRef } from 'react';
import { inheritedBlock, ownBlockers } from '@shared/blocking.js';
import { checklist } from '@shared/checklist.js';
import { effectiveCategory, effectiveTags } from '@shared/inherit.js';
import { isDone, type Milestone, type Task } from '@shared/model.js';
import { doneCount, progressPct, total } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { categoryHue, tagHue } from './colors.js';
import type { Dnd } from './dnd.js';
import { CHECK_ICON, CHEVRON_DOWN, CHEVRON_RIGHT, DEFAULT_MARK, DOC_ICON, DRAW_ICON, LOCK_ICON, PrioIcon, statusMark } from './icons.js';

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
}: {
  ws: Workspace;
  task: Task;
  depth: number;
  dnd?: Dnd;
  doc?: boolean;
}) {
  const { selected, select, collapsed, toggle, editing } = useStore();
  const kids = ws.kids(task.id);
  const open = !collapsed[task.id];
  const mark = ws.mark(task.markId);
  const zone = dnd?.drop?.id === task.id ? dnd.drop.zone : null;
  const tot = total(ws, task);
  const done = doneCount(ws, task);
  const cl = checklist(task.desc);
  const showBar = kids.length > 0 || cl.total > 0;

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
        selected === task.id ? 'sel' : '',
        isDone(task) ? 'done' : '',
        kids.length ? 'has-kids' : '',
        dnd?.dragId === task.id ? 'dragging' : '',
        zone ? `dz-${zone}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ '--d': depth } as React.CSSProperties}
      onClick={() => select(task.id)}
      draggable={!editing}
      onDragStart={() => dnd?.start(task.id)}
      onDragEnd={() => dnd?.end()}
      onDragOver={(e) => dnd?.over(e, task.id, 'task')}
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
            className="mark-gut"
            title={mark ? mark.name : 'Aufgabe (keine eigene Markierung)'}
          >
            <span className={`mk-emoji ${mark ? '' : 'mk-default'}`}>
              {mark ? mark.emoji : DEFAULT_MARK.emoji}
            </span>
          </span>
          <span className="prio-gut">
            <PrioIcon prio={task.prio} />
          </span>
          <Caret open={open} hasKids={kids.length > 0} onToggle={() => toggle(task.id)} />
          <StatusDot task={task} implicit={implicit} />
        </>
      )}

      {editing === task.id ? (
        <TitleEdit task={task} />
      ) : (
        <span className="title" onDoubleClick={() => useStore.getState().edit(task.id)}>
          {task.title || <em>{doc ? 'Neue Seite' : 'Ohne Titel'}</em>}
        </span>
      )}

      <ChecklistBadge desc={task.desc} />
      <DrawingBadge taskId={task.id} />
      {!doc && <LockBadge ws={ws} task={task} />}

      <CategoryCell ws={ws} task={task} />
      <TagCell ws={ws} task={task} />

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
  const { selected, select, collapsed, toggle } = useStore();
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
      onDragOver={(e) => dnd?.over(e, milestone.id, 'container')}
      onDrop={(e) => dnd?.release(e)}
    >
      <Caret open={open} hasKids onToggle={() => toggle(milestone.id)} />
      <span className="ico ms" title="Milestone">
        ◆
      </span>
      <span className="title">{milestone.title || <em>Neuer Milestone</em>}</span>
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

/** Überschriftzeile für Gruppen und Sammelbereiche. */
export function GroupRow({
  id,
  title,
  count,
  unsorted = false,
  onAdd,
  dnd,
  droppable = false,
}: {
  id: string;
  title: string;
  /** Offene Aufgaben in dieser Gruppe. */
  count: number;
  unsorted?: boolean;
  onAdd?: () => void;
  dnd?: Dnd;
  droppable?: boolean;
}) {
  const { collapsed, toggle } = useStore();
  const open = !collapsed[id];
  const active = droppable && dnd?.drop?.id === id;

  return (
    <div
      data-row={id}
      className={`row grp-row ${unsorted ? 'unsorted' : ''} ${active ? 'dz-into' : ''}`}
      {...(droppable && dnd
        ? {
            onDragOver: (e: React.DragEvent) => dnd.over(e, id, 'container'),
            onDrop: (e: React.DragEvent) => dnd.release(e),
          }
        : {})}
    >
      <Caret open={open} hasKids onToggle={() => toggle(id)} />
      <span className="title">{title}</span>
      <span className="ms-spacer" />
      {onAdd && (
        <span className="row-actions">
          <button title="Aufgabe in dieser Gruppe anlegen" aria-label="Aufgabe anlegen" onClick={onAdd}>
            +
          </button>
        </span>
      )}
      <span className="grp-count">{count} offen</span>
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

function StatusDot({ task, implicit }: { task: Task; implicit: boolean }) {
  const label = implicit ? 'Offen · eine Unteraufgabe ist in Arbeit' : task.status;
  return (
    <span
      className={`check status-dot st-${task.status} ${implicit ? 'implicit-progress' : ''}`}
      role="img"
      title={`${label} · S: nächster Status · Leertaste: erledigt`}
      aria-label={`Status ${task.status}`}
    >
      {statusMark(task.status)}
    </span>
  );
}

/** Checklisten in der Beschreibung zählen mit – als kleines Kästchen mit Zahl. */
function ChecklistBadge({ desc }: { desc: string }) {
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

/** Eigene Spalte: die Kategorie, geerbte blass. */
function CategoryCell({ ws, task }: { ws: Workspace; task: Task }) {
  const effective = effectiveCategory(ws, task);
  if (!effective) {
    return (
      <span className="cat-col">
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
      className="cat-col"
      title={effective.from ? `Geerbt von „${effective.from.title}“` : 'Kategorie'}
    >
      <span className="cat-sw" style={{ '--h': categoryHue(index) } as React.CSSProperties} />
      <span className={effective.from ? 'inherited-val' : ''}>{effective.category.name}</span>
    </span>
  );
}

/** Eigene Spalte: Labels, die aus Unteraufgaben stammen, stehen blass dahinter. */
function TagCell({ ws, task }: { ws: Workspace; task: Task }) {
  const tags = effectiveTags(ws, task);
  return (
    <span
      className="tags"
      title={tags.extra.length ? 'Blasse Labels kommen aus Unteraufgaben' : 'Labels'}
    >
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
 * Titel direkt in der Zeile bearbeiten. Enter bestätigt, Escape verwirft.
 */
function TitleEdit({ task }: { task: Task }) {
  const { patch, edit } = useStore();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = (value: string): void => {
    const next = value.trim();
    edit(null);
    if (next !== task.title) void patch('task', task.id, { title: next });
  };

  return (
    <input
      ref={ref}
      className="title-edit"
      defaultValue={task.title}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          edit(null);
        }
      }}
    />
  );
}

/** Dieselbe Farbableitung wie im Prototyp: gleicher Name, gleicher Farbton. */
export function tagStyle(tag: string): React.CSSProperties {
  return { '--h': tagHue(tag) } as React.CSSProperties;
}
