import { isDone, type Task } from '@shared/model.js';
import { statusSegments } from '@shared/progress.js';
import { isBlocked } from '@shared/blocking.js';
import { effectiveTags } from '@shared/inherit.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { CHEVRON_DOWN, CHEVRON_RIGHT, DEFAULT_MARK, PrioIcon, SegBar, statusMark } from './icons.js';

/** Eine Aufgabenzeile mit ihren Unteraufgaben – überall gleich aufgebaut. */
export function TaskRow({ ws, task, depth }: { ws: Workspace; task: Task; depth: number }) {
  const { selected, select, collapsed, toggle } = useStore();
  const kids = ws.kids(task.id);
  const open = !collapsed[task.id];
  const mark = ws.mark(task.markId);
  const tags = effectiveTags(ws, task);
  const blocked = isBlocked(ws, task);

  return (
    <>
      <div
        className={`row task-row ${selected === task.id ? 'sel' : ''} ${isDone(task) ? 'done' : ''}`}
        style={{ '--d': depth } as React.CSSProperties}
        onClick={() => select(task.id)}
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
        <span className="title">{task.title || <em>Ohne Titel</em>}</span>

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
      {open && kids.map((k) => <TaskRow key={k.id} ws={ws} task={k} depth={depth + 1} />)}
    </>
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
}: {
  id: string;
  title: string;
  count?: number;
  icon?: string;
  right?: React.ReactNode;
  collapsible?: boolean;
  onSelect?: () => void;
}) {
  const { selected, collapsed, toggle } = useStore();
  const open = !collapsed[id];

  return (
    <div
      className={`row grp-row ${selected === id ? 'sel' : ''}`}
      onClick={() => onSelect?.()}
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
