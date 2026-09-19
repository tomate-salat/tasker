import { useEffect } from 'react';
import { isDone, type Milestone, type Task } from '@shared/model.js';
import { outline, type OutlineView } from '@shared/outline.js';
import { milestoneProgressPct, milestoneStats } from '@shared/progress.js';
import { schedule, type ScheduledMilestone } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { scopeProjectIds, useStore } from '../store.js';
import { useDnd } from './dnd.js';
import { useKeys } from './keys.js';
import { GroupRow, MilestoneRow, TaskRow } from './rows.js';

/* ----------------------------------------------------- Plan, Backlog, Docs */

/**
 * Die drei Arbeitsansichten teilen sich eine Zeilenfolge (`outline`), damit
 * Anzeige, Tastatur und Drag & Drop dieselbe Reihenfolge sehen.
 */
export function Outline({ ws, view }: { ws: Workspace; view: OutlineView }) {
  const state = useStore();
  const { collapsed, select, settings, filter } = state;
  const rows = outline(ws, { view, projectIds: scopeProjectIds(state), collapsed, filter });
  const dnd = useDnd(ws);
  useKeys(ws, rows);

  const plan = view === 'plan' ? schedule(ws, { velocity: settings.velocity }) : null;

  if (!rows.length) return <Empty>{EMPTY[view]}</Empty>;

  return (
    <div className="list" onDragEnd={() => dnd.end()}>
      {rows.map((row) => {
        if (row.type === 'task') {
          return (
            <TaskRow
              key={row.id}
              ws={ws}
              task={row.task}
              depth={row.depth}
              dnd={dnd}
              doc={view === 'docs'}
            />
          );
        }
        if (row.type === 'group') {
          return (
            <GroupRow
              key={row.id}
              id={row.id}
              title={row.title}
              unsorted={!row.group}
              count={openIn(ws, row.tasks)}
              onAdd={() => void addIn(row.group ? { groupId: row.group.id } : {}, row.projectId)}
              dnd={dnd}
              droppable={!!row.group}
            />
          );
        }
        if (row.type === 'project') {
          return (
            <div key={row.id} className="phead">
              <span className="dot" style={{ background: row.project.color }} aria-hidden="true" />
              {row.project.name}
            </div>
          );
        }

        const m = row.milestone;
        const stats = milestoneStats(ws, m);
        return (
          <MilestoneRow
            key={m.id}
            ws={ws}
            milestone={m}
            dnd={dnd}
            stats={stats}
            pct={milestoneProgressPct(ws, m)}
            right={<MilestoneRight ws={ws} milestone={m} line={plan?.byId.get(m.id) ?? null} />}
          />
        );
      })}
    </div>
  );
}

/** Legt eine Aufgabe an der genannten Stelle an und öffnet gleich den Titel. */
async function addIn(target: Record<string, unknown>, projectId: string): Promise<void> {
  const store = useStore.getState();
  const id = await store.addTask({ projectId, title: '', ...target });
  if (id) store.edit(id);
}

const openIn = (ws: Workspace, tasks: Task[]): number =>
  tasks.reduce((n, t) => n + (isDone(t) ? 0 : 1) + ws.desc(t).filter((d) => !isDone(d)).length, 0);

/**
 * Rechts in der Milestone-Zeile: Status, Zeitraum und die nächste sinnvolle
 * Handlung – genau die Abfolge aus dem Prototyp.
 */
