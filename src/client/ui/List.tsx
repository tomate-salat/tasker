import { isDone, type Milestone, type Task } from '@shared/model.js';
import { milestoneStats, statusSegments } from '@shared/progress.js';
import { isBlocked } from '@shared/blocking.js';
import { effectiveTags } from '@shared/inherit.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import {
  CHEVRON_DOWN,
  CHEVRON_RIGHT,
  DEFAULT_MARK,
  PrioIcon,
  SegBar,
  statusMark,
} from './icons.js';

/**
 * Die Tabellenansicht aus dem Prototyp: links feste Spalten für Markierung und
 * Priorität, danach der eingerückte Baum. Milestones sind eigene Zeilen und
 * fangen ganz links an, damit die Gliederung sichtbar bleibt.
 */
export function List({ ws, projectId }: { ws: Workspace; projectId: string }) {
  const milestones = ws.milestones
    .filter((m) => m.projectId === projectId)
    .sort((a, b) => a.qorder - b.qorder || a.order - b.order);

  // Alles ohne Milestone und ohne Elternteil ist Backlog.
  const loose = ws.tasks
    .filter((t) => t.projectId === projectId && !t.parentId && !t.milestoneId && !t.doc)
    .sort((a, b) => a.order - b.order);

  if (!milestones.length && !loose.length) {
    return <div className="empty">Noch nichts in diesem Projekt.</div>;
  }

  return (
    <div className="list">
      {milestones.map((m) => (
        <MilestoneBlock key={m.id} ws={ws} milestone={m} />
      ))}
      {loose.length > 0 && (
        <>
          <div className="row grp-row">
            <span className="grp-title">Backlog</span>
            <span className="grp-count">{loose.length}</span>
          </div>
          {loose.map((t) => (
            <TaskRow key={t.id} ws={ws} task={t} depth={0} />
          ))}
        </>
      )}
    </div>
  );
}

function MilestoneBlock({ ws, milestone }: { ws: Workspace; milestone: Milestone }) {
  const { selected, select, collapsed, toggle } = useStore();
  const roots = ws.msRoots(milestone);
  const stats = milestoneStats(ws, milestone);
  const open = !collapsed[milestone.id];

  return (
    <>
      <div
        className={`row ms-row ${selected === milestone.id ? 'sel' : ''}`}
        onClick={() => select(milestone.id)}
      >
        <button
          className="caret"
          onClick={(e) => {
            e.stopPropagation();
            toggle(milestone.id);
          }}
          aria-label={open ? 'Zuklappen' : 'Aufklappen'}
        >
          {roots.length ? (open ? CHEVRON_DOWN : CHEVRON_RIGHT) : ''}
        </button>
        <span className="ms-mark" aria-hidden="true">
          ◆
        </span>
        <span className="title">{milestone.title || <em>Ohne Titel</em>}</span>
        <SegBar segments={statusSegments(ws, milestone)} />
        <span className="ms-count">
          {stats.done}/{stats.total}
        </span>
      </div>
      {open && roots.map((t) => <TaskRow key={t.id} ws={ws} task={t} depth={0} />)}
    </>
  );
}

function TaskRow({ ws, task, depth }: { ws: Workspace; task: Task; depth: number }) {
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

/** Dieselbe Farbableitung wie im Prototyp: gleicher Name, gleicher Farbton. */
function tagStyle(tag: string): React.CSSProperties {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { '--h': h } as React.CSSProperties;
}
