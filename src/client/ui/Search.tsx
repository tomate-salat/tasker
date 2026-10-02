import { useEffect, useMemo, useRef, useState } from 'react';
import type { Task } from '@shared/model.js';
import { placeLabel } from '@shared/outline.js';
import {
  hitOf,
  isEmptyQuery,
  isLive,
  parseQuery,
  searchWorkspace,
  splitMatches,
  type SearchHit,
} from '@shared/search.js';
import type { Workspace } from '@shared/workspace.js';
import { api, type ArchiveEntry } from '../api.js';
import { useBackClose } from '../back.js';
import { currentProjectId, homeView, useStore, VIEW_LABEL } from '../store.js';
import { ARCHIVE_ICON, DOC_ICON, SEARCH_ICON, StatusIcon } from './icons.js';
import { tagStyle } from './rows.js';

/**
 * Die Suche (Wunsch des Nutzers, über den Prototyp hinaus): eine Palette über
 * der Ansicht, die in allen Reitern zugleich sucht und zum Treffer springt.
 * Ein Filter in der Liste fände nur, was im offenen Reiter liegt.
 *
 * Der aktive Bestand wird im Client durchsucht (`@shared/search`), das Archiv
 * auf Wunsch dazu über den Server – dort nur im Titel.
 */

/** So viele Treffer stehen höchstens da; wer mehr hat, sucht genauer. */
const MAX_HITS = 50;
const MAX_ARCHIVE = 8;
const MAX_RECENT = 6;

/* ------------------------------------------------------- Zuletzt geöffnet */

const RECENT_KEY = 'tasker.recent';

function readRecent(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Was ausgewählt wird, merkt sich die Suche für das leere Feld – pro Gerät.
useStore.subscribe((s, prev) => {
  if (!s.selected || s.selected === prev.selected) return;
  const list = [s.selected, ...readRecent().filter((id) => id !== s.selected)].slice(0, 20);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Privates Fenster oder gesperrter Speicher – nicht weiter schlimm.
  }
});

function recentHits(ws: Workspace, projectId: string | null): SearchHit[] {
  const out: SearchHit[] = [];
  for (const id of readRecent()) {
    const x = ws.milestone(id) ?? ws.task(id);
    if (!x || !isLive(ws, x) || (projectId && x.projectId !== projectId)) continue;
    out.push(hitOf(ws, x));
    if (out.length === MAX_RECENT) break;
  }
  return out;
}

/* ------------------------------------------------------------------ Knopf */

/** Der Knopf in der Titelzeile – in jeder Ansicht. */
export function SearchButton() {
  const setDialog = useStore((s) => s.setDialog);
  return (
    <button
      className="head-icon"
      onClick={() => setDialog('search')}
      title="Suchen ( / )"
      aria-label="Suchen"
    >
      {SEARCH_ICON}
    </button>
  );
}

/* ---------------------------------------------------------------- Palette */

type Row =
  | { type: 'hit'; group: string; hit: SearchHit }
  | { type: 'archive'; group: string; entry: ArchiveEntry };

