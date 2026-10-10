/**
 * Der Reiter „Releases“: je Release Version, Titel und Status, seine
 * Milestones, die Kanäle zum Abhaken und das Changelog (siehe PHASE-2.md,
 * „Releases“). Aufgebaut – welcher Milestone in welches Release gehört und was
 * wovon abhängt – wird im Abhängigkeitsgraphen; hier steht die Übersicht.
 *
 * Das Changelog kommt gesondert vom Server: ins Changelog gehört auch
 * Archiviertes, und das fehlt im aktiven Bestand. Geändert wird es deshalb
 * über Schritte (`runSteps`), die auch archivierte Aufgaben erreichen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from '@shared/api.js';
import {
  buildChangelog,
  changelogMarkdown,
  changelogState,
  reorderChangelog,
  type ChangelogData,
  type ChangelogItem,
  type ChangelogTask,
} from '@shared/changelog.js';
import { isArchived, type Release } from '@shared/model.js';
import { milestoneProgressPct } from '@shared/progress.js';
import { RELEASE_STATUS_LABEL, releaseLabel, releaseStatus } from '@shared/release.js';
import type { Workspace } from '@shared/workspace.js';
import { api } from '../api.js';
import { currentProjectId, scopeProjectIds, useStore } from '../store.js';
import { GRAPH_ICON } from './icons.js';
import { useMenu, type MenuItem } from './Menu.js';
import './releases.css';

export function Releases({ ws }: { ws: Workspace }) {
  const state = useStore();
  const { addRelease } = state;
  const projectIds = scopeProjectIds(state);
  const projectId = currentProjectId(state);
  const [showArchived, setShowArchived] = useState(false);
  // Das eben angelegte Release bekommt den Fokus auf die Version.
  const [fresh, setFresh] = useState<string | null>(null);

  // Das jüngste zuerst: daran wird gearbeitet.
  const all = ws.releases.filter((r) => projectIds.includes(r.projectId)).sort((a, b) => b.order - a.order);
  const active = all.filter((r) => !isArchived(r));
  const archived = all.filter(isArchived);
  const many = projectIds.length > 1;

  const add = async (): Promise<void> => {
    if (projectId) setFresh(await addRelease(projectId));
  };

  return (
    <div className="rl">
      <div className="rl-bar">
        <button className="btn" onClick={() => void add()} disabled={!projectId}>
          + Release
        </button>
        {many && projectId && (
          <span className="muted">legt in „{ws.project(projectId)?.name}“ an</span>
        )}
        {archived.length > 0 && (
          <button className="linkish" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Archivierte ausblenden' : `Archivierte anzeigen (${archived.length})`}
          </button>
        )}
      </div>

      {!all.length && (
        <div className="rl-empty">
          <p className="rl-empty-title">Noch kein Release</p>
          <p className="muted">
            Ein Release fasst Milestones zu einer Version zusammen, mit Kanälen zum Abhaken und einem Changelog aus den
            Aufgaben.
          </p>
        </div>
      )}

      {[...active, ...(showArchived ? archived : [])].map((r) => (
        <ReleaseCard key={r.id} ws={ws} release={r} showProject={many} autoFocus={fresh === r.id} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Changelog laden */

/**
 * Lädt, woraus das Changelog entsteht, und hält es aktuell: jede Änderung am
 * Bestand (auch aus einem anderen Tab) holt es neu. Änderungen laufen
 * nacheinander – jede beruht auf den Versionen, die die vorige hinterlassen hat.
 */
function useChangelog(releaseId: string) {
  const boot = useStore((s) => s.boot);
  const say = useStore((s) => s.say);
  const runSteps = useStore((s) => s.runSteps);
  const [data, setData] = useState<ChangelogData | null>(null);
  const latest = useRef<ChangelogData | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let alive = true;
    api
      .changelog(releaseId)
      .then((d) => {
        if (!alive) return;
        latest.current = d;
        setData(d);
      })
      .catch((e: unknown) => {
        if (alive) say(e instanceof Error ? e.message : 'Changelog konnte nicht geladen werden');
      });
    return () => {
      alive = false;
    };
  }, [releaseId, boot, say]);

  /** Reiht eine Änderung ein; `build` bekommt den Stand, auf dem sie beruht. */
  const act = useCallback(
    (build: (d: ChangelogData) => Step[] | Promise<void>) => {
      const run = async (): Promise<void> => {
        const d = (latest.current = await api.changelog(releaseId));
        const steps = await build(d);
        if (steps?.length) await runSteps(steps, null);
      };
      queue.current = queue.current.then(run, run);
    },
    [releaseId, runSteps],
  );

  return { data, act };
}

