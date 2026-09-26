import { useEffect, useRef } from 'react';
import { effectiveCategory, effectiveTags } from '@shared/inherit.js';
import { isDone, type Project, type Task } from '@shared/model.js';
import { categoriesOf, categoryColorIndex, isLooseRoot, marksOf } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import type { Account } from '../api.js';
import { archiveWorkspace, currentProjectId, useStore } from '../store.js';
import { categoryHue, tagHue } from './colors.js';
import { dragSource, dropTarget, useZone } from './dnd.js';
import { SIDE_ICON, THEME_ICON, THEME_LABEL } from './icons.js';
import { useMenu } from './Menu.js';
import { projectMenu } from './rowMenu.js';

/**
 * Die Seitenleiste, Aufbau und Verhalten wie im Prototyp: Projekte mit „Alle
 * Projekte“, darunter Kategorien, Markierungen und Labels als Filter, unten
 * Konto und Fußzeile.
 *
 * Die Zahlen beziehen sich auf die aktuelle Ansicht, nicht auf den gesamten
 * Bestand – sonst sagen sie im Backlog etwas anderes aus als im Plan.
 */
export function Sidebar({
  ws,
  account,
  onProfile,
  onManageCategories,
  onManageMarks,
  onHelp,
}: {
  ws: Workspace;
  account: Account;
  onProfile: () => void;
  onManageCategories: () => void;
  onManageMarks: () => void;
  onHelp: () => void;
}) {
  const state = useStore();
  const menu = useMenu();
  const { scope, setScope, filter, setFilter, view, setView, settings, cycleTheme, toggleSide } =
    state;
  const projectId = currentProjectId(state);

  const inScope = (t: Task): boolean => scope === 'all' || t.projectId === scope;
  // Im Archiv zählt, was dort geladen ist – dafür braucht es die archivierten Aufgaben.
  const vws = (view === 'archive' && archiveWorkspace(state)) || ws;
  const inView = (t: Task): boolean => {
    if (!inScope(t)) return false;
    // Wie im Prototyp zählt jede Ansicht, was auf ihr steht: das Archiv das
    // Archivierte, die Doku ihre Seiten.
    if (view === 'archive') return !vws.isActive(t);
    if (view === 'docs') return ws.isActive(t) && ws.isDoc(t);
    if (!ws.isActive(t) || ws.isDoc(t)) return false;
    const ms = ws.milestoneOf(t);
    const inPlan = !!ms?.planned;
    // Der Zeitplan zeigt nur geplante Milestones, zählt also wie der Plan.
    if (view === 'plan' || view === 'timeline') return inPlan;
    if (inPlan) return false;
    // Vorbereitete Milestones stehen in Backlog und „Ready“, lose Wurzeln in einem von beiden.
    if (ms) return true;
    const root = ws.root(t);
    const ready = isLooseRoot(root) && root.ready;
    return view === 'ready' ? ready : view === 'backlog' ? !ready : true;
  };

  const viewTasks = vws.tasks.filter(inView);
  const countBy = (f: (t: Task) => boolean): number => viewTasks.filter(f).length;
  const openOf = (pid: string): number =>
    ws.tasks.filter(
      (t) => t.projectId === pid && !isDone(t) && !ws.kids(t.id).length && ws.isActive(t) && !ws.isDoc(t),
    ).length;

  // Labels: alle des Bereichs, sortiert nach Häufigkeit in dieser Ansicht.
  const tagCount = new Map<string, number>();
  for (const t of ws.tasks) {
    if (inScope(t) && ws.isActive(t)) for (const g of t.tags) if (!tagCount.has(g)) tagCount.set(g, 0);
  }
  for (const t of viewTasks) {
    for (const g of effectiveTags(vws, t).tags) tagCount.set(g, (tagCount.get(g) ?? 0) + 1);
  }
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const categories = projectId
    ? categoriesOf(ws, projectId)
    : [];
  const marks = projectId ? marksOf(ws, projectId) : [];

  const trashCount = state.trash?.length ?? 0;

  return (
    <nav className="side">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        Tasker
        <div className="brand-actions">
          <button
            className="icon-btn"
            onClick={() => void cycleTheme()}
            title={`Darstellung: ${THEME_LABEL[settings.theme]} – klicken zum Wechseln`}
            aria-label="Darstellung wechseln"
          >
            {THEME_ICON[settings.theme]}
          </button>
          <button
            className="icon-btn side-close"
            onClick={toggleSide}
            title="Seitenleiste einklappen ( [ )"
            aria-label="Seitenleiste einklappen"
          >
            {SIDE_ICON}
          </button>
        </div>
      </div>

      <div className="nav" aria-label="Projekte">
        <div className="nav-h">Projekte</div>
        <button
          className={`nav-i ${scope === 'all' ? 'on' : ''}`}
          onClick={() => setScope('all')}
          title="Offene Aufgaben"
        >
          <span className="dot all" />
          <span>Alle Projekte</span>
          <span className="n">{ws.projects.reduce((n, p) => n + openOf(p.id), 0)}</span>
        </button>

        {ws.projects.map((p) =>
          state.editProject === p.id ? (
            <div className="nav-row" key={p.id}>
              <ProjectNameEdit id={p.id} name={p.name} />
            </div>
          ) : (
            <div className="nav-row" key={p.id}>
              <ProjectItem
                project={p}
                on={scope === p.id}
                open={openOf(p.id)}
                onClick={() => setScope(p.id)}
                onDoubleClick={() => state.setEditProject(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  menu.openAtPoint(e.clientX, e.clientY, projectMenu(ws, p));
                }}
              />
              <button
                className="nav-more"
                title="Projekt bearbeiten"
                aria-label={`Projekt ${p.name} bearbeiten`}
                aria-haspopup="menu"
                onClick={(e) => menu.openAt(e.currentTarget, () => projectMenu(ws, p), e.detail === 0)}
              >
                ⋯
              </button>
            </div>
          ),
        )}

        {/* Wie im Prototyp gleich ein Feld: Enter legt an, leer passiert nichts. */}
        <input
          className="new-proj"
          placeholder="+ Neues Projekt"
          aria-label="Neues Projekt anlegen"
          autoComplete="off"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const input = e.currentTarget;
            const name = input.value.trim();
            if (!name) return;
            input.value = '';
            void state.addProject(name);
          }}
        />
      </div>

      {projectId && scope !== 'all' && (
        <div className="nav" aria-label="Kategorien">
          <div className="nav-h nav-h-row">
            Kategorien
            <button className="linkish" onClick={onManageCategories}>
              Verwalten
            </button>
          </div>
          {categories.map((c) => {
            const n = countBy((t) => effectiveCategory(vws, t)?.category.id === c.id);
            return (
              <button
                key={c.id}
                className={`nav-i ${filter.categoryId === c.id ? 'on' : ''}`}
                onClick={() => setFilter({ categoryId: filter.categoryId === c.id ? null : c.id })}
              >
                <span className="hash mk">
                  <span
                    className="cat-sw"
                    style={{ '--h': categoryHue(categoryColorIndex(ws, c)) } as React.CSSProperties}
                  />
                </span>
                <span>{c.name}</span>
                <span className={n ? 'n' : 'n zero'}>{n}</span>
              </button>
            );
          })}
          {!categories.length && (
            <button className="nav-i muted" onClick={onManageCategories}>
              + Kategorie anlegen
            </button>
          )}
        </div>
      )}

      {projectId && scope !== 'all' && (
        <div className="nav" aria-label="Markierungen">
          <div className="nav-h nav-h-row">
            Markierungen
            <button className="linkish" onClick={onManageMarks}>
              Verwalten
            </button>
          </div>
          {marks.map((k) => {
            const n = countBy((t) => t.markId === k.id);
            return (
              <button
                key={k.id}
                className={`nav-i ${filter.markId === k.id ? 'on' : ''}`}
                onClick={() => setFilter({ markId: filter.markId === k.id ? null : k.id })}
              >
                <span className="hash mk">{k.emoji}</span>
                <span>{k.name}</span>
                <span className={n ? 'n' : 'n zero'}>{n}</span>
              </button>
            );
          })}
          {!marks.length && (
            <button className="nav-i muted" onClick={onManageMarks}>
              + Markierung anlegen
            </button>
          )}
        </div>
      )}

      <div className="nav" aria-label="Labels">
        <div className="nav-h">Labels</div>
        {tags.map(([g, n]) => (
          <button
            key={g}
            className={`nav-i ${filter.tag === g ? 'on' : ''}`}
            onClick={() => setFilter({ tag: filter.tag === g ? null : g })}
          >
            <span className="hash" style={{ color: `hsl(${tagHue(g)} 45% 50%)` }}>
              #
            </span>
            <span>{g}</span>
            <span className={n ? 'n' : 'n zero'}>{n}</span>
          </button>
        ))}
        {!tags.length && <p className="side-hint">Noch keine Labels.</p>}
      </div>

      <button className="side-user" onClick={onProfile} title="Profil und Einstellungen">
        <span className="avatar">{account.avatar || '🙂'}</span>
        <span className="su-name">{account.name || 'Konto'}</span>
      </button>

      <div className="side-foot">
        <button onClick={onHelp}>
          Tastenkürzel <kbd>?</kbd>
        </button>
        <button onClick={() => setView('trash')}>
          Papierkorb{trashCount ? ` (${trashCount})` : ''}
        </button>
      </div>
      {menu.node}
    </nav>
  );
}

