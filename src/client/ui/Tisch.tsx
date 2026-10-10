import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { Step } from '@shared/api.js';
import { blockers, isBlocked } from '@shared/blocking.js';
import { isArchived, isDone, type Milestone, type Status, type Task } from '@shared/model.js';
import { plannedMilestones } from '@shared/outline.js';
import { milestoneProgressPct, milestoneStats } from '@shared/progress.js';
import { schedule } from '@shared/schedule.js';
import {
  activeMilestones,
  doneRefusal,
  doneShelf,
  type DoneShelf,
  playRefusal,
  stackReady,
  tischLayout,
} from '@shared/tisch.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { CardFace } from './Cards.js';
import { draggedCard, holdGhost, startTilt } from './cardTilt.js';
import { LOCK_ICON } from './icons.js';
import { dragSource, useDrag, useDragging } from './dnd.js';
import { useMenu, type Menu } from './Menu.js';
import { useWheelScrollX } from './wheelX.js';
import { rowMenu } from './rowMenu.js';
import { burst, float, glide, land, pop, reduced, refuse, shake, thump, unlock, UNLOCK_HOLD } from './tischFx.js';
import './tisch.css';

/**
 * Der Tisch (Wunsch des Nutzers): die aktiven Milestones des Projekts als
 * Kartenspiel, von oben nach unten – was noch kommt, oben, was man gerade in der
 * Hand hat, unten. Sind mehrere aktiv, liegen ihre Karten gemeinsam da; jede
 * trägt dann die Farbe und den Namen ihres Milestones (`MsTag`), und im Kopf
 * lässt sich der Tisch auf einen einschränken.
 *
 * - **Gesperrt:** Karten mit offenen Voraussetzungen, angekettet.
 * - **Offen:** die große Fläche in der Mitte, dazu alle Stapel.
 * - **Im Spiel:** In Progress; sieben Plätze als Richtwert, begrenzt wird nicht.
 * - **Erledigt-Stapel** rechts daneben. Ein Klick deckt ihn auf: die Ablage
 *   zeigt dann je Woche, was erledigt wurde (`Shelf`).
 *
 * Ziehen zwischen den Zonen setzt den Status. Zwischen zwei Karten abgelegt wird
 * sortiert (Wunsch des Nutzers): in „Offen“ ist das die Reihenfolge im Plan, „Im
 * Spiel“ hat seine eigene (`playOrder`). Ein Task mit Unteraufgaben ist ein
 * Stapel und fächert sich per Klick in eine Schublade auf. Welche Karte wohin
 * gehört, steht in `@shared/tisch.ts`; die Animationen in `tischFx.ts`.
 */

type Where = 'locked' | 'open' | 'play' | 'pile' | 'drawer';
type DropZone = 'open' | 'play' | 'pile';

const STATUS_OF: Record<DropZone, Status> = { open: 'open', play: 'progress', pile: 'done' };

/** Plätze in „Im Spiel“, die leer angezeigt werden – nur ein Richtwert wie bei Codecks. */
const SLOTS = 7;

const OPEN_KEY = 'tasker.tischOpen';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

function writeOpen(open: Record<string, boolean>): void {
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(open));
  } catch {
    // Privates Fenster – dann eben nur für diese Sitzung.
  }
}

/**
 * Die markierte Karte (Wunsch des Nutzers): ein Klick markiert nur, erst ein
 * Doppelklick öffnet den Inspektor. Pfeiltasten wandern, die Leertaste schaltet
 * den Status der markierten Karte weiter. Bewusst nicht `selected` – das ist
 * in der ganzen App der offene Inspektor.
 */
const useFocus = create<{ id: string | null }>(() => ({ id: null }));

/* ------------------------------------------------------ Herkunft der Karten */

/** Farbtöne für die Milestones auf dem Tisch, in der Reihenfolge des Plans. */
const MS_HUES = [162, 265, 28, 330, 205, 95];
const msHue = (i: number): number => MS_HUES[i % MS_HUES.length] as number;

/**
 * Je Milestone auf dem Tisch seine Farbe – nur gefüllt, wenn mehrere aktiv
 * sind. Bei einem einzigen sieht der Tisch aus wie immer.
 */
const MsCtx = createContext<Map<string, number>>(new Map());

/** Der Streifen an einer Karte: von welchem Milestone sie kommt. */
function MsTag({ ws, task }: { ws: Workspace; task: Task }) {
  const hues = useContext(MsCtx);
  const m = hues.size ? ws.milestoneOf(task) : null;
  const hue = m ? hues.get(m.id) : undefined;
  if (!m || hue === undefined) return null;
  return (
    <span className="tms" style={{ '--ms-h': hue } as React.CSSProperties} title={`Milestone: ${m.title || 'Ohne Titel'}`}>
      {m.title || 'Ohne Titel'}
    </span>
  );
}

/* ------------------------------------------------------ Laufendes Ablegen */

/**
 * Zwischen Loslassen und neuem Stand: die Kopie der Karte bleibt liegen, wo sie
 * losgelassen wurde, die echte Karte ist so lange unsichtbar. Kommt der neue
 * Stand, übernimmt die Karte in ihrer neuen Zone von der Kopie (`land`).
 */
type Pending = {
  ids: string[];
  to: DropZone;
  /** Ein ganzer Stapel auf den Erledigt-Stapel – der größere Moment. */
  big: boolean;
  ghost: { el: HTMLElement; release: () => void } | null;
  hidden: HTMLElement[];
  home: DOMRect | null;
  /**
   * Sortiert: der Stand beim Ablegen. Bleibt die Karte in ihrer Zone, ist sie
   * weiter dasselbe Element – gelandet wird deshalb erst mit einem neuen Stand.
   */
  since: Workspace | null;
};
let pending: Pending | null = null;

const cardEls = (root: ParentNode, id: string): HTMLElement[] => [
  ...root.querySelectorAll<HTMLElement>(`[data-tcell="${CSS.escape(id)}"]`),
];

function show(els: HTMLElement[]): void {
  for (const el of els) el.style.visibility = '';
}

/** Kommt kein neuer Stand (abgelehnt, Fehler), gleitet die Kopie zurück. */
async function cancel(p: Pending): Promise<void> {
  if (pending === p) pending = null;
  releaseGap(document);
  if (p.ghost) {
    await refuse(p.ghost.el, p.home);
    p.ghost.release();
  }
  show(p.hidden);
}

/** Schief liegt jede Karte auf dem Erledigt-Stapel – je Karte immer gleich. */
function pileTilt(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0;
  return ((Math.abs(h) % 13) - 6) * 1.1;
}

/* ------------------------------------------------------------------ Tisch */

export function Tisch({ ws }: { ws: Workspace }) {
  const scope = useStore((s) => s.scope);
  const menu = useMenu();

  if (scope === 'all') {
    return (
      <div className="tisch tisch-empty">
        <EmptyTable />
        <p className="tisch-empty-title">Der Tisch gehört zu einem Projekt</p>
        <p className="muted">Wähl links ein Projekt aus – dann liegen hier seine aktiven Milestones.</p>
      </div>
    );
  }

  const ms = activeMilestones(ws, scope);
  if (!ms.length) return <NoActive ws={ws} projectId={scope} />;
  return (
    <>
      <Table ws={ws} all={ms} menu={menu} />
      {menu.node}
    </>
  );
}

