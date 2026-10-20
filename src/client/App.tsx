import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { api, type Account } from './api.js';
import { connectEvents } from './events.js';
import { DETACHED } from './detached.js';
import { Login } from './Login.js';
import { doneCandidates } from '@shared/outline.js';
import { archiveWorkspace, currentProjectId, scopeProjectIds, TABS, useStore, VIEW_LABEL, type View } from './store.js';
import { dropTarget, useDrag, useDraggedTask, useZone } from './ui/dnd.js';
import { DropPanel } from './ui/DropPanel.js';
import { CategoriesDialog, HelpDialog, MarksDialog, ProfileDialog } from './ui/dialogs.js';
import { categoryHue } from './ui/colors.js';
import { ARCHIVE_ICON, SIDE_ICON, STATUS_LABEL } from './ui/icons.js';
import { tagStyle } from './ui/rows.js';
import { Inspector } from './ui/Inspector.js';
import { NewThing } from './ui/NewThing.js';
import { BulkBar } from './ui/BulkBar.js';
import { BadgeDrawingEditor } from './ui/Drawings.js';
import { MultiDetail } from './ui/MultiDetail.js';
import { Sidebar } from './ui/Sidebar.js';
import { Gallery } from './ui/Gallery.js';
import { Timeline } from './ui/Timeline.js';
import { Releases } from './ui/Releases.js';
import { ArchiveBar, ArchiveView, TrashBar, TrashView } from './ui/archive.js';
import { useGlobalKeys } from './ui/keys.js';
import { Outline } from './ui/views.js';
import { Tisch } from './ui/Tisch.js';
import { HideDoneSwitch } from './ui/hideDone.js';
import { SearchButton, SearchPalette } from './ui/Search.js';
import { QuickAdd } from './ui/QuickAdd.js';
import { useWheelScrollX } from './ui/wheelX.js';

/**
 * Der Inspektor gleitet herein und hinaus (Wunsch des Nutzers). Beim Schließen
 * bleibt er dafür noch einen Augenblick mit dem zuletzt Gezeigten stehen;
 * zwischen zwei Auswahlen bewegt sich nichts.
 */
function useDetailMotion(
  selected: string | null,
  many: boolean,
): { id: string | null; open: boolean; phase: 'enter' | 'leave' | null } {
  const open = !!selected || many;
  const last = useRef<string | null>(null);
  const [prev, setPrev] = useState(open);
  const [phase, setPhase] = useState<'enter' | 'leave' | null>(null);
  // Noch im selben Durchgang umstellen – sonst stünde einen Moment lang gar kein Inspektor da.
  if (prev !== open) {
    setPrev(open);
    setPhase(open ? 'enter' : last.current ? 'leave' : null);
  }
  useEffect(() => {
    if (!phase) return;
    const t = setTimeout(() => setPhase(null), phase === 'enter' ? 260 : 200);
    return () => clearTimeout(t);
  }, [phase]);
  const leaving = phase === 'leave' && !open;
  const id = selected ?? (leaving ? last.current : null);
  // Nur eine einzelne Auswahl gleitet hinaus, eine Mehrfachauswahl nicht.
  if (selected || many) last.current = many ? null : selected;
  return { id, open: open || leaving, phase };
}

/** Das Abhängigkeits-Board bringt React Flow mit – erst laden, wenn es aufgeht. */
const DepGraph = lazy(() => import('./ui/DepGraph.js'));
import { LayoutSwitch } from './ui/Cards.js';

export function App() {
  const [account, setAccount] = useState<Account | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api
      .me()
      .then((r) => setAccount(r.account))
      .catch(() => setAccount(null))
      .finally(() => setReady(true));
  }, []);

  if (!ready) return <main className="boot" />;
  if (!account) return <Login onDone={setAccount} />;
  return <Shell account={account} onAccount={setAccount} onLogout={() => setAccount(null)} />;
}

