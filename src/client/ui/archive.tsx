import { useEffect } from 'react';
import { isDone, type Milestone, type Task } from '@shared/model.js';
import { areaLabel, placeLabel } from '@shared/outline.js';
import { allDone } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { imageUrl, type ArchiveEntry, type TrashEntry } from '../api.js';
import { archiveWorkspace, scopeProjectIds, useStore } from '../store.js';
import { CHEVRON_DOWN, CHEVRON_RIGHT } from './icons.js';
import { useMenu, type Menu, type MenuItem } from './Menu.js';

/* ----------------------------------------------------------------- Archiv */

/**
 * Das Archiv wie im Prototyp (`archiveHtml`): nach Monaten, neueste zuerst,
 * mit Herkunft, aufklappbar bis in die Unteraufgaben. Ausgewähltes öffnet den
 * Inspektor. Die Daten holt der Server seitenweise (PHASE-2.md, Abschnitt 4).
 */
export function ArchiveView() {
  const state = useStore();
  const { archive, archiveFor, archiveQuery, scope, loadArchive, archOpen, setArchOpen, selected, select } =
    state;
  const key = `${scope}|${archiveQuery.trim()}`;
  const menu = useMenu();

  useEffect(() => {
    if (!archive || archiveFor !== key) void loadArchive();
  }, [archive, archiveFor, key, loadArchive]);

  const ws = archiveWorkspace(state);
  const ids: string[] = [];
  useArchiveKeys(ws, ids, menu);

  if (!archive || !ws) return <div className="list" />;
  if (!archive.entries.length) {
    return (
      <div className="list">
        <div className="empty-state">
          {archiveQuery.trim() ? (
            'Nichts im Archiv passt zur Suche.'
          ) : (
            <>
              Das Archiv ist leer. Erledigtes schickst du per Rechtsklick › Archivieren, mit <kbd>A</kbd>{' '}
              oder indem du es auf den Tab „Archiv“ ziehst.
            </>
          )}
        </div>
      </div>
    );
  }

  const out: React.ReactNode[] = [];
  const pre = (projectId: string): string =>
    scope === 'all' ? `${ws.project(projectId)?.name ?? ''} · ` : '';

  // Einzeln Archiviertes steht zweimal da – als Eintrag und im Baum darüber –, daher der Pfad im Schlüssel.
  const child = (t: Task, d: number, path: string): void => {
    ids.push(t.id);
    const kids = ws.allKids(t.id);
    const open = !!archOpen[t.id];
    out.push(
      <div
        key={`${path}/${t.id}`}
        data-row={t.id}
        className={`row task-row arch-child ${selected === t.id ? 'sel' : ''} ${allDone(ws, t) ? 'done' : ''}`}
        style={{ '--d': d } as React.CSSProperties}
        onClick={() => select(t.id)}
      >
        <Caret open={open} has={kids.length > 0} onToggle={() => setArchOpen(t.id, !open)} />
        <span className="check static" aria-hidden="true">
          {isDone(t) ? '✓' : ''}
        </span>
        <MarkEmoji ws={ws} task={t} />
        <span className="title">{t.title || <em>Ohne Titel</em>}</span>
        {t.archivedAt && <span className="from">einzeln archiviert</span>}
      </div>,
    );
    if (open) kids.forEach((k) => child(k, d + 1, `${path}/${t.id}`));
  };

  let month = '';
  for (const e of archive.entries) {
    const x = e.kind === 'milestone' ? ws.milestone(e.id) : ws.task(e.id);
    if (!x) continue;
    const mo = new Date(e.archivedAt).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (mo !== month) {
      month = mo;
      out.push(
        <div key={`mo-${e.id}`} className="sec">
          {mo}
        </div>,
      );
    }
    const isMs = e.kind === 'milestone';
    const open = !!archOpen[e.id];
    const kids = isMs ? msTasks(ws, e.id) : ws.allKids(e.id);
    ids.push(e.id);
    out.push(
      <div
        key={e.id}
        data-row={e.id}
        className={`row arch-row ${isMs ? 'ms-row' : 'task-row'} ${selected === e.id ? 'sel' : ''} ${
          isMs || allDone(ws, x as Task) ? 'done' : ''
        }`}
        style={{ '--d': 0 } as React.CSSProperties}
        onClick={() => select(e.id)}
      >
        <Caret open={open} has={kids.length > 0} onToggle={() => setArchOpen(e.id, !open)} />
        {isMs ? (
          <span className="ico ms">◆</span>
        ) : (
          <span className="check static" aria-hidden="true">
            {isDone(x as Task) ? '✓' : ''}
          </span>
        )}
        {!isMs && <MarkEmoji ws={ws} task={x as Task} />}
        <span className="title">{x.title || <em>Ohne Titel</em>}</span>
        <span className="from">{pre(e.projectId) + from(ws, e, x)}</span>
        <span className="eta" title={`Archiviert am ${fmtDate(e.archivedAt)}`}>
          {fmtD(e.archivedAt)}
        </span>
        <span className="row-actions">
          <button
            title="Wiederherstellen"
            aria-label="Wiederherstellen"
            onClick={(ev) => {
              ev.stopPropagation();
              void restoreItem(ws, e.id);
            }}
          >
            ↩
          </button>
          <button
            title="In den Papierkorb"
            aria-label="In den Papierkorb"
            onClick={(ev) => {
              ev.stopPropagation();
              void purgeItem(ws, e.id);
            }}
          >
            ✕
          </button>
        </span>
      </div>,
    );
    if (open) kids.forEach((k) => child(k, 1, e.id));
  }

  const more = archive.total - archive.entries.length;

  return (
    <>
      <div
        className="list"
        onContextMenu={(ev) => {
          const el = ev.target as HTMLElement;
          const id = el.closest('[data-row]')?.getAttribute('data-row');
          if (!id) return;
          ev.preventDefault();
          select(id);
          menu.openAtPoint(ev.clientX, ev.clientY, archMenu(ws, id));
        }}
      >
        {out}
        {more > 0 && (
          // Der Prototyp hält alles im Speicher; hier kommt das Archiv seitenweise.
          <div className="hint-row">
            <button className="linkish" onClick={() => void loadArchive(true)}>
              {more} weitere laden
            </button>
          </div>
        )}
      </div>
      {menu.node}
    </>
  );
}

