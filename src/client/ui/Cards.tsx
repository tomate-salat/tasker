import { useEffect, useRef, useState } from 'react';
import { checklist } from '@shared/checklist.js';
import { isDone, type Task } from '@shared/model.js';
import type { OutlineRow, OutlineView } from '@shared/outline.js';
import { doneCount, statusSegments, total } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { api, imageUrl } from '../api.js';
import { useStore, type View } from '../store.js';
import { hasFiles, refreshGallery } from './imageDrop.js';
import { ImageRejected, imagesIn, prepareImage } from './imageFile.js';
import { addChild } from './actions.js';
import { bulkMenu } from './BulkBar.js';
import { cellMenu, type CellKind } from './cellMenu.js';
import { dragSource, dropTarget, useDragging, useZone } from './dnd.js';
import { CHEVRON_DOWN, CHEVRON_RIGHT, PrioIcon, SegBar } from './icons.js';
import type { Menu } from './Menu.js';
import { rowMenu } from './rowMenu.js';
import { ChecklistBadge, DrawingBadge, LockBadge, StatusDot, TaskRow, TitleEdit } from './rows.js';
import './cards.css';

/**
 * Die Kartenansicht – ein Versuch, angelehnt an Codecks, auf Wunsch des
 * Nutzers neben der Liste. Plan, Ready und Backlog zeigen dann nur die
 * Aufgaben ohne Elternteil, als Karten nebeneinander. Den Baum darunter zeigt
 * der Inspektor (`Hierarchy`), und zwar immer von der Wurzel an – auch wenn
 * gerade eine Unteraufgabe ausgewählt ist.
 *
 * Alles hängt an `layout === 'cards'`; fliegt die Ansicht wieder raus, gehen
 * diese Datei, `cards.css` und die paar Aufrufe mit „Karten“ im Kommentar.
 */

/** Unter diesem Schlüssel merkt sich `collapsed`, ob der Baum im Inspektor zu ist. */
const HIER_KEY = 'inspector:hierarchy';

/** Ob die Karten gerade gelten – nur in Plan, Ready und Backlog. */
export const cardsOn = (s: { layout: string; view: View }): boolean =>
  s.layout === 'cards' && (s.view === 'plan' || s.view === 'ready' || s.view === 'backlog');

/** Die oberste Aufgabe über `id` – deren Baum zeigt der Inspektor. */
export function hierarchyRoot(ws: Workspace, id: string | null): Task | null {
  const task = ws.task(id);
  if (!task || ws.isDoc(task)) return null;
  const root = ws.root(task);
  return ws.kids(root.id).length ? root : null;
}

/** Der Baum ab `root`, aufgeklappt wie in der Liste. */
export function treeRows(ws: Workspace, root: Task, collapsed: Record<string, boolean>): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (t: Task, depth: number): void => {
    rows.push({ type: 'task', id: t.id, task: t, depth });
    // Die Wurzel ist die Karte selbst – sie klappt im Baum nicht zu.
    if (t.id !== root.id && collapsed[t.id]) return;
    for (const k of ws.kids(t.id)) walk(k, depth + 1);
  };
  // Tiefe 1 wie die Aufgaben in einem Behälter der Liste.
  walk(root, 1);
  return rows;
}

/**
 * Aus der Zeilenfolge der Liste die der Karten: Unteraufgaben fallen weg.
 * Für die Tastatur (`keys`) steht hinter der Karte, deren Baum gerade im
 * Inspektor offen ist, dieser Baum – so wandern die Pfeiltasten hinein.
 */
export function cardRows(
  ws: Workspace,
  rows: OutlineRow[],
  selected: string | null,
  collapsed: Record<string, boolean>,
): { shown: OutlineRow[]; keys: OutlineRow[] } {
  const shown = rows.filter((r) => r.type !== 'task' || !r.task.parentId);
  const root = collapsed[HIER_KEY] ? null : hierarchyRoot(ws, selected);
  const keys = shown.flatMap((r) => (root && r.id === root.id ? treeRows(ws, root, collapsed) : [r]));
  return { shown, keys };
}