const patchTask = (d: ChangelogData, id: string, changes: Record<string, unknown>): Step[] => {
  const t = d.tasks.find((x) => x.id === id);
  return t ? [{ op: 'patch', kind: 'task', id, version: t.version, changes }] : [];
};

const patchHeading = (id: string, changes: Record<string, unknown>): Step[] => {
  const h = useStore.getState().ws?.headings.find((x) => x.id === id);
  return h ? [{ op: 'patch', kind: 'heading', id, version: h.version, changes }] : [];
};

/* ------------------------------------------------------------------- Karte */

function ReleaseCard({
  ws,
  release,
  showProject,
  autoFocus,
}: {
  ws: Workspace;
  release: Release;
  showProject: boolean;
  autoFocus: boolean;
}) {
  const { patch, remove, addStage, openGraph, select } = useStore();
  const menu = useMenu();
  const { data, act } = useChangelog(release.id);
  const stages = ws.releaseStages(release.id);
  const status = releaseStatus(ws, release, data?.milestones.filter((m) => m.archived).length ?? 0);
  const gone = isArchived(release);
  const [stage, setStage] = useState('');

  const addFresh = (): void => {
    const name = stage.trim();
    if (!name) return;
    setStage('');
    void addStage(release.id, name);
  };

  const more = (): MenuItem[] => [
    { label: 'Graph anzeigen', onSelect: () => openGraph({ projectId: release.projectId, focusId: release.id }) },
    {
      label: gone ? 'Aus dem Archiv holen' : 'Archivieren',
      onSelect: () => void patch('release', release.id, { archivedAt: gone ? null : new Date().toISOString() }),
    },
    { sep: true },
    { label: 'Release löschen', danger: true, onSelect: () => void remove('release', release.id) },
  ];

  // Was sich noch zuordnen lässt: die aktiven Milestones des Projekts, die nicht schon hier sind.
  const candidates = (): MenuItem[] => {
    const list = ws.milestones
      .filter((m) => m.projectId === release.projectId && !isArchived(m) && m.releaseId !== release.id)
      .sort((a, b) => Number(b.planned) - Number(a.planned) || a.qorder - b.qorder);
    if (!list.length) return [{ head: 'Kein weiterer Milestone im Projekt' }];
    return list.map((m) => {
      const other = ws.release(m.releaseId);
      return {
        label: `◆ ${m.title || 'Ohne Titel'}${other ? ` · bisher in ${other.name || other.title || 'anderem Release'}` : ''}`,
        onSelect: () => void patch('milestone', m.id, { releaseId: release.id }),
      };
    });
  };

  return (
    <section className={`rl-card ${gone ? 'gone' : ''}`} data-status={status}>
      <header className="rl-head">
        <span className="ico rel" aria-hidden="true">
          ✦
        </span>
        <CommitInput
          className="rl-version"
          value={release.name}
          placeholder="Version"
          label="Version"
          autoFocus={autoFocus}
          onCommit={(name) => void patch('release', release.id, { name })}
        />
        <CommitInput
          className="rl-title"
          value={release.title}
          placeholder="Titel"
          label="Titel"
          onCommit={(title) => void patch('release', release.id, { title })}
        />
        {showProject && <span className="chip">{ws.project(release.projectId)?.name}</span>}
        <span className={`rl-status s-${status}`}>
          {gone ? 'Archiviert · ' : ''}
          {RELEASE_STATUS_LABEL[status]}
        </span>
        <button
          className="icon-btn"
          title="Graph anzeigen – hier wird das Release aufgebaut"
          aria-label="Graph anzeigen"
          onClick={() => openGraph({ projectId: release.projectId, focusId: release.id })}
        >
          {GRAPH_ICON}
        </button>
        <button
          className="icon-btn"
          title="Mehr"
          aria-label="Mehr"
          aria-haspopup="menu"
          onClick={(e) => menu.openAt(e.currentTarget, more(), e.detail === 0)}
        >
          ⋯
        </button>
      </header>

      <div className="rl-stages">
        <div className="rl-lane">
          <span className="rl-lbl">Milestones</span>
          {(data?.milestones ?? []).map((m) => {
            const live = ws.milestone(m.id);
            const done = m.archived || m.status === 'done' || (live ? milestoneProgressPct(ws, live) === 100 : false);
            return (
              <span className={`rl-ms ${done ? 'done' : ''} ${m.status === 'progress' ? 'now' : ''}`} key={m.id}>
                <button
                  className="rl-ms-t"
                  disabled={!live}
                  title={live ? 'Details öffnen' : 'Liegt im Archiv'}
                  onClick={() => select(m.id)}
                >
                  <span className="ico ms">◆</span> {m.title || 'Ohne Titel'}
                </button>
                <span className="rl-ms-sub">
                  {m.archived ? 'archiviert' : live ? `${milestoneProgressPct(ws, live)} %` : ''}
                </span>
                {live && (
                  <button
                    className="rl-x"
                    title="Aus dem Release nehmen"
                    aria-label={`${m.title} aus dem Release nehmen`}
                    onClick={() => void patch('milestone', m.id, { releaseId: null })}
                  >
                    ✕
                  </button>
                )}
              </span>
            );
          })}
          <button
            className="prop empty"
            aria-haspopup="menu"
            title="Milestone zuordnen"
            onClick={(e) => menu.openAt(e.currentTarget, candidates(), e.detail === 0)}
          >
            + Milestone
          </button>
        </div>

        <div className="rl-lane">
          <span className="rl-lbl">Veröffentlichung</span>
          {stages.map((s) => (
            <span className={`rl-stage ${s.doneAt ? 'done' : ''}`} key={s.id}>
              <input
                type="checkbox"
                checked={!!s.doneAt}
                aria-label={`${s.name} veröffentlicht`}
                title={s.doneAt ? `Veröffentlicht am ${new Date(s.doneAt).toLocaleDateString('de-DE')}` : 'Als veröffentlicht abhaken'}
                onChange={() => void patch('stage', s.id, { doneAt: s.doneAt ? null : new Date().toISOString() })}
              />
              <CommitInput
                className="rl-stage-name"
                value={s.name}
                placeholder="Kanal"
                label="Kanal"
                onCommit={(name) => void patch('stage', s.id, { name })}
              />
              <button
                className="rl-x"
                title="Kanal entfernen"
                aria-label={`Kanal ${s.name} entfernen`}
                onClick={() => void remove('stage', s.id, 'Kanal entfernt')}
              >
                ✕
              </button>
            </span>
          ))}
          <input
            className="rl-add"
            value={stage}
            placeholder="+ Kanal, z. B. itch-Seite"
            aria-label="Neuer Kanal"
            onChange={(e) => setStage(e.target.value)}
            onBlur={addFresh}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addFresh();
            }}
          />
        </div>
      </div>

      <ChangelogBlock ws={ws} release={release} data={data} act={act} open={status !== 'released' && !gone} />
      {menu.node}
    </section>
  );
}

