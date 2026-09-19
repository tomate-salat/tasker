import { useEffect } from 'react';
import { outline, type OutlineView } from '@shared/outline.js';
import { milestoneStats, statusSegments } from '@shared/progress.js';
import { schedule } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { useDnd } from './dnd.js';
import { SegBar } from './icons.js';
import { useKeys } from './keys.js';
import { GroupRow, TaskRow } from './rows.js';

/* ----------------------------------------------------- Plan, Backlog, Docs */

/**
 * Die drei Arbeitsansichten teilen sich eine Zeilenfolge (`outline`), damit
 * Anzeige, Tastatur und Drag & Drop dieselbe Reihenfolge sehen.
 */
export function Outline({
  ws,
  projectId,
  view,
}: {
  ws: Workspace;
  projectId: string;
  view: OutlineView;
}) {
  const { collapsed, select, settings } = useStore();
  const rows = outline(ws, { view, projectId, collapsed });
  const dnd = useDnd(ws);
  useKeys(ws, rows);

  const plan = view === 'plan' ? schedule(ws, { velocity: settings.velocity }) : null;

  if (!rows.length) return <Empty>{EMPTY[view]}</Empty>;

  return (
    <div className="list" onDragEnd={() => dnd.end()}>
      {rows.map((row) => {
        if (row.type === 'task') {
          return <TaskRow key={row.id} ws={ws} task={row.task} depth={row.depth} dnd={dnd} />;
        }
        if (row.type === 'group') {
          return (
            <GroupRow key={row.id} id={row.id} title={row.title} count={row.count} dnd={dnd} droppable={!!row.group} />
          );
        }

        const m = row.milestone;
        const line = plan?.byId.get(m.id);
        return (
          <GroupRow
            key={m.id}
            id={m.id}
            title={m.title || 'Ohne Titel'}
            icon="◆"
            count={milestoneStats(ws, m).total}
            onSelect={() => select(m.id)}
            dnd={dnd}
            droppable
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
        );
      })}
    </div>
  );
}

const EMPTY: Record<OutlineView, string> = {
  plan: 'Noch keine Milestones in diesem Projekt.',
  backlog: 'Der Backlog ist leer.',
  docs: 'Noch keine Dokumente in diesem Projekt.',
};

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