/** Aufeinanderfolgende Aufgaben werden zu einem Kartenraster zusammengefasst. */
export function chunkCards(rows: OutlineRow[]): (OutlineRow | Task[])[] {
  const out: (OutlineRow | Task[])[] = [];
  for (const r of rows) {
    if (r.type !== 'task') {
      out.push(r);
      continue;
    }
    const last = out[out.length - 1];
    if (Array.isArray(last)) last.push(r.task);
    else out.push([r.task]);
  }
  return out;
}

export function CardGrid({
  ws,
  tasks,
  view,
  menu,
}: {
  ws: Workspace;
  tasks: Task[];
  view: OutlineView;
  menu: Menu;
}) {
  return (
    <div className="card-grid" data-view={view}>
      {tasks.map((t) => (
        <TaskCard key={t.id} ws={ws} task={t} menu={menu} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ Titelbild */

/**
 * Das Titelbild einer Karte, in der kleinen Fassung. Nur das ausdrücklich
 * gesetzte – Bilder in der Beschreibung zählen nicht (Wunsch des Nutzers).
 * Später sollen hier Vorgaben greifen: Task → Kategorie → Projekt.
 */
const coverOf = (task: Task): string | null =>
  task.coverImageId ? imageUrl(task.coverImageId, 'klein') : null;

/**
 * Das Titelbild dezent hinter dem Inspektor – oben bündig, auf Breite gebracht,
 * überdeckt von der Fläche (Wunsch des Nutzers). Nur in der Kartenansicht.
 */
export function useInspectorCover(task: Task | null | undefined): React.CSSProperties | undefined {
  const on = useStore((s) => cardsOn(s));
  if (!on || !task?.coverImageId) return undefined;
  return { '--inspector-cover': `url(${imageUrl(task.coverImageId)})` } as React.CSSProperties;
}

/** Der Ordner der Galerie, in dem hochgeladene Titelbilder landen – je Projekt. */
const COVER_FOLDER = 'Cardimages';

/** Setzt oder entfernt das Titelbild (`null`). */
export async function setCover(task: Task, imageId: string | null): Promise<void> {
  const store = useStore.getState();
  await store.patch('task', task.id, { coverImageId: imageId });
  // Die Galerie soll die neue Verwendung sehen.
  refreshGallery();
  store.say(
    imageId
      ? `Titelbild für „${task.title || 'Ohne Titel'}“ gesetzt`
      : `Titelbild von „${task.title || 'Ohne Titel'}“ entfernt`,
  );
}

/** Der Ordner „Cardimages“ oben im Projekt – legt ihn an, wenn es ihn nicht gibt. */
async function coverFolder(projectId: string): Promise<string> {
  const find = (): string | undefined =>
    useStore
      .getState()
      .folders.find((f) => f.projectId === projectId && !f.parentId && f.name === COVER_FOLDER)?.id;
  // Ohne geladene Galerie kennt der Speicher die Ordner noch nicht.
  if (!useStore.getState().imagesLoaded) await useStore.getState().loadImages();
  const known = find();
  if (known) return known;
  const folder = await api.addFolder({ projectId, parentId: null, name: COVER_FOLDER });
  await useStore.getState().loadImages();
  return folder.id;
}

/**
 * Eine Datei vom Rechner (gezogen oder eingefügt) wird zum Titelbild: wie jedes
 * Bild verkleinert und als WebP hochgeladen, abgelegt in „Cardimages“.
 */
export async function uploadCover(task: Task, list: FileList | File[] | null | undefined): Promise<void> {
  const file = imagesIn(list)[0];
  if (!file) return;
  const store = useStore.getState();
  store.say('Titelbild wird vorbereitet …');
  try {
    const { imageMaxKb, imageMaxEdge } = store.settings;
    const prepared = await prepareImage(file, { maxKb: imageMaxKb, maxEdge: imageMaxEdge });
    const folderId = await coverFolder(task.projectId);
    const meta = await api.addImage({ ...prepared, projectId: task.projectId, folderId });
    const current = useStore.getState().ws?.task(task.id) ?? task;
    await setCover(current, meta.id);
  } catch (e) {
    store.say(
      e instanceof ImageRejected || e instanceof Error ? e.message : 'Das Bild konnte nicht hochgeladen werden.',
    );
  }
}

/** Dateien vom Rechner als Ablage: hervorheben, beim Loslassen hochladen. */
function useFileDrop(task: Task): {
  over: boolean;
  events: Pick<React.HTMLAttributes<HTMLElement>, 'onDragOver' | 'onDragLeave' | 'onDrop'>;
} {
  const [over, setOver] = useState(false);
  return {
    over,
    events: {
      onDragOver: (e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: (e) => {
        // Nur wenn der Zeiger das Element ganz verlässt, nicht beim Wechsel aufs Kind.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
      },
      onDrop: (e) => {
        setOver(false);
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        void uploadCover(task, e.dataTransfer.files);
      },
    },
  };
}

/** Führt die Ablage von Dateien und die aus der Galerie auf einem Element zusammen. */
function mergeDrop(
  files: ReturnType<typeof useFileDrop>['events'],
  gallery: ReturnType<typeof dropTarget>,
): { onDragOver: (e: React.DragEvent<HTMLElement>) => void; onDrop: (e: React.DragEvent<HTMLElement>) => void } {
  return {
    onDragOver: (e) => {
      if (hasFiles(e.dataTransfer)) files.onDragOver?.(e);
      else gallery.onDragOver(e);
    },
    onDrop: (e) => {
      if (hasFiles(e.dataTransfer)) files.onDrop?.(e);
      else gallery.onDrop(e);
    },
  };
}

/**
 * Die Zeile „Titelbild“ im Inspektor – nur in der Kartenansicht. Eine Vorschau
 * gibt es bewusst nicht, das Bild sieht man an der Karte (Wunsch des Nutzers).
 * Ohne Titelbild steht hier ein Ablagefeld: ein Bild aus der Galerie oder vom
 * Rechner daraufziehen, mit Strg+V einfügen (das Feld braucht dafür den Fokus)
 * oder klicken und eine Datei wählen. Mit Titelbild steht hier nur „Entfernen“;
 * die Zeile nimmt aber weiter ein Bild an und ersetzt damit das alte.
 */
export function CoverRow({ task }: { task: Task }) {
  const on = useStore((s) => cardsOn(s));
  const file = useRef<HTMLInputElement>(null);
  const target = { type: 'cover', task } as const;
  const zone = useZone(target);
  const drop = useFileDrop(task);
  if (!on) return null;

  return (
    <div className="m-row" data-r="cover">
      <span className="m-lbl">Titelbild</span>
      <div
        className={`m-val cover-val ${zone || drop.over ? 'dz-on' : ''}`}
        onDragLeave={drop.events.onDragLeave}
        {...mergeDrop(drop.events, dropTarget(target))}
      >
        {task.coverImageId ? (
          <button className="prop" title="Titelbild entfernen" onClick={() => void setCover(task, null)}>
            Entfernen
          </button>
        ) : (
          <div
            className="prop empty cover-drop"
            role="button"
            tabIndex={0}
            title="Bild aus der Galerie oder vom Rechner hierher ziehen, mit Strg+V einfügen oder klicken"
            onClick={() => file.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                file.current?.click();
              }
            }}
            onPaste={(e) => {
              if (!imagesIn(e.clipboardData.files).length) return;
              e.preventDefault();
              void uploadCover(task, e.clipboardData.files);
            }}
          >
            + Bild
          </div>
        )}
        <input
          ref={file}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            void uploadCover(task, e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Karte */

function TaskCard({ ws, task, menu }: { ws: Workspace; task: Task; menu: Menu }) {
  const { selected, select, editing, multi, toggleMulti, rangeMulti, clearMulti } = useStore();
  const target = { type: 'task', task, card: true } as const;
  const zone = useZone(target);
  const files = useFileDrop(task);
  const dragging = useDragging(task.id);
  const kids = ws.kids(task.id);
  const mark = ws.mark(task.markId);
  const cover = coverOf(task);
  const segments = statusSegments(ws, task);
  const cl = checklist(task.desc);
  // Ist eine Unteraufgabe dieser Karte ausgewählt, bleibt die Karte markiert.
  const holds = selected !== task.id && hierarchyRoot(ws, selected)?.id === task.id;
  const implicit =
    !isDone(task) &&
    task.status === 'open' &&
    kids.length > 0 &&
    ws.desc(task).some((d) => d.status === 'progress');

  // Strg+V mit einem Bild in der Zwischenablage macht es zum Titelbild der
  // ausgewählten Karte – solange kein Eingabefeld den Fokus hat.
  const sel = selected === task.id && !multi.size;
  useEffect(() => {
    if (!sel) return;
    const onPaste = (e: ClipboardEvent): void => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      const files = e.clipboardData?.files;
      if (!imagesIn(files).length) return;
      e.preventDefault();
      void uploadCover(task, files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [sel, task]);

  const cell =
    (kind: CellKind) =>
    (e: React.MouseEvent<HTMLElement>): void => {
      e.stopPropagation();
      menu.openAt(e.currentTarget, cellMenu(kind, task.id));
    };

  return (
    // Die Zelle um die Karte ist das Ablageziel und füllt den Abstand zur
    // nächsten mit aus – ohne tote Lücken springt beim Ziehen weder der Zeiger
    // auf „verboten“ noch die Einfügemarke hin und her.
    // Eine Datei vom Rechner auf der Karte wird ihr Titelbild.
    <div
      data-axis="x"
      className={`tcard-cell ${zone ? `dz-${zone}` : ''} ${files.over ? 'dz-into' : ''}`}
      onDragLeave={files.events.onDragLeave}
      {...mergeDrop(files.events, dropTarget(target))}
    >
    <div
      data-row={task.id}
      className={[
        'tcard',
        cover ? 'has-cover' : '',
        multi.has(task.id) ? 'multi' : '',
        sel ? 'sel' : '',
        holds ? 'holds' : '',
        isDone(task) ? 'done' : '',
        dragging ? 'dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey) toggleMulti(task.id);
        else if (e.shiftKey) rangeMulti(task.id);
        else {
          clearMulti();
          select(task.id);
        }
      }}
      {...dragSource('task', task.id, !editing)}
    >
      {cover && <div className="tcard-cover" style={{ backgroundImage: `url(${cover})` }} />}

      <div className="tcard-head">
        {/* Mit Unteraufgaben wird der Titel im Baum des Inspektors bearbeitet. */}
        {editing === task.id && !kids.length ? (
          <TitleEdit kind="task" id={task.id} title={task.title} />
        ) : (
          <span className="tcard-title" onDoubleClick={() => useStore.getState().edit(task.id)}>
            {task.title || <em>Ohne Titel</em>}
          </span>
        )}
      </div>

      {/* Die Markierung steht unten rechts, damit der Titel die volle Breite hat. */}
      {mark && (
        <div className="tcard-mark">
          <span
            className="mk-emoji cell"
            role="button"
            tabIndex={-1}
            title={`${mark.name} – klicken zum Ändern`}
            onClick={cell('mark')}
          >
            {mark.emoji}
          </span>
        </div>
      )}

      <div className="tcard-foot">
        <div className="tcard-meta">
          <StatusDot task={task} implicit={implicit} />
          {task.prio ? (
            <span className="cell" role="button" tabIndex={-1} onClick={cell('prio')}>
              <PrioIcon prio={task.prio} cell />
            </span>
          ) : null}
          {!mark && (
            <span
              className="mk-add cell"
              role="button"
              tabIndex={-1}
              title="Markierung setzen"
              onClick={cell('mark')}
            >
              ＋
            </span>
          )}
          <LockBadge ws={ws} task={task} />
          <ChecklistBadge desc={task.desc} />
          <DrawingBadge ownerId={task.id} />
          {kids.length > 0 && (
            <span className="tcard-count" title={`${doneCount(ws, task)} von ${total(ws, task)} Aufgaben erledigt`}>
              {doneCount(ws, task)}/{total(ws, task)}
            </span>
          )}
        </div>
        {(kids.length > 0 || cl.total > 0) && <SegBar segments={segments} />}
      </div>
    </div>
    </div>
  );
}

/**
 * Der Baum einer Karte im Inspektor: dieselben Zeilen wie in der Liste, mit
 * Auswahl, Ziehen, Kontextmenü und Titelbearbeitung. Er steht am Ende des
 * Inspektors (Wunsch des Nutzers).
 */
export function Hierarchy({ ws, id, menu }: { ws: Workspace; id: string | null; menu: Menu }) {
  const state = useStore();
  const root = cardsOn(state) ? hierarchyRoot(ws, id) : null;
  if (!root) return null;
  const rows = treeRows(ws, root, state.collapsed);
  const current = ws.task(state.selected);
  const open = !state.collapsed[HIER_KEY];

  return (
    <section className={`d-section hier-sec ${open ? '' : 'shut'}`}>
      <div className="h3row">
        <button
          className="hier-toggle"
          onClick={() => state.setCollapsed(HIER_KEY, open)}
          aria-expanded={open}
          title={open ? 'Hierarchie zuklappen' : 'Hierarchie aufklappen'}
        >
          {open ? CHEVRON_DOWN : CHEVRON_RIGHT}
          <h3>
            Hierarchie · {doneCount(ws, root)}/{total(ws, root)}
          </h3>
        </button>
        {open && current && !state.multi.size && (
          <button className="linkish" onClick={() => void addChild(current)}>
            + Unteraufgabe
          </button>
        )}
      </div>
      {open && (
      <div
        className={`list hier ${state.multi.size ? 'has-multi' : ''}`}
        onContextMenu={(e) => {
          const el = e.target as HTMLElement;
          const rid = el.closest('[data-row]')?.getAttribute('data-row');
          if (!rid || el.closest('input, textarea')) return;
          e.preventDefault();
          if (state.multi.has(rid)) {
            menu.openAtPoint(e.clientX, e.clientY, bulkMenu(ws));
            return;
          }
          const row = rows.find((r) => r.id === rid);
          if (!row) return;
          state.clearMulti();
          state.select(rid);
          menu.openAtPoint(e.clientX, e.clientY, rowMenu(ws, row));
        }}
      >
        {rows.map(
          (r) =>
            r.type === 'task' && (
              <TaskRow
                key={r.id}
                ws={ws}
                task={r.task}
                depth={r.depth}
                menu={menu}
                fixed={r.id === root.id}
              />
            ),
        )}
      </div>
      )}
    </section>
  );
}

/** Umschalter Liste/Karten in der Reiterleiste. */
export function LayoutSwitch() {
  const state = useStore();
  const { view, layout, setLayout } = state;
  if (view !== 'plan' && view !== 'ready' && view !== 'backlog') return null;
  return (
    <span className="layout-switch" role="group" aria-label="Darstellung">
      <button className={layout === 'list' ? 'on' : ''} onClick={() => setLayout('list')} title="Als Liste">
        Liste
      </button>
      <button className={layout === 'cards' ? 'on' : ''} onClick={() => setLayout('cards')} title="Als Karten">
        Karten
      </button>
    </span>
  );
}
