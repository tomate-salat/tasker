import { useEffect, useRef } from 'react';
import { isDone, type Task } from '@shared/model.js';
import { statusSegments } from '@shared/progress.js';
import { isBlocked } from '@shared/blocking.js';
import { effectiveTags } from '@shared/inherit.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import type { Dnd } from './dnd.js';
import { CHEVRON_DOWN, CHEVRON_RIGHT, DEFAULT_MARK, PrioIcon, SegBar, statusMark } from './icons.js';

/** Eine Aufgabenzeile – überall gleich aufgebaut. Die Kinder rendert die Liste. */
export function TaskRow({
  ws,
  task,
  depth,
  dnd,
}: {
  ws: Workspace;
  task: Task;
  depth: number;
  dnd?: Dnd;
}) {
  const { selected, select, collapsed, toggle, editing } = useStore();
  const kids = ws.kids(task.id);
  const open = !collapsed[task.id];
  const mark = ws.mark(task.markId);
  const tags = effectiveTags(ws, task);
  const blocked = isBlocked(ws, task);
  const zone = dnd?.drop?.id === task.id ? dnd.drop.zone : null;

  return (
    <div
      data-row={task.id}
      className={[
        'row task-row',
        selected === task.id ? 'sel' : '',
        isDone(task) ? 'done' : '',
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
      <span className="mark-gut" title={mark ? mark.name : 'Aufgabe (keine eigene Markierung)'}>
        <span className={`mk-emoji ${mark ? '' : 'mk-default'}`}>
          {mark ? mark.emoji : DEFAULT_MARK.emoji}
        </span>
      </span>
      <span className="prio-gut">
        <PrioIcon prio={task.prio} />
      </span>

      <button
        className="caret"
        onClick={(e) => {
          e.stopPropagation();
          toggle(task.id);
        }}
        aria-label={open ? 'Zuklappen' : 'Aufklappen'}
      >
        {kids.length ? (open ? CHEVRON_DOWN : CHEVRON_RIGHT) : ''}
      </button>

      <span className={`dot st-${task.status} ${blocked ? 'blocked' : ''}`} aria-hidden="true">
        {statusMark(task.status)}
      </span>

      {editing === task.id ? (
        <TitleEdit task={task} />
      ) : (
        <span className="title" onDoubleClick={() => useStore.getState().edit(task.id)}>
          {task.title || <em>Ohne Titel</em>}
        </span>
      )}

      {kids.length > 0 && <SegBar segments={statusSegments(ws, task)} />}

      <span className="chips">
        {tags.own.map((tag) => (
          <span key={tag} className="tag" style={tagStyle(tag)}>
            {tag}
          </span>
        ))}
        {tags.extra.map((x) => (
          <span
            key={x.tag}
            className="tag inherited"
            style={tagStyle(x.tag)}
            title={`Aus Unteraufgabe „${x.from.title}“`}
          >
            {x.tag}
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Titel direkt in der Zeile bearbeiten. Enter bestätigt, Escape verwirft,
 * Tab rückt ein – wie im Prototyp.
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
      className="title edit-title"
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

/** Überschriftzeile für Milestones, Gruppen und Sammelbereiche. */
export function GroupRow({
  id,
  title,
  count,
  icon,
  right,
  collapsible = true,
  onSelect,
  dnd,
  droppable = false,
}: {
  id: string;
  title: string;
  count?: number;
  icon?: string;
  right?: React.ReactNode;
  collapsible?: boolean;
  onSelect?: () => void;
  dnd?: Dnd;
  droppable?: boolean;
}) {
  const { selected, collapsed, toggle } = useStore();
  const open = !collapsed[id];
  const active = droppable && dnd?.drop?.id === id;

  return (
    <div
      data-row={id}
      className={`row grp-row ${selected === id ? 'sel' : ''} ${active ? 'dz-into' : ''}`}
      onClick={() => onSelect?.()}
      {...(droppable && dnd
        ? {
            onDragOver: (e: React.DragEvent) => dnd.over(e, id, 'container'),
            onDrop: (e: React.DragEvent) => dnd.release(e),
          }
        : {})}
    >
      <button
        className="caret"
        onClick={(e) => {
          e.stopPropagation();
          if (collapsible) toggle(id);
        }}
        aria-label={open ? 'Zuklappen' : 'Aufklappen'}
      >
        {collapsible ? (open ? CHEVRON_DOWN : CHEVRON_RIGHT) : ''}
      </button>
      {icon && (
        <span className="ms-mark" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className="grp-title">{title}</span>
      {right}
      {count !== undefined && <span className="ms-count">{count}</span>}
    </div>
  );
}

export const isOpen = (collapsed: Record<string, boolean>, id: string): boolean => !collapsed[id];

/** Dieselbe Farbableitung wie im Prototyp: gleicher Name, gleicher Farbton. */
export function tagStyle(tag: string): React.CSSProperties {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { '--h': h } as React.CSSProperties;
}