function Shell({
  account,
  onAccount,
  onLogout,
}: {
  account: Account;
  onAccount: (a: Account) => void;
  onLogout: () => void;
}) {
  const state = useStore();
  const { ws, view, setView, selected, loading, error, toast, load, say, live, scope, multi } = state;
  const projectId = currentProjectId(state);
  // Der Dialog liegt im Speicher, weil ihn auch die Kontextmenüs öffnen.
  const { dialog, setDialog } = state;

  // Ein kurzer Aussetzer beim Verbinden ist normal und soll nichts melden.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    if (live) {
      setOffline(false);
      return;
    }
    const t = setTimeout(() => setOffline(true), 3000);
    return () => clearTimeout(t);
  }, [live]);

  useEffect(() => {
    void load();
  }, [load]);

  // Rückgängig und Escape gelten in jeder Ansicht.
  useGlobalKeys();

  // Änderungen aus anderen Tabs und Geräten kommen über den Strom herein.
  useEffect(() => connectEvents(), []);

  // Kurzmeldungen verschwinden von selbst wieder.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => say(null), 4000);
    return () => clearTimeout(t);
  }, [toast, say]);

  // Kürzel, die überall gelten: Suche, schnell ein Task, Hilfe und Seitenleiste.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null;
      // Zeichen-Editor und Abhängigkeits-Board haben ihre eigenen Tasten.
      const busy = !!el?.closest?.('.draw-modal') || !!useStore.getState().graphOpen;
      // Strg+K öffnet die Suche auch aus einem Textfeld heraus.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K')) {
        if (busy) return;
        e.preventDefault();
        const s = useStore.getState();
        s.setDialog(s.dialog === 'search' ? 'none' : 'search');
        return;
      }
      // Strg+N ebenso – ein neuer Task, egal wo man gerade ist.
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'n' || e.key === 'N')) {
        if (busy) return;
        e.preventDefault();
        const s = useStore.getState();
        s.setDialog(s.dialog === 'quick' ? 'none' : 'quick');
        return;
      }
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/' && !busy) {
        e.preventDefault();
        useStore.getState().setDialog('search');
      }
      if (e.key === '?') {
        const s = useStore.getState();
        s.setDialog(s.dialog === 'help' ? 'none' : 'help');
      }
      if (e.key === '[') {
        e.preventDefault();
        useStore.getState().toggleSide();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Beim Ziehen einer Aufgabe in Plan und Backlog gleitet das Ablage-Panel herein.
  // Ist der Inspektor offen, macht er dem Panel nur mit gedrückter Shift-Taste
  // Platz – seine eigenen Ablagefelder bleiben so erreichbar (Wunsch des Nutzers).
  const dragged = useDraggedTask();
  const shift = useDrag((s) => s.shift);
  // Solange ein neuer Task seinen Namen bekommt, bleibt der Inspektor zu – ein Klick
  // hinein beendete sonst das Anlegen (Wunsch des Nutzers). Enter öffnet ihn dann.
  const naming = state.editingNew && state.editing === selected;
  const detail = useDetailMotion(naming ? null : selected, multi.size > 1);
  const listDrag = dragged && (view === 'plan' || view === 'backlog') ? dragged : null;
  const panel = listDrag && (!detail.open || shift) ? listDrag : null;

  // Als eigenes Fenster heißt es wie der Eintrag, den es zeigt – so findet man es in der Taskleiste.
  const shown = selected ? (ws?.task(selected) ?? ws?.milestone(selected)) : null;
  const shownTitle = shown ? shown.title || 'Ohne Titel' : null;
  useEffect(() => {
    if (DETACHED) document.title = shownTitle ? `${shownTitle} · Tasker` : 'Tasker';
  }, [shownTitle]);

  async function logout() {
    await api.logout().catch(() => undefined);
    onLogout();
  }

  if (loading && !ws) return <main className="boot">Lade …</main>;
  if (error) {
    return (
      <main className="boot">
        <p className="bad">{error}</p>
        <button className="btn" onClick={() => void load()}>
          Nochmal versuchen
        </button>
      </main>
    );
  }
  if (!ws || !projectId) {
    return (
      <main className="boot">
        <p>Noch kein Projekt vorhanden.</p>
        <p className="muted">Leg eines an, dann geht es los.</p>
        <NewThing
          label="+ Projekt"
          placeholder="Name des Projekts"
          startOpen
          onCreate={(name) => useStore.getState().addProject(name)}
        />
      </main>
    );
  }

  const title = scope === 'all' ? 'Alle Projekte' : (ws.project(scope)?.name ?? 'Projekt');

  const toastBox = toast && (
    <div className="toast" role="status">
      <span>{toast}</span>
      {state.toastUndo && (
        <button onClick={() => void state.undo()} title="Rückgängig (Strg+Z)">
          Rückgängig
        </button>
      )}
      {state.toastLink?.toast === toast && (
        <button
          onClick={() => {
            // Wie im Prototyp: die Meldung geht zu, dann geht es dorthin.
            const { run } = state.toastLink!;
            say(null);
            run();
          }}
        >
          {state.toastLink.label}
        </button>
      )}
    </div>
  );

  // Der Inspektor als eigenes Fenster (`detached.ts`): nur er, dazu was aus ihm aufgeht.
  if (DETACHED) {
    return (
      <div className="app detached">
        {selected ? (
          <Inspector ws={(view === 'archive' && archiveWorkspace(state)) || ws} id={selected} />
        ) : (
          <main className="boot muted">Nichts ausgewählt.</main>
        )}
        <BadgeDrawingEditor />
        {state.graphOpen && (
          <Suspense fallback={null}>
            <DepGraph />
          </Suspense>
        )}
        {dialog === 'search' && <SearchPalette ws={ws} onClose={() => setDialog('none')} />}
        {dialog === 'quick' && <QuickAdd ws={ws} onClose={() => setDialog('none')} />}
        {toastBox}
      </div>
    );
  }

  return (
    <>
      <div
        className={[
          'app',
          detail.open ? 'with-detail' : '',
          detail.phase ? `detail-${detail.phase}` : '',
          panel ? 'drag-panel' : '',
          state.sideCollapsed ? 'side-collapsed' : '',
          state.sideOpen ? 'side-open' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <Sidebar
          ws={ws}
          account={account}
          onProfile={() => setDialog('profile')}
          onManageCategories={() => state.openCategories()}
          onManageMarks={() => state.openMarks()}
          onHelp={() => setDialog('help')}
        />

        <main className="main">
          <header className="mhead">
            {/* Die CSS blendet ihn aus, solange die Seitenleiste am Desktop offen ist. */}
            <button
              className="menu-btn"
              onClick={state.toggleSide}
              title="Seitenleiste ausklappen ( [ )"
              aria-label="Seitenleiste ausklappen"
            >
              {SIDE_ICON}
            </button>

            <h1>{title}</h1>

            {offline && (
              <span className="offline" title="Änderungen von anderen Geräten kommen gerade nicht an.">
                offline
              </span>
            )}

            {/* Die Aktionen stehen als Icons rechts in der Titelzeile, die Reiter
                darunter in einer eigenen Zeile – bewusst anders als im Prototyp. */}
            <span className="tab-actions">
              <SearchButton />
              <LayoutSwitch />
              <HideDoneSwitch />
              <ArchiveDone ws={ws} />
            </span>

            <Tabs view={view} onSelect={setView} />
          </header>

          <FilterBar ws={ws} />

          {view === 'tisch' && <Tisch ws={ws} />}
          {(view === 'plan' || view === 'backlog' || view === 'docs') && (
            <Outline ws={ws} view={view} />
          )}
          {view === 'timeline' && <Timeline ws={ws} />}
          {view === 'releases' && <Releases ws={ws} />}
          {view === 'bilder' && <Gallery />}
          {view === 'archive' && <ArchiveView />}
          {view === 'trash' && <TrashView ws={ws} />}
        </main>

        {/* Bei mehreren Ausgewählten zeigt der Inspektor sie alle nebeneinander. */}
        {multi.size > 1 ? (
          <MultiDetail ws={ws} />
        ) : (
          detail.id && (
            // Im Archiv sieht der Inspektor auch das Archivierte.
            <Inspector ws={(view === 'archive' && archiveWorkspace(state)) || ws} id={detail.id} />
          )
        )}
        <DropPanel ws={ws} drag={panel} hint={!!listDrag && !panel} />

        <BulkBar ws={ws} />
        <BadgeDrawingEditor />
        {state.graphOpen && (
          <Suspense fallback={null}>
            <DepGraph />
          </Suspense>
        )}

        {dialog === 'categories' && (
          <CategoriesDialog
            ws={ws}
            projectId={(state.catProject && ws.project(state.catProject)?.id) || projectId}
            onClose={() => setDialog('none')}
          />
        )}
        {dialog === 'marks' && (
          <MarksDialog
            ws={ws}
            projectId={(state.catProject && ws.project(state.catProject)?.id) || projectId}
            onClose={() => setDialog('none')}
          />
        )}
        {dialog === 'profile' && (
          <ProfileDialog
            account={account}
            onAccount={onAccount}
            onLogout={() => void logout()}
            onClose={() => setDialog('none')}
          />
        )}
        {dialog === 'help' && <HelpDialog onClose={() => setDialog('none')} />}
        {dialog === 'search' && <SearchPalette ws={ws} onClose={() => setDialog('none')} />}
        {dialog === 'quick' && <QuickAdd ws={ws} onClose={() => setDialog('none')} />}

        {toastBox}
      </div>
      {/* Mobil: ein Tipp neben die offene Seitenleiste schließt sie. */}
      <div className="scrim" onClick={state.toggleSide} />
    </>
  );
}

/** Was man auf einen Reiter ziehen kann – die Titel aus dem Prototyp. */
const TAB_DROP_TITLE: Partial<Record<View, string>> = {
  backlog: 'Task hierher ziehen = zurück in den Backlog',
  docs: 'Task hierher ziehen = in die Dokumentation',
  archive: 'Hierher ziehen = archivieren',
};

/**
 * Die Reiterleiste. Schmal lässt sie sich seitlich wischen; der aktive Reiter
 * wird dabei in den sichtbaren Bereich geschoben, auch wenn er von außen (Adresse,
 * Tastatur) gewechselt wird.
 */
function Tabs({ view, onSelect }: { view: View; onSelect: (v: View) => void }) {
  const nav = useRef<HTMLElement>(null);
  useWheelScrollX(nav);
  useEffect(() => {
    const el = nav.current;
    const on = el?.querySelector<HTMLElement>('.tab.on');
    if (!el || !on || el.scrollWidth <= el.clientWidth) return;
    const left = on.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft || left + on.offsetWidth > el.scrollLeft + el.clientWidth) {
      el.scrollTo({
        left: left - (el.clientWidth - on.offsetWidth) / 2,
        behavior: 'smooth',
      });
    }
  }, [view]);
  return (
    <nav className="tabs" aria-label="Ansicht" ref={nav}>
      {TABS.map((v) => (
        <Tab key={v} view={v} on={view === v} onClick={() => onSelect(v)} />
      ))}
    </nav>
  );
}

function Tab({ view, on, onClick }: { view: View; on: boolean; onClick: () => void }) {
  const target = { type: 'tab', view } as const;
  const zone = useZone(target);
  const title = TAB_DROP_TITLE[view];
  return (
    <button
      className={`tab ${on ? 'on' : ''} ${zone ? 'dz-on' : ''}`}
      onClick={onClick}
      {...(title ? { title } : {})}
      {...dropTarget(target)}
    >
      {VIEW_LABEL[view]}
    </button>
  );
}

/**
 * „Erledigte archivieren (n)“ neben den Reitern – wie im Prototyp nur in Plan
 * und Backlog, und nur wenn es überhaupt etwas Erledigtes gibt.
 */
function ArchiveDone({ ws }: { ws: import('@shared/workspace.js').Workspace }) {
  const state = useStore();
  const { view, archiveDone } = state;
  if (view !== 'plan' && view !== 'backlog') return null;

  const found = doneCandidates(ws, {
    view,
    projectIds: scopeProjectIds(state),
  });
  const n = found.milestones.length + found.tasks.length;
  if (!n) return null;

  return (
    <button
      className="head-icon"
      title={`Erledigte Milestones und Aufgaben dieser Ansicht archivieren (${n})`}
      aria-label={`Erledigte archivieren (${n})`}
      onClick={() => void archiveDone()}
    >
      {ARCHIVE_ICON}
      <span className="count">{n}</span>
    </button>
  );
}

/** Zeigt die gesetzten Filter als Chips, ein Klick nimmt sie zurück. */
function FilterBar({ ws }: { ws: import('@shared/workspace.js').Workspace }) {
  const { filter, setFilter, settings, setVelocity, view } = useStore();
  const category = ws.category(filter.categoryId ?? null);
  const mark = ws.mark(filter.markId ?? null);
  const any = filter.tag || category || mark || filter.status;

  if (view === 'archive') return <ArchiveBar />;
  if (view === 'trash') return <TrashBar ws={ws} />;
  // Der Tisch zeigt immer den ganzen aktiven Milestone – Filter gelten dort nicht.
  if (view === 'tisch') return null;
  // Die Releases bringen ihre eigene Leiste mit.
  if (view === 'releases') return null;

  // Wie im Prototyp: über dem Zeitplan steht allein das Tempo, sonst die Filter.
  if (view === 'timeline') {
    return (
      <div className="toolbar">
        <label className="ctl" title="Aufgaben pro Woche – Grundlage der Prognose">
          Tempo
          <input
            type="number"
            min={1}
            max={200}
            defaultValue={settings.velocity}
            key={settings.velocity}
            onBlur={(e) => void setVelocity(Number(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
          />
          Aufgaben / Woche
        </label>
      </div>
    );
  }

  if (!any) return null;

  // Das Farbfeld hängt wie in der Seitenleiste an der Stelle in der Projektliste.
  const catIndex = category
    ? ws.categories
        .filter((c) => c.projectId === category.projectId)
        .sort((a, b) => a.order - b.order)
        .indexOf(category)
    : -1;

  return (
    <div className="toolbar">
      <span className="sum">Gefiltert:</span>
      {filter.tag && (
        <button
          className="tag"
          style={tagStyle(filter.tag)}
          onClick={() => setFilter({ tag: null })}
          title="Filter entfernen"
        >
          #{filter.tag} ×
        </button>
      )}
      {category && (
        <button className="tag filter-mark" onClick={() => setFilter({ categoryId: null })} title="Filter entfernen">
          <span className="cat-sw" style={{ '--h': categoryHue(catIndex) } as React.CSSProperties} /> {category.name} ×
        </button>
      )}
      {mark && (
        <button className="tag filter-mark" onClick={() => setFilter({ markId: null })} title="Filter entfernen">
          {mark.emoji} {mark.name} ×
        </button>
      )}
      {filter.status && (
        <button className="tag filter-mark" onClick={() => setFilter({ status: null })} title="Filter entfernen">
          {STATUS_LABEL[filter.status]} ×
        </button>
      )}
    </div>
  );
}
