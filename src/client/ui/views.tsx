import { useEffect } from 'react';
import { isDone, type Milestone, type Task } from '@shared/model.js';
import { outline, type OutlineRow, type OutlineView } from '@shared/outline.js';
import { milestoneProgressPct, milestoneStats } from '@shared/progress.js';
import { schedule, type ScheduledMilestone } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { scopeProjectIds, useStore } from '../store.js';
import { addIn } from './actions.js';
import { bulkMenu } from './BulkBar.js';
import { useKeys } from './keys.js';
import { useMenu } from './Menu.js';
import { rowMenu } from './rowMenu.js';
import { EmptyDrop, GroupRow, MilestoneRow, SectionRow, TaskRow } from './rows.js';

/* ----------------------------------------------------- Plan, Backlog, Docs */

/**
 * Die drei Arbeitsansichten teilen sich eine Zeilenfolge (`outline`), damit
 * Anzeige, Tastatur und Drag & Drop dieselbe Reihenfolge sehen.
 */
export function Outline({ ws, view }: { ws: Workspace; view: OutlineView }) {
  const state = useStore();
  const { collapsed, settings, filter } = state;
  const rows = outline(ws, { view, projectIds: scopeProjectIds(state), collapsed, filter });
  const menu = useMenu();
  useKeys(ws, rows, menu);

  // Auswahl und Tastatur brauchen dieselbe Reihenfolge, die hier gezeichnet wird.
  const { setVisible } = state;
  useEffect(() => {
    setVisible(rows.filter((r) => r.type === 'task').map((r) => r.id));
  });

  const plan = view === 'plan' ? schedule(ws, { velocity: settings.velocity }) : null;

  if (!rows.length) {
    return (
      <div className="list">
        <Empty>{view === 'plan' ? <PlanEmpty /> : EMPTY[view]}</Empty>
        <KbdHint />
      </div>
    );
  }

  return (
    <>
      <div
        className={`list ${state.multi.size ? 'has-multi' : ''}`}
        onContextMenu={(e) => {
          const el = e.target as HTMLElement;
          const id = el.closest('[data-row]')?.getAttribute('data-row');
          if (!id || el.closest('input, textarea')) return;
          e.preventDefault();

          // Rechtsklick auf eine ausgewählte Zeile gilt der ganzen Auswahl,
          // sonst nur dieser einen – so wie im Prototyp.
          if (state.multi.has(id)) {
            menu.openAtPoint(e.clientX, e.clientY, bulkMenu(ws));
            return;
          }
          const row = rows.find((r) => r.id === id);
          if (!row) return;
          state.clearMulti();
          if (row.type === 'task' || row.type === 'milestone') state.select(id);
          menu.openAtPoint(e.clientX, e.clientY, rowMenu(ws, row));
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
                doc={view === 'docs'}
                menu={menu}
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
              />
            );
          }
          if (row.type === 'empty') {
            return (
              <EmptyDrop
                key={row.id}
                row={row}
                onAdd={() => void addIn(row.projectId, row.place)}
              />
            );
          }
          if (row.type === 'section') {
            return (
              <SectionRow key={row.id} title={row.title} action={<SectionAction row={row} />} />
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
              stats={stats}
              pct={milestoneProgressPct(ws, m)}
              right={<MilestoneRight ws={ws} milestone={m} line={plan?.byId.get(m.id) ?? null} />}
            />
          );
        })}
        <KbdHint />
      </div>
      {menu.node}
    </>
  );
}

/** Die Kürzelleiste am Fuß der Liste, wie im Prototyp. */
function KbdHint() {
  return (
    <div className="kbd-hint">
      <span>
        <kbd>N</kbd> Neu
      </span>
      <span>
        <kbd>Enter</kbd> gleiche Ebene
      </span>
      <span>
        <kbd>Tab</kbd> einrücken
      </span>
      <span>
        <kbd>Leertaste</kbd> erledigt
      </span>
      <span>
        <kbd>P</kbd> Milestone planen
      </span>
      <span>
        <kbd>?</kbd> alle Kürzel
      </span>
    </div>
  );
}

/** Die Handlung rechts in einer Abschnittsüberschrift. */
function SectionAction({ row }: { row: Extract<OutlineRow, { type: 'section' }> }) {
  if (row.action === 'manage-marks') {
    return (
      <button className="linkish" onClick={() => useStore.getState().setDialog('marks')}>
        Markierungen verwalten
      </button>
    );
  }
  // Wie im Prototyp (`addGroup`, `addMilestone`): sofort anlegen und den Namen in
  // der neuen Zeile bearbeiten – bleibt er leer, verschwindet die Zeile wieder.
  const store = useStore.getState;
  if (row.action === 'add-group') {
    return (
      <button
        className="linkish"
        onClick={() =>
          void store()
            .addGroup('', row.projectId)
            .then((id) => id && store().edit(id, true))
        }
      >
        + Gruppe
      </button>
    );
  }
  return (
    <button
      className="linkish"
      // Aus dem Backlog heraus ist ein Milestone ein vorbereiteter.
      onClick={() =>
        void store()
          .addMilestone('', { planned: false, projectId: row.projectId })
          .then((id) => id && store().edit(id, true))
      }
    >
      + Milestone
    </button>
  );
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
  const { setMilestoneStatus, archiveItem, settings } = useStore();
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
            void setMilestoneStatus(milestone.id, 'done');
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
            void useStore.getState().planMilestone(milestone.id, true);
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
        onClick={() => void addMilestone('').then((id) => id && useStore.getState().edit(id, true))}
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

const Empty = ({ children }: { children: React.ReactNode }) => (
  <div className="empty-state">{children}</div>
);