/** Die Wurzelaufgaben eines Milestones – auch einzeln archivierte, wie im Prototyp. */
const msTasks = (ws: Workspace, id: string): Task[] =>
  ws.tasks.filter((t) => !t.parentId && t.milestoneId === id).sort((a, b) => a.order - b.order);

/** Woher ein Eintrag kam – `from` im Prototyp. */
function from(ws: Workspace, e: ArchiveEntry, x: Task | Milestone): string {
  if ('planned' in x) return `aus dem ${x.planned ? 'Plan' : 'Backlog'} · ${msTasks(ws, x.id).length} Tasks`;
  if (x.parentId) return `aus „${e.parentTitle ?? '?'}“`;
  if (x.milestoneId) return `aus ◆ ${e.milestoneTitle ?? '?'}`;
  return `aus ${areaLabel(ws, x)} › ${placeLabel(ws, x)}`;
}

function archMenu(ws: Workspace, id: string): MenuItem[] {
  const x = ws.milestone(id) ?? ws.task(id);
  const top = !!x?.archivedAt;
  return [
    { label: 'Details öffnen', onSelect: () => useStore.getState().select(id) },
    { label: 'Wiederherstellen', kbd: 'A', disabled: !top, onSelect: () => void restoreItem(ws, id) },
    { sep: true },
    {
      label: 'In den Papierkorb',
      kbd: 'Entf',
      danger: true,
      disabled: !top,
      onSelect: () => void purgeItem(ws, id),
    },
  ];
}

const kindOf = (ws: Workspace, id: string): 'task' | 'milestone' =>
  ws.milestone(id) ? 'milestone' : 'task';

/** Nur der archivierte Eintrag selbst lässt sich zurückholen, nicht was darin liegt. */
function restoreItem(ws: Workspace, id: string): Promise<void> | void {
  const x = ws.milestone(id) ?? ws.task(id);
  if (!x) return;
  if (!x.archivedAt) {
    useStore.getState().say('Liegt in einem archivierten Eintrag – stell den wieder her');
    return;
  }
  return useStore.getState().unarchive(kindOf(ws, id), id);
}