export function SearchPalette({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const state = useStore();
  const projectId = currentProjectId(state);
  const project = ws.project(projectId);
  const several = ws.projects.length > 1;

  const [text, setText] = useState('');
  const [all, setAll] = useState(state.scope === 'all' || !project);
  const [withArchive, setWithArchive] = useState(false);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const query = useMemo(() => parseQuery(text), [text]);
  const empty = isEmptyQuery(query);
  const hits = useMemo(
    () => (empty ? recentHits(ws, all ? null : projectId) : searchWorkspace(ws, query, { projectId, all })),
    [ws, query, empty, projectId, all],
  );

  // Das Archiv kennt nur Titel: Labels und Nummern gibt es dort nicht zu finden.
  const archiveText = withArchive && !query.tags.length && !query.refOnly ? query.words.join(' ') : '';
  const archiveKey = `${all || !projectId ? '' : projectId}|${archiveText}`;
  const [archive, setArchive] = useState<{ key: string; entries: ArchiveEntry[]; total: number } | null>(null);
  useEffect(() => {
    if (!archiveText) return;
    let stale = false;
    const t = setTimeout(() => {
      api
        .archivePage({ q: archiveText, ...(all || !projectId ? {} : { projectId }) })
        .then((page) => {
          if (!stale) setArchive({ key: archiveKey, entries: page.entries, total: page.total });
        })
        .catch(() => {
          if (!stale) setArchive({ key: archiveKey, entries: [], total: 0 });
        });
    }, 200);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [archiveText, archiveKey, all, projectId]);
  const archived = archiveText && archive?.key === archiveKey ? archive : null;

  const rows: Row[] = [
    ...hits.slice(0, MAX_HITS).map((hit): Row => ({
      type: 'hit',
      group: empty ? 'Zuletzt geöffnet' : several ? (ws.project(hit.projectId)?.name ?? '') : '',
      hit,
    })),
    ...(archived?.entries ?? []).slice(0, MAX_ARCHIVE).map((entry): Row => ({ type: 'archive', group: 'Im Archiv', entry })),
  ];
  const at = Math.min(sel, rows.length - 1);

  useEffect(() => setSel(0), [text, all, withArchive]);
  useEffect(() => {
    list.current?.querySelector('.search-hit.on')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const open = (row: Row | undefined): void => {
    if (!row) return;
    onClose();
    const s = useStore.getState();
    if (row.type === 'hit') {
      s.reveal(row.hit.id);
      return;
    }
    // Das Archiv kommt seitenweise: mit dem Titel als Suche steht der Eintrag sicher da.
    const e = row.entry;
    if (s.scope !== 'all' && s.scope !== e.projectId) s.setScope(e.projectId);
    s.setArchiveQuery(e.title.slice(0, 200));
    s.setView('archive');
    s.select(e.id);
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length) setSel((at + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(rows[at]);
    } else if (e.key === 'Tab') {
      // Der Fokus bleibt im Feld; Tab wechselt stattdessen den Bereich.
      e.preventDefault();
      if (several && project) setAll(!all);
    }
  };

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button
      className={`search-chip ${on ? 'on' : ''}`}
      aria-pressed={on}
      onClick={() => {
        onClick();
        input.current?.focus();
      }}
    >
      {label}
    </button>
  );

  const more = hits.length - MAX_HITS;
  const moreArchived = (archived?.total ?? 0) - Math.min(archived?.entries.length ?? 0, MAX_ARCHIVE);
  let group = '';

  return (
    <div className="search" onClick={onClose}>
      <div className="search-card" role="dialog" aria-label="Suchen" onClick={(e) => e.stopPropagation()}>
        <div className="search-field">
          {SEARCH_ICON}
          <input
            ref={input}
            autoFocus
            value={text}
            placeholder="Titel, Beschreibung, $Nummer oder #Label"
            aria-label="Suchen"
            autoComplete="off"
            spellCheck={false}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls="search-list"
            aria-activedescendant={rows.length ? `search-hit-${at}` : undefined}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
          />
          <kbd>Esc</kbd>
        </div>

        <div className="search-scope">
          {several && project && chip(!all, project.name, () => setAll(false))}
          {several && project && chip(all, 'Alle Projekte', () => setAll(true))}
          <span className="spacer" />
          {chip(withArchive, 'Archiv', () => setWithArchive(!withArchive))}
        </div>

        <div className="search-list" id="search-list" role="listbox" aria-label="Treffer" ref={list}>
          {rows.map((row, i) => {
            const head = row.group !== group ? row.group : '';
            group = row.group;
            const id = row.type === 'hit' ? row.hit.id : row.entry.id;
            return (
              <div key={`${row.type}-${id}`}>
                {head && <div className="search-group">{head}</div>}
                <div
                  id={`search-hit-${i}`}
                  className={`search-hit ${i === at ? 'on' : ''} ${row.type === 'hit' && row.hit.done ? 'done' : ''}`}
                  role="option"
                  aria-selected={i === at}
                  onMouseMove={() => setSel(i)}
                  onClick={() => open(row)}
                >
                  {row.type === 'hit' ? (
                    <HitRow ws={ws} hit={row.hit} words={query.words} />
                  ) : (
                    <ArchiveRow ws={ws} entry={row.entry} words={query.words} withProject={all && several} />
                  )}
                </div>
              </div>
            );
          })}
          {more > 0 && <div className="search-note">{more} weitere Treffer – such genauer.</div>}
          {moreArchived > 0 && (
            <div className="search-note">{moreArchived} weitere im Archiv – der Reiter „Archiv“ zeigt alle.</div>
          )}
          {!rows.length && (
            <div className="search-none">
              {empty ? (
                'Tippen, um in allen Reitern zu suchen.'
              ) : (
                <>
                  Nichts gefunden.
                  {several && project && !all && (
                    <>
                      {' '}
                      <kbd>Tab</kbd> sucht in allen Projekten.
                    </>
                  )}
                  {!withArchive && ' Das Archiv ist nicht dabei.'}
                </>
              )}
            </div>
          )}
        </div>

        <div className="search-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> wählen
          </span>
          <span>
            <kbd>Enter</kbd> hinspringen
          </span>
          {several && project && (
            <span>
              <kbd>Tab</kbd> Bereich wechseln
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Text mit hervorgehobenen Fundstellen. */
function Marked({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {splitMatches(text, words).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}
    </>
  );
}

/** Wo ein Treffer liegt: Reiter, Behälter, Eltern. */
function placeOf(ws: Workspace, hit: SearchHit, hint: Parameters<typeof homeView>[2]): string {
  if (hit.kind === 'milestone') return `Milestone · ${VIEW_LABEL[homeView(ws, hit.id, hint)]}`;
  const t = hit.item as Task;
  return [
    VIEW_LABEL[homeView(ws, t.id, hint)],
    ...(hit.doc ? [] : [placeLabel(ws, t)]),
    ...ws.ancestors(t).map((a) => a.title || 'Ohne Titel'),
  ].join(' › ');
}

function HitRow({ ws, hit, words }: { ws: Workspace; hit: SearchHit; words: string[] }) {
  const view = useStore((s) => s.view);
  const tags = hit.kind === 'task' ? (hit.item as Task).tags : [];
  return (
    <>
      {hit.kind === 'milestone' ? (
        <span className="ico ms">◆</span>
      ) : hit.doc ? (
        <span className="doc-ico">{DOC_ICON}</span>
      ) : (
        <span className={`search-st ${hit.item.status}`}>
          <StatusIcon status={hit.item.status} />
        </span>
      )}
      <span className="search-title">
        <span className="lab">{hit.title ? <Marked text={hit.title} words={words} /> : <em>Ohne Titel</em>}</span>
        {tags.slice(0, 3).map((tag) => (
          <span key={tag} className="tag" style={tagStyle(tag)}>
            #{tag}
          </span>
        ))}
      </span>
      <span className="no">${hit.ref}</span>
      <span className="search-sub">
        {hit.snippet ? <Marked text={hit.snippet} words={words} /> : placeOf(ws, hit, view)}
      </span>
    </>
  );
}

function ArchiveRow({
  ws,
  entry,
  words,
  withProject,
}: {
  ws: Workspace;
  entry: ArchiveEntry;
  words: string[];
  withProject: boolean;
}) {
  const from = entry.parentTitle
    ? `aus „${entry.parentTitle}“`
    : entry.milestoneTitle
      ? `aus ◆ ${entry.milestoneTitle}`
      : entry.kind === 'milestone'
        ? 'Milestone'
        : '';
  const day = new Date(entry.archivedAt).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <>
      {entry.kind === 'milestone' ? <span className="ico ms">◆</span> : <span className="doc-ico">{ARCHIVE_ICON}</span>}
      <span className="search-title">
        <span className="lab">{entry.title ? <Marked text={entry.title} words={words} /> : <em>Ohne Titel</em>}</span>
      </span>
      <span className="no" />
      <span className="search-sub">
        {[withProject ? ws.project(entry.projectId)?.name : '', `archiviert am ${day}`, from].filter(Boolean).join(' · ')}
      </span>
    </>
  );
}
