import { useRef, useState } from 'react';
import { isDone, type Task } from '@shared/model.js';
import { placeLabel } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { PrioIcon } from './icons.js';
import { markdownHtml } from './markdown.js';
import { ChecklistBadge, StatusDot } from './rows.js';

/**
 * Der Inspektor bei einer Mehrfachauswahl: eine Karte je Aufgabe mit ihrer
 * Beschreibung. Aus dem Prototyp – gedacht zum Vergleichen und zum Kopieren
 * von Text zwischen Aufgaben, deshalb sind die Beschreibungen hier alle offen.
 */
export function MultiDetail({ ws }: { ws: Workspace }) {
  const { multi, visible, clearMulti, select } = useStore();
  const order = (id: string): number => {
    const i = visible.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const tasks = [...multi]
    .sort((a, b) => order(a) - order(b))
    .map((id) => ws.task(id))
    .filter((t): t is Task => !!t);

  return (
    <aside className="detail">
      <div className="d-top">
        <div className="crumbs">
          <b className="multi-head">{tasks.length} Aufgaben ausgewählt</b>
        </div>
        <button
          className="icon-btn"
          title="Auswahl aufheben (Esc)"
          aria-label="Auswahl aufheben"
          onClick={clearMulti}
        >
          ✕
        </button>
      </div>
      <p className="hint multi-hint">
        Text markieren und kopieren, dann in einer anderen Beschreibung auf „bearbeiten“ klicken und
        einfügen.
      </p>

      {tasks.map((t) => (
        <Card
          key={t.id}
          ws={ws}
          task={t}
          onOpen={() => {
            clearMulti();
            select(t.id);
          }}
        />
      ))}
    </aside>
  );
}

function Card({ ws, task, onOpen }: { ws: Workspace; task: Task; onOpen: () => void }) {
  const patch = useStore((s) => s.patch);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const implicit =
    !isDone(task) &&
    task.status === 'open' &&
    ws.kids(task.id).length > 0 &&
    ws.desc(task).some((d) => d.status === 'progress');

  const commit = (text: string): void => {
    setEditing(false);
    if (text !== task.desc) void patch('task', task.id, { desc: text });
  };

  return (
    <article className="mcard">
      <header className="mcard-h">
        <StatusDot task={task} implicit={implicit} />
        {ws.mark(task.markId) && (
          <span className="mk-emoji" title={ws.mark(task.markId)?.name}>
            {ws.mark(task.markId)?.emoji}
          </span>
        )}
        <button className="mcard-title" title="Nur diese Aufgabe öffnen" onClick={onOpen}>
          {task.title || <em>Ohne Titel</em>}
        </button>
        <PrioIcon prio={task.prio} />
        <ChecklistBadge desc={task.desc} />
        <span className="mcard-where">{whereShort(ws, task)}</span>
      </header>

      {editing ? (
        <textarea
          ref={ref}
          className="mcard-desc"
          spellCheck
          placeholder="Markdown …"
          aria-label={`Beschreibung von ${task.title}`}
          defaultValue={task.desc}
          autoFocus
          onBlur={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
          }}
        />
      ) : (
        <div
          className="mcard-md md"
          role="button"
          tabIndex={0}
          title="Klicken zum Bearbeiten · Text markieren zum Kopieren"
          aria-label={`Beschreibung von ${task.title} bearbeiten`}
          onClick={() => setEditing(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setEditing(true);
          }}
          {...(task.desc
            ? { dangerouslySetInnerHTML: { __html: markdownHtml(task.desc) } }
            : {
                children: (
                  <p className="hint mcard-empty">Keine Beschreibung – klicken zum Schreiben</p>
                ),
              })}
        />
      )}
    </article>
  );
}

/** Wo die Aufgabe liegt – kurz, ohne den Zusatz hinter dem Mittelpunkt. */
function whereShort(ws: Workspace, t: Task): string {
  if (t.parentId) return `unter „${ws.task(t.parentId)?.title ?? ''}“`;
  const ms = ws.milestone(t.milestoneId);
  if (ms) return `◆ ${ms.title}`;
  if (t.doc) return 'Dokumentation';
  return placeLabel(ws, t);
}