function MilestoneRight({
  ws,
  milestone,
  line,
}: {
  ws: Workspace;
  milestone: Milestone;
  line: ScheduledMilestone | null;
}) {
  const { patch, archiveItem, settings } = useStore();
  const stats = milestoneStats(ws, milestone);

  if (stats.isDone) {
    return (
      <>
        <span className="stpill st-done">Done</span>
        {milestone.endDate && <span className="eta">{formatDay(new Date(milestone.endDate))}</span>}
        <button
          className="btn tiny"
          onClick={(e) => {
            e.stopPropagation();
            void archiveItem('milestone', milestone.id);
          }}
        >
          Archivieren
        </button>
      </>
    );
  }

  const progress = milestone.status === 'progress';

  return (
    <>
      {progress && <span className="stpill st-progress">In Progress</span>}
      {progress && milestone.startDate && (
        <span className="eta" title={`Gestartet am ${milestone.startDate}`}>
          seit {formatDay(new Date(milestone.startDate))}
        </span>
      )}

      {stats.tasksDone ? (
        <button
          className="btn tiny"
          title="Alle Aufgaben sind erledigt"
          onClick={(e) => {
            e.stopPropagation();
            void patch('milestone', milestone.id, { status: 'done' });
          }}
        >
          Als Done markieren
        </button>
      ) : milestone.planned ? (
        line &&
        (stats.open > 0 || line.fixedEnd) && (
          <span
            className={`eta ${line.late ? 'late' : ''}`}
            title={
              line.late
                ? `Prognose ${formatWeeks(line.forecastEnd)} liegt nach dem Enddatum`
                : `Prognose bei ${settings.velocity} Aufgaben pro Woche`
            }
          >
            bis {line.fixedEnd && milestone.endDate ? formatDay(new Date(milestone.endDate)) : formatWeeks(line.end)}
            {line.late ? ' ⚠' : ''}
          </span>
        )
      ) : (
        <button
          className="btn tiny"
          onClick={(e) => {
            e.stopPropagation();
            void patch('milestone', milestone.id, { planned: true });
          }}
        >
          In den Plan →
        </button>
      )}
    </>
  );
}

const EMPTY: Record<OutlineView, string> = {
  plan: 'Noch keine Milestones in diesem Projekt.',
  backlog: 'Der Backlog ist leer.',
  docs: 'Noch keine Dokumente in diesem Projekt.',
};

const formatDay = (d: Date): string =>
  d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

const formatWeeks = (weeks: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return formatDay(d);
};

/* ----------------------------------------------------------------- Archiv */

/** Wird erst beim Öffnen geholt – siehe PHASE-2.md, Abschnitt 4. */
export function ArchiveView() {
  const { archive, loadArchive, archiveQuery, setArchiveQuery, unarchive, scope } = useStore();

  useEffect(() => {
    void loadArchive();
  }, [loadArchive, scope, archiveQuery]);

  return (
    <div className="list pad">
      <div className="searchbar">
        <input
          value={archiveQuery}
          placeholder="Im Archiv suchen …"
          onChange={(e) => setArchiveQuery(e.target.value)}
        />
        {archive && (
          <span className="muted">
            {archive.total} {archive.total === 1 ? 'Eintrag' : 'Einträge'}
          </span>
        )}
      </div>

      {!archive && <p className="muted">Lade …</p>}
      {archive?.entries.length === 0 && (
        <Empty>{archiveQuery ? 'Nichts passt zur Suche.' : 'Das Archiv ist leer.'}</Empty>
      )}

      {archive?.entries.map((e) => (
        <div key={e.id} className="row arch-row">
          <span className="ms-mark">{e.kind === 'milestone' ? '◆' : '📋'}</span>
          <span className="title">{e.title || <em>Ohne Titel</em>}</span>
          {e.hiddenCount > 0 && (
            <span className="muted small">
              +{e.hiddenCount} {e.hiddenCount === 1 ? 'Unteraufgabe' : 'Unteraufgaben'}
            </span>
          )}
          <span className="muted small">{new Date(e.archivedAt).toLocaleDateString('de-DE')}</span>
          <button className="btn tiny" onClick={() => void unarchive(e.kind, e.id)}>
            Wiederherstellen
          </button>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Papierkorb */

export function TrashView() {
  const { trash, trashDays, loadTrash, restoreTrash, purgeTrash } = useStore();

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  if (!trash) return <p className="muted pad">Lade …</p>;
  if (!trash.length) return <Empty>Der Papierkorb ist leer.</Empty>;

  return (
    <div className="list pad">
      <p className="muted small">Einträge werden nach {trashDays} Tagen endgültig gelöscht.</p>
      {trash.map((e) => {
        const age = Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 864e5);
        const left = Math.max(0, trashDays - age);
        return (
          <div key={e.id} className="row arch-row">
            <span className="title">{e.title || <em>Ohne Titel</em>}</span>
            {e.taskCount > 1 && <span className="muted small">{e.taskCount} Aufgaben</span>}
            <span className={`muted small ${left <= 3 ? 'late' : ''}`}>
              noch {left} {left === 1 ? 'Tag' : 'Tage'}
            </span>
            <button className="btn tiny" onClick={() => void restoreTrash(e.id)}>
              Wiederherstellen
            </button>
            <button className="btn tiny ghost" onClick={() => void purgeTrash(e.id)}>
              Endgültig löschen
            </button>
          </div>
        );
      })}
    </div>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="empty-state">{children}</div>
);
