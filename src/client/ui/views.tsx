import { useEffect } from 'react';
import { milestoneStats, statusSegments } from '@shared/progress.js';
import { schedule } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { SegBar } from './icons.js';
import { GroupRow, TaskRow } from './rows.js';

/* ------------------------------------------------------------------- Plan */

/** Milestones mit ihren Aufgabenbäumen, dazu die Prognose. */
export function PlanView({ ws, projectId }: { ws: Workspace; projectId: string }) {
  const { collapsed, select, settings } = useStore();
  const milestones = ws.milestones
    .filter((m) => m.projectId === projectId)
    .sort((a, b) => Number(b.planned) - Number(a.planned) || a.qorder - b.qorder);
  const plan = schedule(ws, { velocity: settings.velocity });

  if (!milestones.length) return <Empty>Noch keine Milestones in diesem Projekt.</Empty>;

  return (
    <div className="list">
      {milestones.map((m) => {
        const stats = milestoneStats(ws, m);
        const line = plan.byId.get(m.id);
        return (
          <div key={m.id}>
            <GroupRow
              id={m.id}
              title={m.title || 'Ohne Titel'}
              icon="◆"
              count={stats.total}
              onSelect={() => select(m.id)}
              right={
                <>
                  <SegBar segments={statusSegments(ws, m)} />
                  {line ? (
                    <span className={`eta ${line.late ? 'late' : ''}`} title={forecastTitle(line)}>
                      {formatWeeks(line.end)}
                    </span>
                  ) : (
                    <span className="eta muted-eta">nicht eingeplant</span>
                  )}
                </>
              }
            />
            {!collapsed[m.id] &&
              ws.msRoots(m).map((t) => <TaskRow key={t.id} ws={ws} task={t} depth={0} />)}
          </div>
        );
      })}
    </div>
  );
}

const formatWeeks = (weeks: number): string => {
  const days = Math.round(weeks * 7);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};

const forecastTitle = (line: { open: number; late: boolean; fixedEnd: boolean }): string =>
  `${line.open} Aufgaben offen` +
  (line.fixedEnd ? ' · Enddatum gesetzt' : ' · errechnet aus dem Tempo') +
  (line.late ? ' · Prognose liegt dahinter' : '');

/* ---------------------------------------------------------------- Backlog */

/** Alles ohne Milestone: eigene Gruppen, Markierungen und der Rest. */
export function BacklogView({ ws, projectId }: { ws: Workspace; projectId: string }) {
  const { collapsed } = useStore();
  const groups = ws.groups.filter((g) => g.projectId === projectId).sort((a, b) => a.order - b.order);
  const loose = ws.tasks
    .filter((t) => t.projectId === projectId && !t.parentId && !t.milestoneId && !t.groupId && !t.doc)
    .sort((a, b) => a.order - b.order);

  if (!groups.length && !loose.length) return <Empty>Der Backlog ist leer.</Empty>;

  return (
    <div className="list">
      {groups.map((g) => {
        const tasks = ws.tasks
          .filter((t) => t.groupId === g.id && !t.parentId)
          .sort((a, b) => a.order - b.order);
        return (
          <div key={g.id}>
            <GroupRow id={g.id} title={g.title} count={tasks.length} />
            {!collapsed[g.id] && tasks.map((t) => <TaskRow key={t.id} ws={ws} task={t} depth={0} />)}
          </div>
        );
      })}

      {loose.length > 0 && (
        <>
          <GroupRow id={`unsorted:${projectId}`} title="Unsortiert" count={loose.length} />
          {!collapsed[`unsorted:${projectId}`] &&
            loose.map((t) => <TaskRow key={t.id} ws={ws} task={t} depth={0} />)}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- Dokumente */

/** Dokumente sind Aufgaben mit gesetztem Flag; Unteraufgaben sind Unterseiten. */
export function DocsView({ ws, projectId }: { ws: Workspace; projectId: string }) {
  const docs = ws.tasks
    .filter((t) => t.projectId === projectId && t.doc && !t.parentId)
    .sort((a, b) => a.order - b.order);

  if (!docs.length) return <Empty>Noch keine Dokumente in diesem Projekt.</Empty>;

  return (
    <div className="list">
      {docs.map((t) => (
        <TaskRow key={t.id} ws={ws} task={t} depth={0} />
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Archiv */

/** Wird erst beim Öffnen geholt – siehe PHASE-2.md, Abschnitt 4. */
export function ArchiveView({ projectId }: { projectId: string }) {
  const { archive, loadArchive, archiveQuery, setArchiveQuery, unarchive } = useStore();

  useEffect(() => {
    void loadArchive(projectId);
  }, [loadArchive, projectId, archiveQuery]);

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
  <div className="empty">{children}</div>
);