/** Löschen aus dem Archiv: ebenfalls in den Papierkorb. */
function purgeItem(ws: Workspace, id: string): Promise<void> | void {
  const x = ws.milestone(id) ?? ws.task(id);
  if (!x?.archivedAt) return;
  return useStore.getState().remove(kindOf(ws, id), id, 'In den Papierkorb verschoben');
}

/**
 * Die Tasten im Archiv (Prototyp, `u.view === 'archive'`): Pfeile wandern,
 * `A` holt zurück, `Entf` legt in den Papierkorb, ←/→ klappen zu und auf.
 */
function useArchiveKeys(ws: Workspace | null, ids: string[], menu: Menu): void {
  const { selected } = useStore();

  useEffect(() => {
    if (!ws) return;
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      const inList = !target || target === document.body || !!target.closest('.list');
      if (!inList) return;

      // Die Zeilenfolge füllt sich erst beim Zeichnen – gelesen wird sie beim Tastendruck.
      const list = ids;
      const i = list.indexOf(selected ?? '');
      const go = (id: string | undefined): void => {
        if (!id) return;
        useStore.getState().select(id);
        document.querySelector(`[data-row="${id}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        go(list[Math.min(list.length - 1, i + 1)] ?? list[0]);
        return;
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        go(list[Math.max(0, i - 1)] ?? list[0]);
        return;
      }
      if (!selected || !(ws.milestone(selected) ?? ws.task(selected))) return;

      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const r = document.querySelector(`[data-row="${selected}"]`)?.getBoundingClientRect();
        if (r) menu.openAtPoint(r.left + 40, r.bottom, archMenu(ws, selected), true);
      } else if (e.key === 'a' || e.key === 'A') {
        void restoreItem(ws, selected);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        void purgeItem(ws, selected);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        useStore.getState().setArchOpen(selected, e.key === 'ArrowRight');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, ids, selected, menu]);
}

/* ------------------------------------------------------------ Papierkorb */

/**
 * Sichtbar wie im Prototyp (`trashInView`): Einträge der gewählten Projekte,
 * gelöschte Projekte selbst und alles aus gelöschten Projekten.
 */
export function trashInView(ws: Workspace, entries: TrashEntry[], projectIds: string[]): TrashEntry[] {
  return entries.filter(
    (e) => e.kind === 'project' || !ws.project(e.projectId) || projectIds.includes(e.projectId ?? ''),
  );
}

export function TrashView({ ws }: { ws: Workspace }) {
  const state = useStore();
  const { trash, trashDays, loadTrash, restoreTrash, purgeTrash, scope } = state;

  useEffect(() => {
    if (!trash) void loadTrash();
  }, [trash, loadTrash]);

  if (!trash) return <div className="list" />;
  const list = trashInView(ws, trash, scopeProjectIds(state)).sort((a, b) =>
    b.deletedAt.localeCompare(a.deletedAt),
  );
  if (!list.length) {
    return (
      <div className="list">
        <div className="empty-state">Der Papierkorb ist leer.</div>
      </div>
    );
  }

  return (
    <div className="list">
      {list.map((e) => {
        const ago = Math.floor((Date.now() - new Date(e.deletedAt).getTime()) / 864e5);
        const left = Math.max(0, trashDays - ago);
        const subs = e.kind === 'task' ? e.taskCount - 1 : e.taskCount;
        const where =
          e.kind === 'project'
            ? `Projekt · ${e.milestoneCount} Milestones`
            : e.imageId
              ? 'Bild · beim Leeren sind die Daten endgültig weg'
              : e.where;
        const extra = [
          subs
            ? `${subs} ${e.kind === 'task' ? `Unteraufgabe${subs === 1 ? '' : 'n'}` : `Task${subs === 1 ? '' : 's'}`}`
            : '',
          e.drawingCount ? `${e.drawingCount} Zeichnung${e.drawingCount === 1 ? '' : 'en'}` : '',
        ]
          .filter(Boolean)
          .join(' · ');
        const pre =
          e.kind !== 'project' && scope === 'all'
            ? `${ws.project(e.projectId)?.name || 'gelöschtes Projekt'} · `
            : '';
        return (
          <div key={e.id} className="row trash-row" style={{ '--d': 0 } as React.CSSProperties}>
            {e.kind === 'project' ? (
              <span className="dot" style={{ background: e.color ?? undefined }} />
            ) : e.imageId ? (
              // Bei einem Bild sagt die Vorschau mehr als jedes Symbol.
              <img className="trash-thumb" src={imageUrl(e.imageId, 'klein')} alt="" />
            ) : (
              <span className={`ico ${e.kind === 'milestone' ? 'ms' : ''}`}>
                {e.kind === 'milestone' ? '◆' : '·'}
              </span>
            )}
            <span className="title">{e.title || <em>Ohne Titel</em>}</span>
            <span className="from">
              {pre}
              {where}
              {extra ? ` · inkl. ${extra}` : ''}
            </span>
            <span className={`eta ${left <= 3 ? 'late' : ''}`} title={`Gelöscht am ${fmtDate(e.deletedAt)}`}>
              {ago ? `vor ${ago} ${ago === 1 ? 'Tag' : 'Tagen'}` : 'heute'} · noch {left}{' '}
              {left === 1 ? 'Tag' : 'Tage'}
            </span>
            <button className="btn tiny" onClick={() => void restoreTrash(e.id)}>
              Wiederherstellen
            </button>
            <button
              className="icon-btn"
              title="Endgültig löschen"
              aria-label="Endgültig löschen"
              onClick={() => void purgeTrash(e.id)}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------- Kopfleisten */

/** Über dem Archiv: die Suche und der Hinweis auf die Tasten. */
export function ArchiveBar() {
  const { archiveQuery, setArchiveQuery } = useStore();
  return (
    <div className="toolbar">
      <label className="ctl" htmlFor="f-arch">
        Suche
        <input
          type="search"
          id="f-arch"
          value={archiveQuery}
          placeholder="Titel …"
          autoComplete="off"
          onChange={(e) => setArchiveQuery(e.target.value)}
        />
      </label>
      <span className="spacer" />
      <span className="sum">
        Wiederherstellen mit <kbd>A</kbd> oder Rechtsklick
      </span>
    </div>
  );
}

/** Über dem Papierkorb: Frist und „Papierkorb leeren“ mit Rückfrage. */
export function TrashBar({ ws }: { ws: Workspace }) {
  const state = useStore();
  const { trash, trashDays, trashConfirm, setTrashConfirm, emptyTrash } = state;
  const inView = trash ? trashInView(ws, trash, scopeProjectIds(state)) : [];
  const n = inView.length;
  const bilder = inView.filter((e) => e.imageId).length;
  return (
    <div className="toolbar">
      <b className="trash-title">Papierkorb</b>
      <span className="sum">Einträge werden {trashDays} Tage nach dem Löschen endgültig entfernt.</span>
      <span className="spacer" />
      {n > 0 &&
        (trashConfirm ? (
          <>
            <span className="sum">
              Alle {n} endgültig löschen?
              {/* Bei Bildern fallen die Daten mit – das lässt sich nicht zurücknehmen. */}
              {bilder > 0 && ` ${bilder === 1 ? 'Das Bild ist' : `Die ${bilder} Bilder sind`} danach unwiederbringlich weg.`}
            </span>
            <button className="btn ghost" onClick={() => setTrashConfirm(false)}>
              Abbrechen
            </button>
            <button className="btn danger-solid" onClick={() => void emptyTrash(inView.map((e) => e.id))}>
              Ja, endgültig löschen
            </button>
          </>
        ) : (
          <button className="btn ghost" onClick={() => setTrashConfirm(true)}>
            Papierkorb leeren
          </button>
        ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Teile */

function Caret({ open, has, onToggle }: { open: boolean; has: boolean; onToggle: () => void }) {
  if (!has) return <span className="caret" />;
  return (
    <button
      className="caret"
      aria-label={open ? 'Zuklappen' : 'Aufklappen'}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {open ? CHEVRON_DOWN : CHEVRON_RIGHT}
    </button>
  );
}

/** `markHtml` im Prototyp: nur eine eigene Markierung, keine Standard-Markierung. */
function MarkEmoji({ ws, task }: { ws: Workspace; task: Task }) {
  const mark = ws.mark(task.markId);
  return mark ? (
    <span className="mk-emoji" title={mark.name}>
      {mark.emoji}
    </span>
  ) : null;
}

const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

const fmtD = (iso: string): string =>
  new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