/* --------------------------------------------------------------- Changelog */

function ChangelogBlock({
  ws,
  release,
  data,
  act,
  open,
}: {
  ws: Workspace;
  release: Release;
  data: ChangelogData | null;
  act: ReturnType<typeof useChangelog>['act'];
  /** Ein veröffentlichtes Release zeigt sein Changelog erst auf Wunsch. */
  open: boolean;
}) {
  const { patch, say, select, load } = useStore();
  const headings = useMemo(() => ws.headings.filter((h) => h.releaseId === release.id), [ws, release.id]);
  const log = useMemo(() => (data ? buildChangelog(data.tasks, headings) : null), [data, headings]);
  const skipped = useMemo(() => data?.tasks.filter((t) => changelogState(t) === 'none') ?? [], [data]);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; before: boolean } | null>(null);

  if (!log) return <p className="rl-note muted">Changelog wird geladen …</p>;

  const items = log.items;
  const entries = items.filter((x) => x.kind === 'entry');
  const pending = entries.filter((x) => x.kind === 'entry' && !x.done).length;

  /** Setzt `id` vor `beforeId` (oder ans Ende) – gerechnet wird auf dem Stand zur Zeit der Ausführung. */
  const move = (id: string, beforeId: string | null): void =>
    act((d) => {
      const now = useStore.getState().ws;
      if (!now) return [];
      const current = buildChangelog(d.tasks, now.headings.filter((h) => h.releaseId === release.id)).items;
      return reorderChangelog(current, id, beforeId).flatMap(({ item, order }) =>
        item.kind === 'entry' ? patchTask(d, item.id, { changelogOrder: order }) : patchHeading(item.id, { order }),
      );
    });

  const step = (id: string, by: -1 | 1): void => {
    const i = items.findIndex((x) => x.id === id);
    const before = by < 0 ? items[i - 1] : items[i + 2];
    if (i < 0 || (by < 0 && i === 0) || (by > 0 && i === items.length - 1)) return;
    move(id, before?.id ?? null);
  };

  const drop = (target: ChangelogItem, before: boolean): void => {
    const id = drag;
    setDrag(null);
    setOver(null);
    if (!id || id === target.id) return;
    const next = items[items.findIndex((x) => x.id === target.id) + 1];
    move(id, before ? target.id : (next?.id ?? null));
  };

  const addHeading = (): void =>
    act(async () => {
      await api.create('heading', { releaseId: release.id, title: '' });
      await load();
    });

  const copy = (): void => {
    void navigator.clipboard.writeText(changelogMarkdown(release, items)).then(
      () => say('Changelog als Markdown kopiert'),
      () => say('Kopieren fehlgeschlagen'),
    );
  };

  const taskLink = (t: ChangelogTask) => (
    <button
      className="rl-ref"
      disabled={!ws.task(t.id)}
      title={ws.task(t.id) ? `${t.title || 'Ohne Titel'} – Details öffnen` : `${t.title || 'Ohne Titel'} – liegt im Archiv`}
      onClick={() => select(t.id)}
    >
      ${t.ref}
    </button>
  );

  return (
    <details className="rl-log" open={open}>
      <summary>
        <span className="rl-log-t">Changelog</span>
        <span className="muted">
          {entries.length - pending} {entries.length - pending === 1 ? 'Eintrag' : 'Einträge'}
          {pending ? ` · ${pending} noch offen` : ''}
        </span>
        {log.undecided.length > 0 && <span className="rl-warn">{log.undecided.length} ohne Entscheidung</span>}
      </summary>

      <CommitArea
        value={release.desc}
        placeholder="Einleitung – steht im Changelog über den Einträgen"
        label="Einleitung"
        onCommit={(desc) => void patch('release', release.id, { desc })}
      />

      {!items.length && (
        <p className="rl-note muted">
          Noch keine Einträge. Die Zeile fürs Changelog steht am Task – im Inspektor oder gleich hier unten.
        </p>
      )}

      <ul className="rl-items" onDragLeave={(e) => e.currentTarget === e.target && setOver(null)}>
        {items.map((item) => (
          <li
            key={item.id}
            className={[
              'rl-item',
              item.kind,
              item.kind === 'entry' && !item.done ? 'pending' : '',
              drag === item.id ? 'dragging' : '',
              over?.id === item.id ? (over.before ? 'drop-before' : 'drop-after') : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const before = e.clientY < box.top + box.height / 2;
              if (over?.id !== item.id || over.before !== before) setOver({ id: item.id, before });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(item, over?.id === item.id ? over.before : true);
            }}
          >
            <span
              className="rl-grip"
              draggable
              role="button"
              tabIndex={0}
              aria-label="Verschieben – ziehen oder Alt+Pfeiltasten"
              title="Ziehen zum Sortieren · Alt+↑/↓"
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'move';
                setDrag(item.id);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
              onKeyDown={(e) => {
                if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
                e.preventDefault();
                step(item.id, e.key === 'ArrowUp' ? -1 : 1);
              }}
            >
              ⠿
            </span>
            {item.kind === 'heading' ? (
              <>
                <CommitInput
                  className="rl-heading"
                  value={item.heading.title}
                  placeholder="Überschrift"
                  label="Überschrift"
                  autoFocus={!item.heading.title}
                  onCommit={(title) => act(() => patchHeading(item.id, { title }))}
                />
                <button
                  className="rl-x"
                  title="Überschrift entfernen"
                  aria-label="Überschrift entfernen"
                  onClick={() => act(() => [{ op: 'purge', kind: 'heading', id: item.id }])}
                >
                  ✕
                </button>
              </>
            ) : (
              <>
                <CommitInput
                  className="rl-entry"
                  value={item.task.changelog}
                  placeholder="Zeile fürs Changelog"
                  label={`Changelog-Zeile zu ${item.task.title}`}
                  onCommit={(changelog) => act((d) => patchTask(d, item.id, { changelog }))}
                />
                {!item.done && (
                  <span className="rl-pill" title="Die Aufgabe ist noch nicht erledigt – die Zeile fehlt im kopierten Changelog">
                    noch offen
                  </span>
                )}
                {taskLink(item.task)}
                <button
                  className="rl-x"
                  title="Aus dem Changelog nehmen – als technisch markieren"
                  aria-label="Aus dem Changelog nehmen"
                  onClick={() => act((d) => patchTask(d, item.id, { changelogSkip: true }))}
                >
                  ✕
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="rl-log-actions">
        <button className="btn" onClick={addHeading}>
          + Überschrift
        </button>
        <button className="btn" onClick={copy} disabled={!entries.length} title="Nur erledigte Einträge, mit Einleitung">
          Als Markdown kopieren
        </button>
      </div>

      {log.undecided.length > 0 && (
        <div className="rl-undecided">
          <p className="rl-sub">Erledigt, noch ohne Entscheidung</p>
          {log.undecided.map((t) => (
            <Undecided
              key={t.id}
              task={t}
              link={taskLink(t)}
              onEntry={(changelog) => act((d) => patchTask(d, t.id, { changelog, changelogSkip: false }))}
              onSkip={() => act((d) => patchTask(d, t.id, { changelogSkip: true }))}
            />
          ))}
        </div>
      )}

      {skipped.length > 0 && (
        <details className="rl-skipped">
          <summary className="rl-sub">Ohne Eintrag ({skipped.length})</summary>
          {skipped.map((t) => (
            <div className="rl-row" key={t.id}>
              {taskLink(t)}
              <span className="rl-row-t">{t.title || 'Ohne Titel'}</span>
              <button
                className="linkish"
                title="Die Entscheidung zurücknehmen"
                onClick={() => act((d) => patchTask(d, t.id, { changelogSkip: false }))}
              >
                doch entscheiden
              </button>
            </div>
          ))}
        </details>
      )}
    </details>
  );
}

/** Eine erledigte Aufgabe ohne Entscheidung: eine Zeile schreiben oder „Technisch“. */
function Undecided({
  task,
  link,
  onEntry,
  onSkip,
}: {
  task: ChangelogTask;
  link: React.ReactNode;
  onEntry: (text: string) => void;
  onSkip: () => void;
}) {
  const [text, setText] = useState('');
  const commit = (): void => {
    if (text.trim()) onEntry(text.trim());
  };
  return (
    <div className="rl-row">
      {link}
      <span className="rl-row-t" title={task.title}>
        {task.title || 'Ohne Titel'}
      </span>
      <input
        className="rl-row-in"
        value={text}
        placeholder="Zeile fürs Changelog"
        aria-label={`Changelog-Zeile zu ${task.title}`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      <button className="prop empty" title="Kein Eintrag – etwa weil zu technisch" onClick={onSkip}>
        Technisch
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Felder */

/** Ein Feld, das beim Verlassen und mit Enter übernimmt; Esc verwirft. */
function CommitInput({
  value,
  placeholder,
  label,
  className,
  autoFocus,
  onCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  className?: string;
  autoFocus?: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      className={`rl-in ${className ?? ''}`}
      value={text}
      placeholder={placeholder}
      aria-label={label}
      autoFocus={autoFocus}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text.trim() !== value) onCommit(text.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setText(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

function CommitArea({
  value,
  placeholder,
  label,
  onCommit,
}: {
  value: string;
  placeholder: string;
  label: string;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <textarea
      className="rl-intro"
      value={text}
      rows={Math.min(8, Math.max(2, text.split('\n').length))}
      placeholder={placeholder}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== value) onCommit(text);
      }}
    />
  );
}