function Table({ ws, all, menu }: { ws: Workspace; all: Milestone[]; menu: Menu }) {
  // Bei mehreren aktiven Milestones lässt sich der Tisch im Kopf auf einen einschränken.
  const [only, setOnly] = useState<string | null>(null);
  const ms = all.filter((x) => x.id === only);
  const shown = ms.length ? ms : all;
  const shownKey = shown.map((x) => x.id).join(',');
  const hues = useMemo(
    () => new Map(all.length > 1 ? all.map((x, i): [string, number] => [x.id, msHue(i)]) : []),
    // Die Farbe hängt am Platz im Plan – nicht daran, ob sich sonst etwas geändert hat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all.map((x) => x.id).join(',')],
  );
  const layout = tischLayout(ws, shown);
  const [open, setOpen] = useState(readOpen);
  const root = useRef<HTMLDivElement>(null);
  const pileRef = useRef<HTMLDivElement>(null);
  const countRef = useRef<HTMLSpanElement>(null);
  const playRow = useRef<HTMLDivElement>(null);
  useWheelScrollX(playRow);
  const selected = useStore((s) => s.selected);
  const focus = useFocus((s) => s.id);

  // Die Ablage: der aufgedeckte Erledigt-Stapel, je Woche. Das Wochenziel ist
  // das Tempo aus den Einstellungen (Aufgaben pro Woche).
  const goal = useStore((s) => s.settings.velocity);
  const done = doneShelf(ws, shown);
  const [shelf, setShelf] = useState(false);
  const shelfOpen = shelf && done.weeks.length > 0;
  // Beim Schließen werden die Karten erst wieder eingesammelt (Wunsch des
  // Nutzers) – so lange bleibt die Ablage noch stehen.
  const [collecting, setCollecting] = useState(false);
  const closeShelf = useCallback((): void => {
    if (reduced()) return setShelf(false);
    setCollecting(true);
  }, []);
  useEffect(() => {
    if (!collecting) return;
    const end = setTimeout(() => {
      setShelf(false);
      setCollecting(false);
    }, SHELF_OUT);
    return () => clearTimeout(end);
  }, [collecting]);
  // Der Stapel gibt bei jedem Klick kurz nach (Wunsch des Nutzers) – beim Auf- wie beim Zudecken.
  const toggleShelf = (): void => {
    if (pileRef.current) thump(pileRef.current, false, 0);
    if (shelfOpen) closeShelf();
    else setShelf(true);
  };
  const weekRef = useRef<HTMLSpanElement>(null);

  // Mit der Karte, die das Wochenziel voll macht, fliegen die Funken – nicht
  // beim Öffnen des Tisches und nicht beim Wechsel der Milestones.
  const reached = done.thisWeek >= goal;
  const was = useRef({ id: shownKey, reached });
  useEffect(() => {
    if (reached && !was.current.reached && was.current.id === shownKey && pileRef.current) {
      burst(pileRef.current);
      float(weekRef.current ?? pileRef.current, '★ Wochenziel');
    }
    was.current = { id: shownKey, reached };
  }, [reached, shownKey]);

  const toggle = (id: string, value?: boolean): void => {
    setOpen((cur) => {
      const next = { ...cur, [id]: value ?? !cur[id] };
      if (!next[id]) delete next[id];
      writeOpen(next);
      return next;
    });
  };

  // Eine Unteraufgabe, die zurückgelegt wird, landet in ihrer Schublade – die muss dafür offen sein.
  const reveal = (t: Task): void => {
    const up = ws.ancestors(t);
    if (!up.length || up.every((a) => open[a.id])) return;
    setOpen((cur) => {
      const next = { ...cur };
      for (const a of up) next[a.id] = true;
      writeOpen(next);
      return next;
    });
  };

  useTableMotion(root, ws, open, { pile: pileRef, count: countRef });
  useTischKeys(root, ws);

  const drop = (zone: DropZone) => (e: React.DragEvent, at: number | null) =>
    void onDrop(zone, e, root.current, reveal, shown, at);

  // „Offen“ sortiert nur um, was dort schon liegt. Im Spiel bekommt auch eine
  // Karte ihren Platz, die gerade erst hineinkommt – nur nicht, was gar nicht
  // ins Spiel darf (ein Stapel, eine angekettete Karte).
  const sortsOpen = (ids: string[]): boolean => ids.every((id) => layout.open.some((t) => t.id === id));
  const sortsPlay = (ids: string[]): boolean =>
    ids.every((id) => {
      const t = ws.task(id);
      return !!t && !playRefusal(ws, t);
    });

  const drawersOf = (list: Task[]) =>
    list
      .filter((t) => open[t.id] && ws.kids(t.id).length)
      .map((t) => (
        <Drawer key={t.id} ws={ws} stack={t} path={[t]} open={open} toggle={toggle} menu={menu} />
      ));

  const empty = !layout.locked.length && !layout.open.length && !layout.play.length && !layout.pile.length;

  return (
    <MsCtx.Provider value={hues}>
    <div className="tisch" ref={root}>
      {all.map((x) => (
        <Head
          key={x.id}
          ws={ws}
          m={x}
          hue={hues.get(x.id)}
          only={only === x.id}
          dimmed={ms.length > 0 && only !== x.id}
          onOnly={() => setOnly((cur) => (cur === x.id ? null : x.id))}
        />
      ))}

      {/* Gesperrt und Offen in einem Rahmen – darüber legt sich die Ablage. */}
      <div className={`tisch-top ${shelfOpen ? 'shelf-open' : ''}`}>
      {layout.locked.length > 0 && (
        <section className="tzone tzone-locked">
          <h2 className="tzone-head">
            {LOCK_ICON} Gesperrt <span className="tzone-n">{layout.locked.length}</span>
          </h2>
          <div className="tzone-cards">
            {layout.locked.map((t) => (
              <TischCard key={t.id} ws={ws} task={t} where="locked" menu={menu} open={open} toggle={toggle} />
            ))}
          </div>
          {drawersOf(layout.locked)}
        </section>
      )}

      <DropArea zone="open" className="tzone tzone-open" onDrop={drop('open')} sorts={sortsOpen}>
        <h2 className="tzone-head">
          Offen <span className="tzone-n">{layout.open.length}</span>
        </h2>
        <div className="tzone-cards">
          {layout.open.map((t) => (
            <TischCard key={t.id} ws={ws} task={t} where="open" menu={menu} open={open} toggle={toggle} />
          ))}
          {!layout.open.length && (
            <p className="tzone-hint muted">
              {empty
                ? 'Noch keine Karten – leg im Plan Tasks in einen aktiven Milestone.'
                : 'Alles ausgespielt. Zieh eine Karte hierher, um sie zurückzulegen.'}
            </p>
          )}
        </div>
        {drawersOf(layout.open)}
      </DropArea>
      {shelfOpen && <Shelf ws={ws} shelf={done} goal={goal} leaving={collecting} onClose={closeShelf} />}
      </div>

      <div className="tisch-bottom">
        <DropArea zone="play" className="tzone tzone-play" onDrop={drop('play')} sorts={sortsPlay}>
          <h2 className="tzone-head">
            Im Spiel <span className="tzone-n">{layout.play.length}</span>
          </h2>
          <div className="tzone-cards" ref={playRow}>
            {layout.play.map((t) => (
              <TischCard key={t.id} ws={ws} task={t} where="play" menu={menu} open={open} toggle={toggle} />
            ))}
            {Array.from({ length: Math.max(0, SLOTS - layout.play.length) }, (_, i) => (
              <div key={`slot${i}`} className="tslot" aria-hidden>
                {layout.play.length + i + 1}
              </div>
            ))}
          </div>
        </DropArea>

        <DropArea zone="pile" className="tpile-zone" onDrop={drop('pile')}>
          <div className="tpile" ref={pileRef}>
            {layout.pile.length ? (
              layout.pile
                .slice(0, 3)
                .reverse()
                .map((t) => (
                  <PileCard
                    key={t.id}
                    ws={ws}
                    task={t}
                    top={t.id === layout.pile[0]?.id}
                    selected={selected === t.id}
                    focused={focus === t.id}
                    onToggle={toggleShelf}
                  />
                ))
            ) : (
              <div className="tpile-empty" aria-hidden>
                ✓
              </div>
            )}
          </div>
          <button
            className="tpile-label"
            disabled={!done.weeks.length}
            aria-expanded={shelfOpen && !collecting}
            title={shelfOpen ? 'Stapel wieder einsammeln' : 'Stapel aufdecken – was wurde wann erledigt?'}
            onClick={toggleShelf}
          >
            <span>
              <span className="tpile-n" ref={countRef}>
                {layout.pile.length}
              </span>{' '}
              erledigt
            </span>
            <span className={`tpile-week ${reached ? 'reached' : ''}`} ref={weekRef}>
              {reached ? '★ ' : ''}
              {done.thisWeek} diese Woche
            </span>
          </button>
        </DropArea>
      </div>
    </div>
    </MsCtx.Provider>
  );
}