/**
 * Ein Projekt in der Seitenleiste. Wie im Prototyp zieht man es zum Sortieren,
 * und eine hierher gezogene Aufgabe landet im Backlog dieses Projekts.
 */
function ProjectItem({
  project,
  on,
  open,
  onClick,
  onDoubleClick,
  onContextMenu,
}: {
  project: Project;
  on: boolean;
  open: number;
  onClick: () => void;
  onDoubleClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const target = { type: 'project', project } as const;
  const zone = useZone(target);
  return (
    <button
      className={`nav-i ${on ? 'on' : ''} ${zone ? (zone === 'into' ? 'dz-on' : `dz-${zone}`) : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      title="Offene Aufgaben · ziehen zum Sortieren · Task hierher ziehen = in diesen Backlog"
      {...dragSource('project', project.id)}
      {...dropTarget(target)}
    >
      <span className="dot" style={{ background: project.color }} />
      <span>{project.name}</span>
      <span className="n">{open}</span>
    </button>
  );
}

/** Der Projektname als Feld in der Zeile: Enter übernimmt, Escape bricht ab. */
function ProjectNameEdit({ id, name }: { id: string; name: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (value: string, cancel = false): void => {
    if (done.current) return;
    done.current = true;
    const store = useStore.getState();
    if (cancel) store.setEditProject(null);
    else void store.renameProject(id, value);
  };

  return (
    <input
      ref={ref}
      className="new-proj proj-edit"
      defaultValue={name}
      aria-label="Projektname"
      autoComplete="off"
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish('', true);
        }
      }}
    />
  );
}
