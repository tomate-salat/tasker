import { useEffect } from 'react';
import { isDone, type Milestone, type Task } from '@shared/model.js';
import { outline, type OutlineRow, type OutlineView, type Placement } from '@shared/outline.js';
import { milestoneProgressPct, milestoneStats } from '@shared/progress.js';
import { schedule, type ScheduledMilestone } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { scopeProjectIds, useStore } from '../store.js';
import { bulkMenu } from './BulkBar.js';
import { useDnd } from './dnd.js';
import { useKeys } from './keys.js';
import { useMenu } from './Menu.js';
import { NewThing } from './NewThing.js';
import { EmptyDrop, GroupRow, MilestoneRow, SectionRow, TaskRow } from './rows.js';

/* ----------------------------------------------------- Plan, Backlog, Docs */

/**
 * Die drei Arbeitsansichten teilen sich eine Zeilenfolge (`outline`), damit
 * Anzeige, Tastatur und Drag & Drop dieselbe Reihenfolge sehen.
 */
export function Outline({
  ws,
  view,
  onManageMarks,
}: {
  ws: Workspace;
  view: OutlineView;
  onManageMarks: () => void;
}) {
  const state = useStore();
  const { collapsed, settings, filter } = state;
  const rows = outline(ws, { view, projectIds: scopeProjectIds(state), collapsed, filter });
  const dnd = useDnd(ws);
  const menu = useMenu();
  useKeys(ws, rows);

  // Auswahl und Tastatur brauchen dieselbe Reihenfolge, die hier gezeichnet wird.
  const { setVisible } = state;
  useEffect(() => {
    setVisible(rows.filter((r) => r.type === 'task').map((r) => r.id));
  });

  const plan = view === 'plan' ? schedule(ws, { velocity: settings.velocity }) : null;

  if (!rows.length) return <Empty>{view === 'plan' ? <PlanEmpty /> : EMPTY[view]}</Empty>;

  return (
    <>
      <div
        className={`list ${state.multi.size ? 'has-multi' : ''}`}
        onDragEnd={() => dnd.end()}
        onContextMenu={(e) => {
          // Rechtsklick auf eine ausgewählte Zeile gilt der ganzen Auswahl.
          const id = (e.target as HTMLElement).closest('[data-row]')?.getAttribute('data-row');
          if (!id || !state.multi.has(id)) return;
          e.preventDefault();
          menu.openAtPoint(e.clientX, e.clientY, bulkMenu(ws));
        }}
      >
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
                row={row}
                count={openIn(ws, row.tasks)}
                onAdd={() => void addIn(row.projectId, row.place)}
                onManageMarks={onManageMarks}
                dnd={dnd}
              />
            );
          }
          if (row.type === 'empty') {
            return (
              <EmptyDrop
                key={row.id}
                row={row}
                onAdd={() => void addIn(row.projectId, row.place)}
                dnd={dnd}
              />
            );
          }
          if (row.type === 'section') {
            return (
              <SectionRow
                key={row.id}
                title={row.title}
                action={<SectionAction row={row} onManageMarks={onManageMarks} />}
              />
            );
          }
          if (row.type === 'hint') {
            return (
              <div key={row.id} className="hint-row">
                {row.text}
              </div>
            );
          }
          if (row.type === 'project') {
            return (
              <div key={row.id} className="phead">
                <span
                  className="dot"
                  style={{ background: row.project.color }}
                  aria-hidden="true"
                />
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
      {menu.node}
    </>
  );
}

/** Die Handlung rechts in einer Abschnittsüberschrift. */
function SectionAction({
  row,
  onManageMarks,
}: {
  row: Extract<OutlineRow, { type: 'section' }>;
  onManageMarks: () => void;
}) {
  if (row.action === 'manage-marks') {
    return (
      <button className="linkish" onClick={onManageMarks}>
        Markierungen verwalten
      </button>
    );
  }
  if (row.action === 'add-group') {
    return (
      <NewThing
        className="linkish"
        label="+ Gruppe"
        placeholder="Name der Gruppe"
        onCreate={(t) => useStore.getState().addGroup(t, row.projectId)}
      />
    );
  }
  return (
    <NewThing
      className="linkish"
      label="+ Milestone"
      placeholder="Titel des Milestones"
      // Aus dem Backlog heraus ist ein Milestone ein vorbereiteter.
      onCreate={async (t) =>
        void (await useStore
          .getState()
          .addMilestone(t, { planned: false, projectId: row.projectId }))
      }
    />
  );
}

/**
 * Legt eine Aufgabe an der genannten Stelle an und öffnet gleich den Titel.
 * Die Markierung gehört dazu: sie entscheidet über die smarte Gruppe.
 */
async function addIn(projectId: string, place: Placement): Promise<void> {
  const store = useStore.getState();
  const id = await store.addTask({
    projectId,
    title: '',
    milestoneId: place.milestoneId ?? null,
    groupId: place.groupId ?? null,
    markId: place.markId ?? null,
  });
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
            bis{' '}
            {line.fixedEnd && milestone.endDate
              ? formatDay(new Date(milestone.endDate))
              : formatWeeks(line.end)}
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
  plan: 'Nichts im Plan.',
  backlog: 'Der Backlog ist leer.',
  docs: 'Noch keine Dokumente in diesem Projekt.',
};

/** Wie im Prototyp: der leere Plan zeigt beide Wege, dorthin etwas zu bekommen. */
function PlanEmpty() {
  const { setView, addMilestone } = useStore();
  return (
    <>
      Nichts im Plan. Bereite Milestones im{' '}
      <button className="linkish" onClick={() => setView('backlog')}>
        Backlog
      </button>{' '}
      vor oder{' '}
      <button
        className="linkish"
        onClick={() => void addMilestone('').then((id) => id && useStore.getState().edit(id))}
      >
        leg direkt einen an
      </button>
      .
    </>
  );
}

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