/**
 * Eine Karte auf dem Erledigt-Stapel. Die oberste lässt sich wieder
 * herausziehen (Wunsch des Nutzers) – auf „Offen“ oder ins Spiel. Ein Klick
 * deckt den Stapel auf (wie ein Stapel in „Offen“ seine Schublade), der
 * Doppelklick öffnet wie überall den Inspektor.
 */
function PileCard({
  ws,
  task: t,
  top,
  selected,
  focused,
  onToggle,
}: {
  ws: Workspace;
  task: Task;
  top: boolean;
  selected: boolean;
  focused: boolean;
  onToggle: () => void;
}) {
  const dragging = useDragging(t.id);
  const drag = dragSource('task', t.id, top);
  return (
    <div
      className="tcell tpile-card"
      data-tcell={t.id}
      data-tkey={`pile:${t.id}`}
      data-zone="pile"
      style={{ rotate: `${pileTilt(t.id)}deg` }}
      onClick={(e) => {
        useFocus.setState({ id: t.id });
        if (e.detail >= 2) useStore.getState().select(t.id);
        else onToggle();
      }}
    >
      <div
        className={`tcard done ${selected ? 'sel' : ''} ${focused ? 'focus' : ''} ${top ? 'tpile-top' : ''} ${dragging ? 'dragging' : ''}`}
        data-tcard={t.id}
        {...drag}
        onDragStart={(e) => {
          drag.onDragStart(e);
          startTilt(e);
        }}
      >
        <CardFace ws={ws} task={t} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- Ablage */

/** So lange dauert das Einsammeln – passt zu `.tshelf.leaving` in `tisch.css`. */
const SHELF_OUT = 460;

const dayMonth = (start: string): string => `${start.slice(8, 10)}.${start.slice(5, 7)}.`;

/**
 * Der aufgedeckte Erledigt-Stapel (Wunsch des Nutzers, nach Codecks): legt sich
 * über „Gesperrt“ und „Offen“ und zeigt je Woche, was erledigt wurde – mit
 * Wochenziel, bester Woche und Serie. Jede Karte lässt sich von hier zurück auf
 * „Offen“ oder ins Spiel ziehen; solange gezogen wird, tritt die Ablage dafür
 * zur Seite. Die Zahlen stehen in `doneShelf`.
 */
function Shelf({
  ws,
  shelf,
  goal,
  leaving,
  onClose,
}: {
  ws: Workspace;
  shelf: DoneShelf;
  goal: number;
  /** Die Karten werden gerade wieder eingesammelt – gleich ist die Ablage zu. */
  leaving: boolean;
  onClose: () => void;
}) {
  const dragging = useDrag((s) => s.drag?.kind === 'task');
  const selected = useStore((s) => s.selected);
  const focus = useFocus((s) => s.id);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const s = useStore.getState();
      // Ist der Inspektor offen, schließt Escape erst ihn (`useGlobalKeys`).
      if (e.key !== 'Escape' || s.dialog !== 'none' || s.graphOpen || s.selected || s.multi.size) return;
      const el = e.target as HTMLElement | null;
      if (el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const total = shelf.weeks.reduce((n, w) => n + w.cards.length, 0);
  let dealt = 0;
  return (
    <section className={`tshelf ${dragging ? 'aside' : ''} ${leaving ? 'leaving' : ''}`} aria-label="Erledigt">
      <header className="tshelf-head">
        <h2>✓ Erledigt</h2>
        <span className="muted">
          {total} {total === 1 ? 'Karte' : 'Karten'} auf diesem Tisch
        </span>
        {shelf.streak >= 2 && (
          <span className="tbadge" title="Wochen in Folge mit mindestens einer erledigten Karte">
            🔥 {shelf.streak} Wochen in Folge
          </span>
        )}
        <button
          className="icon-btn tshelf-close"
          onClick={onClose}
          title="Stapel wieder einsammeln (Esc)"
          aria-label="Ablage schließen"
        >
          ✕
        </button>
      </header>
      {shelf.weeks.map((w) => (
        <div key={w.start} className="tweek">
          <div className="tweek-head">
            <b>{w.current ? 'Diese Woche' : `Woche ab ${dayMonth(w.start)}`}</b>
            {w.current && <span className="muted">ab {dayMonth(w.start)}</span>}
            <span
              className="tweek-bar"
              role="progressbar"
              aria-valuenow={w.count}
              aria-valuemin={0}
              aria-valuemax={goal}
              aria-label="Wochenziel"
            >
              <i style={{ width: `${Math.min(100, Math.round((w.count / goal) * 100))}%` }} />
            </span>
            <span className="tweek-n" title="Erledigte Karten ohne Unteraufgaben gegen das Tempo aus den Einstellungen">
              {w.count} von {goal}
            </span>
            {w.count >= goal && <span className="tbadge">★ Ziel geschafft</span>}
            {w.best && <span className="tbadge tbadge-best">♛ Beste Woche</span>}
          </div>
          <div className="tzone-cards">
            {w.cards.map((t) => (
              <ShelfCard
                key={t.id}
                ws={ws}
                task={t}
                i={dealt++}
                selected={selected === t.id}
                focused={focus === t.id}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

/** Eine Karte in der Ablage, darüber Wochentag und Uhrzeit. Archiviertes liegt nur noch da. */
function ShelfCard({
  ws,
  task: t,
  i,
  selected,
  focused,
}: {
  ws: Workspace;
  task: Task;
  /** Die wievielte ausgeteilte Karte – versetzt die Animation. */
  i: number;
  selected: boolean;
  focused: boolean;
}) {
  // Auch was nur mit einem archivierten Elternteil mitgegangen ist, steht nicht mehr im Bestand.
  const archived = isArchived(t) || !ws.task(t.id);
  const dragging = useDragging(t.id);
  const drag = dragSource('task', t.id, !archived);
  const at = t.doneAt ? new Date(t.doneAt) : new Date();
  return (
    <div className="tdeal" style={{ '--i': Math.min(i, 14) } as React.CSSProperties}>
      <div
        className={`tcell tshelf-card ${archived ? 'is-archived' : ''}`}
        data-tcell={t.id}
        data-tkey={`shelf:${t.id}`}
        data-zone="shelf"
        title={archived ? 'Archiviert' : undefined}
        onClick={(e) => {
          if (archived) return;
          useFocus.setState({ id: t.id });
          if (e.detail >= 2) useStore.getState().select(t.id);
        }}
      >
        <span className="tshelf-when">
          {at.toLocaleDateString('de-DE', { weekday: 'short' })}{' '}
          {at.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div
          className={`tcard done ${selected ? 'sel' : ''} ${focused ? 'focus' : ''} ${dragging ? 'dragging' : ''}`}
          data-tcard={archived ? undefined : t.id}
          {...drag}
          onDragStart={(e) => {
            drag.onDragStart(e);
            startTilt(e);
          }}
        >
          <CardFace ws={ws} task={t} crumb />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Kopf */

function Head({
  ws,
  m,
  hue,
  only,
  dimmed,
  onOnly,
}: {
  ws: Workspace;
  m: Milestone;
  /** Die Farbe des Milestones – nur wenn mehrere auf dem Tisch liegen. */
  hue: number | undefined;
  /** Der Tisch zeigt gerade nur diesen. */
  only: boolean;
  /** Der Tisch zeigt gerade nur einen anderen. */
  dimmed: boolean;
  onOnly: () => void;
}) {
  const velocity = useStore((s) => s.settings.velocity);
  const selected = useStore((s) => s.selected);
  const stats = milestoneStats(ws, m);
  const pct = milestoneProgressPct(ws, m);
  const when = dueText(ws, m, velocity);
  return (
    <header
      className={`tisch-head ${hue === undefined ? '' : 'multi'} ${dimmed ? 'dimmed' : ''}`}
      style={hue === undefined ? undefined : ({ '--ms-h': hue } as React.CSSProperties)}
    >
      <button
        className={`tisch-ms ${selected === m.id ? 'sel' : ''}`}
        onClick={() => useStore.getState().select(m.id)}
        title="Details des Milestones öffnen"
      >
        <span aria-hidden>◆</span> {m.title || 'Ohne Titel'}
      </button>
      <div
        className="tisch-xp"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Fortschritt"
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="tisch-xp-n" title="Erledigte von allen Aufgaben">
        {stats.done}/{stats.total}
      </span>
      {when && <span className={`tisch-due ${when.late ? 'late' : ''}`}>{when.text}</span>}
      {hue !== undefined && (
        <button
          className="tisch-only"
          aria-pressed={only}
          title={only ? 'Wieder alle aktiven Milestones zeigen' : 'Nur die Karten dieses Milestones zeigen'}
          onClick={onOnly}
        >
          {only ? 'Alle zeigen' : 'Nur dieser'}
        </button>
      )}
    </header>
  );
}

/** „noch 6 Tage“ bis zum Enddatum, sonst die Prognose aus dem Zeitplan. */
function dueText(ws: Workspace, m: Milestone, velocity: number): { text: string; late: boolean } | null {
  if (m.endDate) {
    const [y, mo, d] = m.endDate.split('-').map(Number) as [number, number, number];
    const end = new Date(y, mo - 1, d);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((end.getTime() - today.getTime()) / 86_400_000);
    if (days > 1) return { text: `noch ${days} Tage`, late: false };
    if (days === 1) return { text: 'noch 1 Tag', late: false };
    if (days === 0) return { text: 'heute fällig', late: false };
    return { text: `${-days} ${days === -1 ? 'Tag' : 'Tage'} drüber`, late: true };
  }
  const line = m.planned ? schedule(ws, { velocity }).byId.get(m.id) : null;
  if (!line || !line.open) return null;
  const d = new Date();
  d.setDate(d.getDate() + Math.round(line.forecastEnd * 7));
  return {
    text: `Prognose ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}`,
    late: line.late,
  };
}

/* -------------------------------------------------------------- Karten */

function TischCard({
  ws,
  task,
  where,
  menu,
  open,
  toggle,
}: {
  ws: Workspace;
  task: Task;
  where: Where;
  menu: Menu;
  open: Record<string, boolean>;
  toggle: (id: string, value?: boolean) => void;
}) {
  const selected = useStore((s) => s.selected);
  const multi = useStore((s) => s.multi);
  const dragging = useDragging(task.id);
  const kids = ws.kids(task.id);
  const stack = kids.length > 0;
  const done = isDone(task);
  // In der Schublade: was im Spiel liegt, hinterlässt nur seinen Umriss.
  const away = where === 'drawer' && !stack && task.status === 'progress';
  const locked = !done && task.status !== 'progress' && isBlocked(ws, task);
  const ready = stack && stackReady(ws, task);
  const drag = dragSource('task', task.id, !done && !away);

  const focused = useFocus((s) => s.id === task.id);

  // Ein Klick markiert (ein Stapel klappt dabei auf oder zu), erst der zweite
  // Klick eines Doppelklicks öffnet den Inspektor.
  const click = (e: React.MouseEvent): void => {
    const s = useStore.getState();
    if (e.ctrlKey || e.metaKey) {
      s.toggleMulti(task.id);
      return;
    }
    s.clearMulti();
    useFocus.setState({ id: task.id });
    if (e.detail >= 2) s.select(task.id);
    else if (stack) toggle(task.id);
  };

  if (away) {
    return (
      <div className="tcell tcell-away" data-tkey={`${where}:${task.id}`} title="Liegt im Spiel">
        <span>{task.title || 'Ohne Titel'}</span>
        <span className="tcell-away-hint">im Spiel ↓</span>
      </div>
    );
  }

  return (
    <div
      className={[
        'tcell',
        stack ? 'is-stack' : '',
        stack && open[task.id] ? 'stack-open' : '',
        ready ? 'stack-ready' : '',
        locked ? 'is-locked' : '',
        done ? 'is-done' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-tcell={task.id}
      data-tkey={`${where}:${task.id}`}
      data-zone={where}
    >
      {/* In der Schublade steht die Herkunft schon am Stapel. */}
      {where !== 'drawer' && <MsTag ws={ws} task={task} />}
      <div
        className={[
          'tcard',
          selected === task.id ? 'sel' : '',
          focused ? 'focus' : '',
          multi.has(task.id) ? 'multi' : '',
          done ? 'done' : '',
          dragging ? 'dragging' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        data-tcard={task.id}
        onClick={click}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          useStore.getState().clearMulti();
          menu.openAtPoint(e.clientX, e.clientY, rowMenu(ws, { type: 'task', id: task.id, task, depth: 0 }));
        }}
        {...drag}
        onDragStart={(e) => {
          drag.onDragStart(e);
          startTilt(e);
        }}
      >
        {/* Im Spiel steht über einer Unteraufgabe, wozu sie gehört. */}
        <CardFace ws={ws} task={task} crumb={where === 'play'} />
        {locked && (
          <span className="tchain" title={lockTitle(ws, task)}>
            {LOCK_ICON}
            {blockers(ws, task).length > 1 ? ` ${blockers(ws, task).length}` : ''}
          </span>
        )}
        {ready && <span className="tready">fertig ✓</span>}
      </div>
    </div>
  );
}

function lockTitle(ws: Workspace, t: Task): string {
  const list = blockers(ws, t);
  if (!list.length) return 'Als Blockiert markiert';
  return `Wartet auf: ${list.map((b) => b.title || 'Ohne Titel').join(', ')}`;
}

/* --------------------------------------------------------- Schublade */

function Drawer({
  ws,
  stack,
  path,
  open,
  toggle,
  menu,
}: {
  ws: Workspace;
  stack: Task;
  path: Task[];
  open: Record<string, boolean>;
  toggle: (id: string, value?: boolean) => void;
  menu: Menu;
}) {
  const kids = ws.kids(stack.id);
  return (
    <div className="tdrawer" style={{ '--depth': path.length - 1 } as React.CSSProperties}>
      <div className="tdrawer-head">
        <span className="tdrawer-path">
          {path.map((t) => t.title || 'Ohne Titel').join(' › ')}
        </span>
        <button
          className="icon-btn tdrawer-close"
          onClick={() => toggle(stack.id, false)}
          title="Schublade zuklappen"
          aria-label="Schublade zuklappen"
        >
          ✕
        </button>
      </div>
      <div className="tzone-cards">
        {kids.map((k, i) => (
          <div key={k.id} className="tfan" style={{ '--i': i } as React.CSSProperties}>
            <TischCard ws={ws} task={k} where="drawer" menu={menu} open={open} toggle={toggle} />
          </div>
        ))}
      </div>
      {kids
        .filter((k) => open[k.id] && ws.kids(k.id).length)
        .map((k) => (
          <Drawer key={k.id} ws={ws} stack={k} path={[...path, k]} open={open} toggle={toggle} menu={menu} />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------ Ablegen */

/**
 * Der Landeplatz der gezogenen Karte in einer Zone, in der sortiert wird:
 * `index` zählt unter den Karten der Zone ohne die gezogenen, der Rest ist die
 * Lage des Platzes in der Zone.
 */
type Gap = { index: number; x: number; y: number; w: number; h: number };

/** Alle Karten einer Zone, in der Reihenfolge, in der sie liegen. */
const zoneCells = (zone: HTMLElement): HTMLElement[] => [
  ...zone.querySelectorAll<HTMLElement>(':scope > .tzone-cards > .tcell[data-tcell]'),
];

/** Größe einer Zelle, falls gerade keine zum Messen in der Zone liegt (`.tcell` in tisch.css). */
const CELL = { w: 142, h: 190 };

/**
 * Das Raster einer Zone: wo es beginnt, wie groß ein Platz ist und wie viele
 * nebeneinander passen. „Im Spiel“ ist eine einzige Reihe, „Offen“ bricht um.
 */
function gridOf(zone: HTMLElement): { left: number; top: number; w: number; h: number; cols: number } | null {
  const row = zone.querySelector<HTMLElement>(':scope > .tzone-cards');
  if (!row) return null;
  const cell = zoneCells(zone)[0];
  const w = cell?.offsetWidth || CELL.w;
  const h = cell?.offsetHeight || CELL.h;
  const box = row.getBoundingClientRect();
  const style = getComputedStyle(row);
  return {
    left: box.left - row.scrollLeft + parseFloat(style.paddingLeft || '0'),
    top: box.top - row.scrollTop + parseFloat(style.paddingTop || '0'),
    w,
    h,
    cols: style.flexWrap === 'nowrap' ? Infinity : Math.max(1, Math.floor((row.clientWidth + 1) / w)),
  };
}

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

/**
 * Der Platz der gezogenen Karte. Gerechnet wird gegen die Zone, wie sie mit ihr
 * aussähe: bei n anderen Karten n+1 Plätze im Raster, und es gilt der Platz,
 * dessen Mitte der Kartenmitte am nächsten liegt. Die Mitte der Karte und nicht
 * der Zeiger: an einer Ecke gegriffen, liegt der schon über der Nachbarkarte.
 * Und bewusst gegen diese feste Aufteilung statt gegen die Karten, wie sie
 * gerade stehen – die sind schon zur Seite gerückt, und die Lücke bestimmte
 * sonst ihre eigene Lage und flatterte.
 */
function gapAt(zone: HTMLElement, e: React.DragEvent, dragged: string[]): Gap | null {
  // Über einer Schublade wird nicht sortiert – dort liegen die Unteraufgaben.
  if ((e.target as HTMLElement).closest('.tdrawer')) return null;
  const grid = gridOf(zone);
  if (!grid) return null;
  const others = zoneCells(zone).filter((c) => !dragged.includes(c.dataset['tcell'] as string)).length;

  // Ohne Angaben zur Karte (sie kam nicht von einer Karte des Tischs) zählt der Zeiger.
  const card = draggedCard(e) ?? { x: e.clientX, y: e.clientY, w: grid.w - 14, h: grid.h - 14 };
  const single = grid.cols === Infinity;
  const col = clamp(Math.round((card.x - grid.left - grid.w / 2) / grid.w), 0, single ? others : grid.cols - 1);
  const line = single
    ? 0
    : clamp(Math.round((card.y - grid.top - grid.h / 2) / grid.h), 0, Math.floor(others / grid.cols));
  const index = single ? col : Math.min(others, line * grid.cols + col);

  const box = zone.getBoundingClientRect();
  const at = single ? { col: index, line: 0 } : { col: index % grid.cols, line: Math.floor(index / grid.cols) };
  return {
    index,
    x: grid.left + at.col * grid.w + (grid.w - card.w) / 2 - box.left - zone.clientLeft,
    y: grid.top + at.line * grid.h + (grid.w - card.w) / 2 - box.top - zone.clientTop,
    w: card.w,
    h: card.h,
  };
}

/**
 * Rückt die Karten der Zone so, dass an `at` eine Lücke für die gezogenen
 * bleibt (`null`: wieder zusammen). Eine gezogene Karte, die selbst in der
 * Zone liegt, verschwindet dabei – ihren Platz nehmen die anderen ein. Am
 * Zeilenende rückt eine Karte in die nächste Zeile.
 */
function shiftCells(zone: HTMLElement, dragged: string[], at: number | null): void {
  const cols = gridOf(zone)?.cols ?? Infinity;
  const place = (slot: number) =>
    cols === Infinity ? { col: slot, line: 0 } : { col: slot % cols, line: Math.floor(slot / cols) };
  let other = 0;
  let slot = 0;
  for (const cell of zoneCells(zone)) {
    if (dragged.includes(cell.dataset['tcell'] as string)) {
      if (at === null) cell.removeAttribute('data-lift');
      else cell.setAttribute('data-lift', '');
      slot++;
      continue;
    }
    const from = place(slot);
    const to = place(at === null ? slot : other < at ? other : other + dragged.length);
    cell.setAttribute('data-shift', '');
    cell.style.setProperty('--shift-x', String(to.col - from.col));
    cell.style.setProperty('--shift-y', String(to.line - from.line));
    other++;
    slot++;
  }
}

/**
 * Nach dem Ablegen bleibt die Lücke stehen, bis der neue Stand da ist – sonst
 * sprängen die Karten zurück und glitten gleich wieder an denselben Platz.
 */
let gapHeld = false;

/** Nimmt das Auseinanderrücken sofort zurück, ohne Übergang. */
function releaseGap(root: ParentNode): void {
  gapHeld = false;
  for (const cell of root.querySelectorAll<HTMLElement>('.tcell[data-shift], .tcell[data-lift]')) {
    cell.removeAttribute('data-shift');
    cell.removeAttribute('data-lift');
    cell.style.removeProperty('--shift-x');
    cell.style.removeProperty('--shift-y');
  }
}

/** Misst die Lagen der Karten neu, ohne zu animieren – gesetzt von `useTableMotion`. */
let resync: (() => void) | null = null;

/**
 * Eine Zone, auf die man Karten zieht – hervorgehoben, solange eine darüber
 * schwebt. Mit `sorts` rücken ihre Karten auseinander und lassen eine Lücke als
 * Landeplatz; beim Ablegen gibt sie diesen Platz mit.
 */
function DropArea({
  zone,
  className,
  onDrop,
  sorts,
  children,
}: {
  zone: DropZone;
  className: string;
  onDrop: (e: React.DragEvent, at: number | null) => void;
  /** Ob sich diese gezogenen Aufgaben hier einsortieren lassen. */
  sorts?: (ids: string[]) => boolean;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  const [gap, setGap] = useState<Gap | null>(null);
  const active = useDrag((s) => s.drag?.kind === 'task');
  const gapOf = (e: React.DragEvent<HTMLElement>): Gap | null => {
    const drag = useDrag.getState().drag;
    return drag?.kind === 'task' && sorts?.(drag.ids) ? gapAt(e.currentTarget, e, drag.ids) : null;
  };

  // Solange gezogen wird, öffnet und schließt sich die Lücke mit Übergang;
  // danach steht alles sofort wieder – außer es wurde hier abgelegt (`gapHeld`).
  const ref = useRef<HTMLElement>(null);
  const at = active && over && gap ? gap.index : null;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !sorts) return;
    const ids = useDrag.getState().drag?.ids;
    if (active && ids) shiftCells(el, ids, at);
    else if (!gapHeld) releaseGap(el);
  }, [at, active, sorts]);

  return (
    <section
      ref={ref}
      className={`${className} ${over && active ? 'dz-over' : ''} ${active ? 'dz-live' : ''}`}
      data-drop={zone}
      onDragOver={(e) => {
        if (useDrag.getState().drag?.kind !== 'task') return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        if (!over) setOver(true);
        const g = gapOf(e);
        // `dragover` kommt laufend, auch wenn der Zeiger steht.
        setGap((cur) => (cur?.x === g?.x && cur?.y === g?.y && cur?.index === g?.index ? cur : g));
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setOver(false);
        setGap(null);
      }}
      onDrop={(e) => {
        // Es gilt der Platz, den die Lücke zuletzt gezeigt hat.
        onDrop(e, gap?.index ?? null);
        setOver(false);
        setGap(null);
      }}
    >
      {children}
      {active && over && gap && (
        <i className="tland" style={{ left: gap.x, top: gap.y, width: gap.w, height: gap.h }} aria-hidden />
      )}
    </section>
  );
}

/** Was das Ablegen zwischen zwei Karten tut – `same`: die Karte liegt dort schon. */
type Sort = (() => Promise<void>) | 'same';

function sortAt(ws: Workspace, ms: Milestone[], zone: DropZone, tasks: Task[], at: number): Sort | null {
  const store = useStore.getState();
  const layout = tischLayout(ws, ms);
  const dragged = new Set(tasks.map((t) => t.id));
  const sameOrder = (a: Task[], b: Task[]): boolean => a.length === b.length && a.every((t, i) => t.id === b[i]?.id);

  if (zone === 'play') {
    const row = layout.play.filter((t) => !dragged.has(t.id));
    row.splice(Math.min(at, row.length), 0, ...tasks);
    if (sameOrder(row, layout.play)) return 'same';
    // Die Reihe wird durchgezählt; wer dabei erst ins Spiel kommt, bekommt den Status gleich mit.
    const steps: Step[] = row.flatMap((t, i) => {
      const enters = t.status !== 'progress';
      if (!enters && t.playOrder === i + 1) return [];
      const changes = { ...(enters ? { status: 'progress' } : {}), playOrder: i + 1 };
      return [{ op: 'patch', kind: 'task', id: t.id, version: t.version, changes }];
    });
    return () => store.runSteps(steps, null);
  }

  if (zone === 'open') {
    // Sortiert wird innerhalb eines Milestones: liegen mehrere auf dem Tisch,
    // zählen nur die Karten des eigenen – in einen anderen wandert hier nichts.
    const m = ws.milestone((tasks[0] as Task).milestoneId);
    if (!m || tasks.some((t) => t.milestoneId !== m.id)) return null;
    const own = (t: Task): boolean => t.milestoneId === m.id;
    // „Offen“ zeigt die Wurzeln des Milestones in der Reihenfolge des Plans –
    // dazwischen liegen dort auch die gesperrten, ausgespielten und erledigten.
    const roots = ws.msRoots(m).filter((t) => !dragged.has(t.id));
    const open = layout.open.filter((t) => !dragged.has(t.id));
    const next = open.slice(at).find(own);
    const last = open.filter(own).pop();
    const index = next ? roots.indexOf(next) : last ? roots.indexOf(last) + 1 : roots.length;
    const after = [...roots];
    after.splice(index, 0, ...tasks);
    if (sameOrder(after, ws.msRoots(m))) return 'same';
    const target = { parentId: null, milestoneId: m.id, groupId: null, projectId: m.projectId, index };
    const first = tasks[0] as Task;
    return tasks.length > 1
      ? () => store.bulk({ type: 'move', target }, (n) => `${n} Tasks verschoben`)
      : () => store.moveTask(first.id, target);
  }
  return null;
}

async function onDrop(
  zone: DropZone,
  e: React.DragEvent,
  root: HTMLElement | null,
  reveal: (t: Task) => void,
  ms: Milestone[],
  /** Der Platz zwischen den Karten der Zone – `null`: einfach in die Zone. */
  at: number | null,
): Promise<void> {
  const store = useStore.getState();
  const ws = store.ws;
  const drag = useDrag.getState().drag;
  if (!ws || !root || drag?.kind !== 'task') return;
  e.preventDefault();
  e.stopPropagation();
  // Die Kopie bleibt liegen, wo sie losgelassen wurde – erst dann endet das Ziehen.
  const held = holdGhost();
  useDrag.setState({ drag: null, over: null });

  const tasks = drag.ids.map((id) => ws.task(id)).filter((t): t is Task => !!t);
  const first = tasks[0];
  if (!first) {
    held?.release();
    return;
  }
  const status = STATUS_OF[zone];
  const originals = tasks.flatMap((t) => cardEls(root, t.id));
  const home = cardEls(root, first.id)[0]?.getBoundingClientRect() ?? null;

  const refusal =
    zone === 'play'
      ? tasks.map((t) => playRefusal(ws, t)).find(Boolean)
      : zone === 'pile'
        ? tasks.map((t) => doneRefusal(ws, t)).find(Boolean)
        : null;
  // Zwischen zwei Karten abgelegt wird sortiert. In „Offen“ bleibt der Status
  // dabei, wie er ist – sonst machte das Umsortieren aus „Unklar“ ein „Offen“.
  const sort = refusal || at === null ? null : sortAt(ws, ms, zone, tasks, at);
  const changing = sort ? [] : tasks.filter((t) => t.status !== status);

  if (refusal || sort === 'same' || (!sort && !changing.length)) {
    if (refusal) store.say(refusal);
    if (held) {
      for (const el of originals) el.style.visibility = 'hidden';
      await (refusal ? refuse(held.el, home) : settleBack(held.el, home));
      held.release();
      show(originals);
    }
    return;
  }

  for (const el of originals) el.style.visibility = 'hidden';
  const p: Pending = {
    ids: (sort ? tasks : changing).map((t) => t.id),
    to: zone,
    big: zone === 'pile' && changing.some((t) => ws.kids(t.id).length > 0),
    ghost: held,
    hidden: originals,
    home,
    since: sort ? ws : null,
  };
  if (pending) void cancel(pending);
  pending = p;
  if (sort) {
    // Die Karten stehen schon, wie sie gleich liegen werden – das merkt sich
    // die Bewegung, und die Lücke bleibt bis zum neuen Stand.
    gapHeld = true;
    resync?.();
  }

  if (sort) {
    await sort();
    // Kam kein neuer Stand (Fehler), geht die Kopie zurück.
    requestAnimationFrame(() => {
      if (pending === p) void cancel(p);
    });
    return;
  }
  if (zone === 'open') changing.forEach(reveal);

  const steps: Step[] = changing.map((t) => ({
    op: 'patch',
    kind: 'task',
    id: t.id,
    version: t.version,
    changes: { status },
  }));
  const name = `„${first.title || 'Ohne Titel'}“`;
  await store.runSteps(
    steps,
    zone === 'pile' ? (n) => (n === 1 ? `${name} erledigt` : `${n} Tasks erledigt`) : null,
  );
  // Kam keine Karte zum Landen: abgelehnt – sie geht zurück. Oder sie liegt
  // an einem Ort, der gerade nicht zu sehen ist – dann verschwindet die Kopie.
  requestAnimationFrame(() => {
    if (pending !== p) return;
    const now = useStore.getState().ws?.task(first.id);
    if (now?.status === status) void vanish(p);
    else void cancel(p);
  });
}

async function vanish(p: Pending): Promise<void> {
  if (pending === p) pending = null;
  show(p.hidden);
  if (!p.ghost) return;
  if (!reduced()) {
    await p.ghost.el.animate([{ opacity: 1, scale: '1' }, { opacity: 0, scale: '0.6' }], {
      duration: 220,
      easing: 'ease-in',
      fill: 'forwards',
    }).finished;
  }
  p.ghost.release();
}

/** Ohne Änderung abgelegt: die Kopie gleitet einfach zurück. */
async function settleBack(ghost: HTMLElement, home: DOMRect | null): Promise<void> {
  if (!home || reduced()) return;
  const g = ghost.getBoundingClientRect();
  const dx = home.left + home.width / 2 - (g.left + g.width / 2);
  const dy = home.top + home.height / 2 - (g.top + g.height / 2);
  await ghost.animate([{ translate: '0 0' }, { translate: `${dx}px ${dy}px` }], {
    duration: 280,
    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
    fill: 'forwards',
  }).finished;
}

/* ---------------------------------------------------------- Bewegung */

/** Eine Karte im neuen Stand; `busy`: sie landet oder dreht sich gerade noch. */
type Cell = { el: HTMLElement; rect: DOMRect; zone: string; id: string; busy: boolean };

/** `away`: nur der Umriss einer ausgespielten Unteraufgabe in ihrer Schublade. */
type Spot = { x: number; y: number; zone: string; away: boolean };

/**
 * Nach jedem neuen Stand (und beim Auf- und Zuklappen einer Schublade): die
 * abgelegte Karte landet, freigeschaltete drehen sich um, alle anderen gleiten
 * an ihren neuen Platz. Gemessen wird relativ zum Tisch, damit Scrollen
 * dazwischen nichts verschiebt.
 */
function useTableMotion(
  rootRef: React.RefObject<HTMLDivElement | null>,
  ws: Workspace,
  open: Record<string, boolean>,
  refs: { pile: React.RefObject<HTMLDivElement | null>; count: React.RefObject<HTMLSpanElement | null> },
): void {
  const spots = useRef<Map<string, Spot> | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    // Eine nach dem Ablegen gehaltene Lücke: die Karten liegen jetzt wirklich so.
    if (gapHeld) releaseGap(root);
    const base = root.getBoundingClientRect();
    const cells = [...root.querySelectorAll<HTMLElement>('[data-tkey]')];
    const now = new Map<string, Cell>();
    for (const el of cells) {
      const key = el.dataset['tkey'] as string;
      const [zone = '', id = ''] = key.split(/:(.*)/s);
      // Was gerade noch landet oder sich umdreht, läuft zu Ende und wird nicht neu angestoßen.
      const busy = el.getAnimations().some((a) => a.playState === 'running');
      now.set(key, { el, rect: el.getBoundingClientRect(), zone, id, busy });
    }

    // Die abgelegte Karte übernimmt von ihrer Kopie – dort, wo sie jetzt liegt:
    // meist die Zielzone, eine zurückgelegte Unteraufgabe in ihrer Schublade.
    const p = pending;
    const landed = new Set<string>();
    if (p) {
      const first = p.ids[0];
      const fresh = [...now.values()].filter(
        (c) =>
          c.id === first && c.el.dataset['tcell'] === first && (p.since ? p.since !== ws : !p.hidden.includes(c.el)),
      );
      const target = fresh.find((c) => c.zone === p.to) ?? fresh[0];
      if (target) {
        pending = null;
        const from = p.ghost?.el.getBoundingClientRect() ?? null;
        p.ghost?.release();
        show(p.hidden);
        for (const id of p.ids) landed.add(id);
        if (from) land(target.el, from, p.to === 'pile' ? pileTilt(p.ids[0] as string) : 0);
        if (p.to === 'pile') pileFx(p.ids.length, p.big);
      }
    }

    /*
     * Alle anderen: wer die Zone wechselt – über die Leertaste, den Inspektor,
     * einen anderen Tab –, landet wie abgelegt; wer frei wird, dreht sich um;
     * wer nur Platz macht, gleitet.
     */
    const prev = spots.current;
    if (prev) {
      /*
       * Je Karte die alte Lage an einem Ort, an dem sie jetzt nicht mehr liegt –
       * nur dann ist sie gewandert. Liegt sie dort weiter (etwa oben auf dem
       * Erledigt-Stapel, während ihre Schublade aufgeht), ist die neue Karte nur
       * ein weiterer Anblick derselben Aufgabe und fliegt nicht von dort her.
       * Der Umriss in der Schublade zählt nur, wenn es sonst nichts gibt.
       */
      const byId = new Map<string, Spot>();
      for (const [key, s] of prev) {
        if (now.has(key)) continue;
        const id = key.split(/:(.*)/s)[1] as string;
        if (!byId.has(id) || byId.get(id)?.away) byId.set(id, s);
      }
      const toPile: string[] = [];
      const moves: { c: Cell; old: Spot; from: DOMRect }[] = [];
      for (const [key, c] of now) {
        if (landed.has(c.id) || c.busy) continue;
        const old = prev.get(key) ?? byId.get(c.id);
        if (!old) continue;
        moves.push({ c, old, from: new DOMRect(old.x + base.left, old.y + base.top, c.rect.width, c.rect.height) });
      }
      // Wird etwas freigeschaltet, spielt das zuerst – alle anderen warten so lange an ihrem Platz.
      const hold = moves.some((m) => m.old.zone === 'locked' && m.c.zone === 'open') && !reduced() ? UNLOCK_HOLD : 0;
      for (const { c, old, from } of moves) {
        if (old.zone === 'locked' && c.zone === 'open') unlock(c.el, from);
        else if (old.zone !== c.zone && !old.away && c.el.dataset['tcell']) {
          land(c.el, from, c.zone === 'pile' ? pileTilt(c.id) : 0);
          if (c.zone === 'pile') toPile.push(c.id);
        } else glide(c.el, from.left - c.rect.left, from.top - c.rect.top, hold);
      }
      if (toPile.length) pileFx(toPile.length, toPile.some((id) => ws.kids(id).length > 0));
    }

    // Gemessen vor dem Start der Animationen – danach stünden die Startpunkte drin.
    const next = new Map<string, Spot>();
    for (const [key, c] of now) {
      next.set(key, {
        x: c.rect.left - base.left,
        y: c.rect.top - base.top,
        zone: c.zone,
        away: c.el.classList.contains('tcell-away'),
      });
    }
    spots.current = next;
  }, [ws, open, rootRef, refs.pile, refs.count]);

  /** Der Erledigt-Stapel gibt nach, der Zähler springt, „+n“ steigt auf – bei einem ganzen Stapel mit Funken. */
  function pileFx(n: number, big: boolean): void {
    const pile = refs.pile.current;
    if (pile) {
      thump(pile, big);
      float(pile, `+${n}`);
      if (big) burst(pile);
    }
    pop(refs.count.current);
  }

  // Ändert sich nur die Breite (Inspektor, Fenster) oder wird „Im Spiel“ seitlich
  // gescrollt, wird neu gemessen, ohne zu animieren.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const again = (): void => {
      spots.current = measure(root);
    };
    const ro = new ResizeObserver(again);
    ro.observe(root);
    root.addEventListener('scroll', again, true);
    resync = again;
    return () => {
      ro.disconnect();
      root.removeEventListener('scroll', again, true);
      if (resync === again) resync = null;
    };
  }, [rootRef]);
}

/** Wo jede Karte liegt, relativ zum Tisch. */
function measure(root: HTMLElement): Map<string, Spot> {
  const base = root.getBoundingClientRect();
  const out = new Map<string, Spot>();
  for (const el of root.querySelectorAll<HTMLElement>('[data-tkey]')) {
    const key = el.dataset['tkey'] as string;
    const r = el.getBoundingClientRect();
    out.set(key, {
      x: r.left - base.left,
      y: r.top - base.top,
      zone: key.split(':')[0] ?? '',
      away: el.classList.contains('tcell-away'),
    });
  }
  return out;
}

/* ---------------------------------------------------------- Tastatur */

const CYCLE: Status[] = ['open', 'progress', 'done'];

/**
 * Pfeiltasten wandern von Karte zu Karte – links und rechts in der Reihenfolge
 * auf dem Tisch, hoch und runter zur nächsten Reihe darüber bzw. darunter. Die
 * Leertaste schaltet den Status der markierten Karte weiter (mit Umschalt
 * zurück), wie in der Liste: Offen → In Progress → Erledigt; aus Unklar und
 * Blockiert geht es zurück auf Offen. Ein Stapel kommt nie ins Spiel – bei ihm
 * springt sie von Offen direkt auf Erledigt. Die Karte wandert dann mit
 * denselben Animationen wie beim Ziehen.
 */
function useTischKeys(rootRef: React.RefObject<HTMLDivElement | null>, ws: Workspace): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const s = useStore.getState();
      if (target?.closest?.('.draw-modal') || s.graphOpen || s.dialog !== 'none') return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)) return;
      // Knöpfe in Seitenleiste und Inspektor behalten ihre Tasten.
      if (target && target !== document.body && !target.closest('.tisch')) return;
      const root = rootRef.current;
      if (!root) return;

      const cards = [...root.querySelectorAll<HTMLElement>('.tcard[data-tcard]')].filter(
        (c) => c.offsetParent !== null,
      );
      const focus = useFocus.getState().id;
      const cur = cards.find((c) => c.dataset['tcard'] === focus) ?? null;

      const go = (el: HTMLElement | undefined): void => {
        if (!el) return;
        useFocus.setState({ id: el.dataset['tcard'] ?? null });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      };

      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        if (!cur) return go(cards[0]);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          return go(cards[cards.indexOf(cur) + (e.key === 'ArrowRight' ? 1 : -1)]);
        }
        return go(nearestRow(cur, cards, e.key === 'ArrowDown' ? 1 : -1));
      }

      if (e.key === ' ' && cur) {
        e.preventDefault();
        if (e.repeat) return;
        const t = ws.task(focus);
        if (!t) return;
        void step(t, e.shiftKey ? -1 : 1, cur);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rootRef, ws]);

  async function step(t: Task, dir: 1 | -1, el: HTMLElement): Promise<void> {
    const store = useStore.getState();
    const stack = ws.kids(t.id).length > 0;
    const at = CYCLE.indexOf(t.status);
    let next: Status = at < 0 ? 'open' : (CYCLE[Math.max(0, Math.min(CYCLE.length - 1, at + dir))] ?? t.status);
    if (stack && next === 'progress') next = dir > 0 ? 'done' : 'open';
    if (next === t.status) return;

    const refusal = next === 'progress' ? playRefusal(ws, t) : next === 'done' ? doneRefusal(ws, t) : null;
    if (refusal) {
      store.say(refusal);
      shake(el.parentElement ?? el);
      return;
    }
    const name = `„${t.title || 'Ohne Titel'}“`;
    await store.runSteps(
      [{ op: 'patch', kind: 'task', id: t.id, version: t.version, changes: { status: next } }],
      next === 'done' ? () => `${name} erledigt` : null,
    );
  }
}

/** Die nächste Karte in der Reihe darüber oder darunter, möglichst senkrecht über der jetzigen. */
function nearestRow(cur: HTMLElement, cards: HTMLElement[], dir: 1 | -1): HTMLElement | undefined {
  const a = cur.getBoundingClientRect();
  const cx = a.left + a.width / 2;
  const cy = a.top + a.height / 2;
  let best: { el: HTMLElement; dy: number; dx: number } | undefined;
  for (const el of cards) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const dy = (r.top + r.height / 2 - cy) * dir;
    // Erst ab einer halben Kartenhöhe gilt es als andere Reihe.
    if (dy < a.height / 2) continue;
    const dx = Math.abs(r.left + r.width / 2 - cx);
    if (!best || dy < best.dy - 20 || (Math.abs(dy - best.dy) <= 20 && dx < best.dx)) best = { el, dy, dx };
  }
  return best?.el;
}

/* ------------------------------------------------------ Leerer Tisch */

function NoActive({ ws, projectId }: { ws: Workspace; projectId: string }) {
  const next = plannedMilestones(ws, projectId).find((m) => m.status !== 'done');
  return (
    <div className="tisch tisch-empty">
      <EmptyTable />
      <p className="tisch-empty-title">Kein aktiver Milestone</p>
      <p className="muted">Der Tisch ist abgeräumt. Aktiv ist, was auf In Progress steht.</p>
      {next && (
        <button
          className="btn primary tisch-start"
          onClick={() => void useStore.getState().setMilestoneStatus(next.id, 'progress')}
        >
          ◆ {next.title || 'Ohne Titel'} starten
        </button>
      )}
    </div>
  );
}

/** Ein leerer Tisch: ein verdeckter Stapel, der auf die erste Runde wartet. */
function EmptyTable() {
  return (
    <div className="tisch-felt" aria-hidden>
      <div className="tisch-deck">
        <i />
        <i />
        <i />
      </div>
      <div className="tisch-zzz">z z z</div>
    </div>
  );
}
