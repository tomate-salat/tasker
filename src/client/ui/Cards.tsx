import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { checklist } from '@shared/checklist.js';
import { coverFromLabel, effectiveCover } from '@shared/inherit.js';
import { isDone, type Category, type Mark, type Project, type Task } from '@shared/model.js';
import { categoriesOf, marksOf, type OutlineRow, type OutlineView } from '@shared/outline.js';
import { doneCount, statusSegments, total } from '@shared/progress.js';
import type { Workspace } from '@shared/workspace.js';
import { api, imageUrl } from '../api.js';
import { isLayoutView, useStore, type Layout, type LayoutView, type View } from '../store.js';
import { hasFiles, refreshGallery } from './imageDrop.js';
import { ImageRejected, imagesIn, prepareImage } from './imageFile.js';
import { addChild } from './actions.js';
import { bulkMenu } from './BulkBar.js';
import { cellMenu, type CellKind } from './cellMenu.js';
import { dragSource, dropTarget, type Target, useDrag, useDragging, useZone } from './dnd.js';
import { CARDS_ICON, CHEVRON_DOWN, CHEVRON_RIGHT, LIST_ICON, PrioIcon, SegBar } from './icons.js';
import type { Menu, MenuItem } from './Menu.js';
import { rowMenu } from './rowMenu.js';
import { ChecklistBadge, DrawingBadge, LockBadge, StatusDot, TaskRow, TitleEdit } from './rows.js';
import { startTilt } from './cardTilt.js';
import './cards.css';

/**
 * Die Kartenansicht – ein Versuch, angelehnt an Codecks, auf Wunsch des
 * Nutzers neben der Liste. Plan, Ready, Backlog und Doku wählen das je für
 * sich (`layouts` im Speicher) und zeigen dann nur die Aufgaben bzw. Seiten
 * ohne Elternteil, als Karten nebeneinander. Den Baum darunter zeigt der
 * Inspektor (`Hierarchy`), und zwar immer von der Wurzel an – auch wenn
 * gerade eine Unteraufgabe ausgewählt ist.
 *
 * Bedient wird wie auf dem Tisch (Versuch, Wunsch des Nutzers): ein Klick
 * markiert die Karte nur (`marked` im Speicher) und deckt ihre Unteraufgaben
 * in einer Schublade unter dem Raster auf, erst der Doppelklick öffnet den
 * Inspektor.
 *
 * Alles hängt an `cardsOn`; fliegt die Ansicht wieder raus, gehen
 * diese Datei, `cards.css` und die paar Aufrufe mit „Karten“ im Kommentar.
 * Das Abhängigkeits-Board zeigt seine Tasks mit `CardFace` – es braucht dann
 * wieder eigene Knoten.
 * `cardTilt.ts` bleibt – die Galerie kippt ihre Bilder damit ebenso.
 */

/** Unter diesem Schlüssel merkt sich `collapsed`, ob der Baum im Inspektor zu ist. */
const HIER_KEY = 'inspector:hierarchy';

/** Ob die Karten gerade gelten – je Ansicht gewählt, in Plan, Ready, Backlog und Doku. */
export const cardsOn = (s: { layouts: Record<LayoutView, Layout>; view: View }): boolean =>
  isLayoutView(s.view) && s.layouts[s.view] === 'cards';

/** Welche Schubladen offen sind – das merkt sich das Gerät, wie auf dem Tisch. */
const OPEN_KEY = 'tasker.cardsOpen';

function readOpen(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(OPEN_KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export const useCardsOpen = create<{
  open: Record<string, boolean>;
  toggle: (id: string, value?: boolean) => void;
}>((set, get) => ({
  open: readOpen(),
  toggle: (id, value) => {
    const open = { ...get().open, [id]: value ?? !get().open[id] };
    if (!open[id]) delete open[id];
    try {
      localStorage.setItem(OPEN_KEY, JSON.stringify(open));
    } catch {
      // Privates Fenster – dann eben nur für diese Sitzung.
    }
    set({ open });
  },
}));

/** Die oberste Aufgabe (oder Doku-Seite) über `id` – deren Baum zeigt der Inspektor. */
export function hierarchyRoot(ws: Workspace, id: string | null): Task | null {
  const task = ws.task(id);
  if (!task) return null;
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
 * Für die Tastatur (`keys`) stehen hinter einer Karte die Karten ihrer
 * offenen Schublade – so wandern die Pfeiltasten hinein.
 */
export function cardRows(
  ws: Workspace,
  rows: OutlineRow[],
  open: Record<string, boolean>,
): { shown: OutlineRow[]; keys: OutlineRow[] } {
  const shown = rows.filter((r) => r.type !== 'task' || !r.task.parentId);
  const walk = (t: Task, depth: number): OutlineRow[] => [
    { type: 'task', id: t.id, task: t, depth },
    ...(open[t.id] ? ws.kids(t.id).flatMap((k) => walk(k, depth + 1)) : []),
  ];
  const keys = shown.flatMap((r) => (r.type === 'task' ? walk(r.task, r.depth) : [r]));
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

/** Der Behälter über einem Kartenraster: Milestone oder Gruppe. */
export type CardArea = Extract<Target, { type: 'milestone' } | { type: 'group' }>;

/** Die Kopfzeile direkt über einem Raster als Ablageziel – sonst keins. */
export function cardArea(prev: OutlineRow | Task[] | undefined): CardArea | null {
  if (!prev || Array.isArray(prev)) return null;
  if (prev.type === 'milestone') return { type: 'milestone', milestone: prev.milestone };
  if (prev.type === 'group') return { type: 'group', row: prev };
  return null;
}

/**
 * Das Raster unter einem Milestone oder einer Gruppe (Wunsch des Nutzers):
 * die freie Fläche zwischen und neben den Karten nimmt Abgelegtes auf wie
 * die Kopfzeile und hat deren Kontextmenü (über `data-area` in der Liste).
 * Links und rechts einer Karte gilt weiter „davor/danach“ – die Karten
 * fangen das Ziehen selbst ab.
 */
export function CardGrid({
  ws,
  tasks,
  view,
  menu,
  area,
}: {
  ws: Workspace;
  tasks: Task[];
  view: OutlineView;
  menu: Menu;
  area: CardArea | null;
}) {
  const zone = useZone(area);
  const id = area ? (area.type === 'milestone' ? area.milestone.id : area.row.id) : undefined;
  // Nur Aufgaben – Milestones und Gruppen ordnen sich weiter an den Kopfzeilen um.
  const drop = area ? dropTarget(area) : null;
  const tasksOnly = (f: (e: React.DragEvent) => void) => (e: React.DragEvent) => {
    if (useDrag.getState().drag?.kind === 'task') f(e);
  };
  const open = useCardsOpen((s) => s.open);
  return (
    <>
    <div
      className={`card-grid ${zone ? `dz-${zone}` : ''}`}
      data-view={view}
      data-area={id}
      {...(drop
        ? {
            onDragOver: tasksOnly(drop.onDragOver),
            onDrop: tasksOnly(drop.onDrop),
          }
        : {})}
    >
      {tasks.map((t) => (
        <TaskCard key={t.id} ws={ws} task={t} menu={menu} />
      ))}
    </div>
    {tasks
      .filter((t) => open[t.id] && ws.kids(t.id).length)
      .map((t) => (
        <CardDrawer key={`drawer:${t.id}`} ws={ws} stack={t} path={[t]} view={view} menu={menu} />
      ))}
    </>
  );
}

/**
 * Die Schublade unter dem Raster: die Unteraufgaben einer angeklickten Karte,
 * wieder als Karten – wie auf dem Tisch. Eine Unteraufgabe mit eigenen
 * Unteraufgaben öffnet darin ihre eigene, eingerückte Schublade.
 *
 * Die freie Fläche nimmt Karten auf (Wunsch des Nutzers): dort losgelassen,
 * hängt sich die Karte hinten an die Unteraufgaben an. Zwischen zwei Karten
 * gilt weiter „davor/danach“ – die Karten fangen das Ziehen selbst ab.
 */
function CardDrawer({
  ws,
  stack,
  path,
  view,
  menu,
}: {
  ws: Workspace;
  stack: Task;
  path: Task[];
  view: OutlineView;
  menu: Menu;
}) {
  const { open, toggle } = useCardsOpen();
  const kids = ws.kids(stack.id);
  const lane = { type: 'task', task: stack, lane: true } as const;
  const zone = useZone(lane);
  const drop = dropTarget(lane);
  // Nur Aufgaben – ein Milestone oder ein Bild hat in der Schublade nichts verloren.
  const tasksOnly = (f: (e: React.DragEvent) => void) => (e: React.DragEvent) => {
    if (useDrag.getState().drag?.kind === 'task') f(e);
  };
  return (
    <div
      className={`cdrawer ${zone ? 'dz-into' : ''}`}
      style={{ '--depth': path.length - 1 } as React.CSSProperties}
      onDragOver={tasksOnly(drop.onDragOver)}
      onDrop={tasksOnly(drop.onDrop)}
    >
      <div className="cdrawer-head">
        <span className="cdrawer-path">{path.map((t) => t.title || 'Ohne Titel').join(' › ')}</span>
        <button
          className="icon-btn"
          onClick={() => toggle(stack.id, false)}
          title="Schublade zuklappen"
          aria-label="Schublade zuklappen"
        >
          ✕
        </button>
      </div>
      <div className="card-grid" data-view={view}>
        {kids.map((k, i) => (
          <TaskCard key={k.id} ws={ws} task={k} menu={menu} fan={i} />
        ))}
      </div>
      {kids
        .filter((k) => open[k.id] && ws.kids(k.id).length)
        .map((k) => (
          <CardDrawer key={`drawer:${k.id}`} ws={ws} stack={k} path={[...path, k]} view={view} menu={menu} />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------ Titelbild */

/**
 * Das Titelbild einer Karte, in der kleinen Fassung. Nur ausdrücklich gesetzte
 * Bilder – die in der Beschreibung zählen nicht (Wunsch des Nutzers). Es gilt
 * die Kette Projekt → Markierung → Kategorie → Task → Unteraufgabe, siehe
 * `effectiveCover`.
 */
export const coverOf = (ws: Workspace, task: Task): string | null => {
  const id = effectiveCover(ws, task)?.imageId;
  return id ? imageUrl(id, 'klein') : null;
};

/**
 * Wer ein Titelbild tragen kann: der Task selbst oder – als Vorgabe für alle
 * darunter – Projekt, Kategorie und Markierung.
 */
export type CoverOwner =
  | { kind: 'task'; item: Task }
  | { kind: 'project'; item: Project }
  | { kind: 'category'; item: Category }
  | { kind: 'mark'; item: Mark };

/** Für Meldungen: „Titelbild für … gesetzt“. */
export function coverOwnerLabel(o: CoverOwner): string {
  switch (o.kind) {
    case 'task':
      return `„${o.item.title || 'Ohne Titel'}“`;
    case 'project':
      return `Projekt „${o.item.name}“`;
    case 'category':
      return `Kategorie „${o.item.name}“`;
    case 'mark':
      return `Markierung ${o.item.emoji} ${o.item.name}`;
  }
}

/** Das Projekt, in dessen Galerie ein hochgeladenes Titelbild landet. */
function coverProject(o: CoverOwner): string | null {
  switch (o.kind) {
    case 'task':
    case 'category':
    case 'mark':
      return o.item.projectId;
    case 'project':
      return o.item.id;
  }
}

/**
 * Das Titelbild dezent hinter dem Inspektor – oben bündig, auf Breite gebracht,
 * unten weich ausgeblendet (Wunsch des Nutzers). In jeder Ansicht – auch wo
 * die Liste keine Titelbilder zeigt, soll der Inspektor sie zeigen.
 * Ein echtes Bild statt eines Hintergrunds, damit der Verlauf an seinem
 * eigenen unteren Rand sitzt, egal wie hoch es ist.
 */
export function InspectorCover({ ws, task }: { ws: Workspace; task: Task | null | undefined }) {
  const id = task && effectiveCover(ws, task)?.imageId;
  if (!id) return null;
  return (
    <div className="d-cover" aria-hidden>
      <img src={imageUrl(id)} alt="" />
    </div>
  );
}

/**
 * Die Einträge „Als Titelbild für …“ im Kontextmenü der Galerie: als Vorgabe
 * für jedes Projekt, jede Kategorie und jede Markierung – so lassen sich Bilder
 * aus der Galerie auch dafür verwenden. Für den Task selbst gibt es hier nichts,
 * dafür zieht man das Bild auf Karte oder Inspektor (Wunsch des Nutzers).
 * Projekte, Kategorien und Markierungen nur die des gewählten Projekts, unter
 * „Alle Projekte“ alle, Kategorien und Markierungen dann nach Projekt überschrieben.
 */
export function coverMenu(ws: Workspace, projectId: string | null, imageId: string | null): MenuItem[] {
  const scoped = ws.project(projectId);
  const projects = scoped ? [scoped] : ws.projects;
  const item = (o: CoverOwner, label = coverOwnerLabel(o)): MenuItem => ({
    label,
    disabled: !imageId,
    check: !!imageId && o.item.coverImageId === imageId,
    onSelect: () => {
      if (imageId) void setCover(o, imageId);
    },
  });
  const categories = projects.flatMap((p): MenuItem[] => {
    const list = categoriesOf(ws, p.id);
    if (!list.length) return [];
    return [
      ...(projects.length > 1 ? [{ head: p.name }] : []),
      ...list.map((c) => item({ kind: 'category', item: c }, c.name)),
    ];
  });
  const marks = projects.flatMap((p): MenuItem[] => {
    const list = marksOf(ws, p.id);
    if (!list.length) return [];
    return [
      ...(projects.length > 1 ? [{ head: p.name }] : []),
      ...list.map((k) => item({ kind: 'mark', item: k }, `${k.emoji} ${k.name}`)),
    ];
  });
  const group = (label: string, sub: MenuItem[]): MenuItem[] =>
    sub.length ? [{ label, disabled: !imageId, sub }] : [];

  return [
    ...group(
      'Als Titelbild für Projekt',
      projects.map((p) => item({ kind: 'project', item: p }, p.name)),
    ),
    ...group('Als Titelbild für Kategorie', categories),
    ...group('Als Titelbild für Markierung', marks),
  ];
}

/** Der Ordner der Galerie, in dem hochgeladene Titelbilder landen – je Projekt. */
const COVER_FOLDER = 'Cardimages';

/** Setzt oder entfernt das Titelbild (`null`) – am Task oder als Vorgabe. */
export async function setCover(owner: CoverOwner, imageId: string | null): Promise<void> {
  const store = useStore.getState();
  await store.patch(owner.kind, owner.item.id, { coverImageId: imageId });
  // Die Galerie soll die neue Verwendung sehen.
  refreshGallery();
  store.say(
    imageId ? `Titelbild für ${coverOwnerLabel(owner)} gesetzt` : `Titelbild von ${coverOwnerLabel(owner)} entfernt`,
  );
}

/** Der Ordner „Cardimages“ oben im Projekt – legt ihn an, wenn es ihn nicht gibt. */
async function coverFolder(projectId: string | null): Promise<string> {
  const find = (): string | undefined =>
    useStore.getState().folders.find((f) => f.projectId === projectId && !f.parentId && f.name === COVER_FOLDER)?.id;
  // Ohne geladene Galerie kennt der Speicher die Ordner noch nicht.
  if (!useStore.getState().imagesLoaded) await useStore.getState().loadImages();
  const known = find();
  if (known) return known;
  const folder = await api.addFolder({
    projectId,
    parentId: null,
    name: COVER_FOLDER,
  });
  await useStore.getState().loadImages();
  return folder.id;
}

/**
 * Eine Datei vom Rechner (gezogen oder eingefügt) wird zum Titelbild: wie jedes
 * Bild verkleinert und als WebP hochgeladen, abgelegt in „Cardimages“.
 */
export async function uploadCover(owner: CoverOwner, list: FileList | File[] | null | undefined): Promise<void> {
  const file = imagesIn(list)[0];
  if (!file) return;
  const store = useStore.getState();
  store.say('Titelbild wird vorbereitet …');
  try {
    const { imageMaxKb, imageMaxEdge } = store.settings;
    const prepared = await prepareImage(file, {
      maxKb: imageMaxKb,
      maxEdge: imageMaxEdge,
    });
    const projectId = coverProject(owner);
    const folderId = await coverFolder(projectId);
    const meta = await api.addImage({ ...prepared, projectId, folderId });
    await setCover(owner, meta.id);
  } catch (e) {
    store.say(
      e instanceof ImageRejected || e instanceof Error ? e.message : 'Das Bild konnte nicht hochgeladen werden.',
    );
  }
}

/** Dateien vom Rechner als Ablage: hervorheben, beim Loslassen hochladen. */
function useFileDrop(owner: CoverOwner): {
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
        void uploadCover(owner, e.dataTransfer.files);
      },
    },
  };
}

/** Führt die Ablage von Dateien und die aus der Galerie auf einem Element zusammen. */
function mergeDrop(
  files: ReturnType<typeof useFileDrop>['events'],
  gallery: ReturnType<typeof dropTarget>,
): {
  onDragOver: (e: React.DragEvent<HTMLElement>) => void;
  onDrop: (e: React.DragEvent<HTMLElement>) => void;
} {
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
 * Die Zeile „Titelbild“ im Inspektor – in jeder Ansicht. Eine Vorschau
 * gibt es bewusst nicht, das Bild sieht man an der Karte (Wunsch des Nutzers).
 * Ohne Titelbild steht hier ein Ablagefeld: ein Bild aus der Galerie oder vom
 * Rechner daraufziehen, mit Strg+V einfügen (das Feld braucht dafür den Fokus)
 * oder klicken und eine Datei wählen. Mit Titelbild steht hier nur „Entfernen“;
 * die Zeile nimmt aber weiter ein Bild an und ersetzt damit das alte.
 * Erbt der Task das Bild (vom Elternteil oder als Vorgabe von Kategorie,
 * Markierung oder Projekt), bleibt das Ablagefeld – ein eigenes Bild
 * überschreibt das geerbte, „Entfernen“ gibt es nur für das eigene.
 */
export function CoverRow({ ws, task }: { ws: Workspace; task: Task }) {
  const from = task.coverImageId ? null : effectiveCover(ws, task)?.from;
  const file = useRef<HTMLInputElement>(null);
  const owner: CoverOwner = { kind: 'task', item: task };
  const target = { type: 'cover', task } as const;
  const zone = useZone(target);
  const drop = useFileDrop(owner);

  return (
    <div className="m-row" data-r="cover">
      <span className="m-lbl">Titelbild</span>
      <div
        className={`m-val cover-val ${zone || drop.over ? 'dz-on' : ''}`}
        onDragLeave={drop.events.onDragLeave}
        {...mergeDrop(drop.events, dropTarget(target))}
      >
        {task.coverImageId ? (
          <button className="prop" title="Titelbild entfernen" onClick={() => void setCover(owner, null)}>
            Entfernen
          </button>
        ) : (
          <div
            className="prop empty cover-drop"
            role="button"
            tabIndex={0}
            title={
              (from ? `Geerbt von ${coverFromLabel(from)} – ein eigenes Bild überschreibt es.\n` : '') +
              'Bild aus der Galerie oder vom Rechner hierher ziehen, mit Strg+V einfügen oder klicken'
            }
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
              void uploadCover(owner, e.clipboardData.files);
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
            void uploadCover(owner, e.target.files);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

/**
 * Das Titelbild als Vorgabe an Projekt, Kategorie oder Markierung – ein kleines
 * Feld in deren Verwaltungsdialog. Ohne Bild ein Ablagefeld (Datei vom Rechner
 * daraufziehen, Strg+V, Klick für den Dateidialog), mit Bild ein Vorschaubild
 * zum Ersetzen und ✕ zum Entfernen. Aus der Galerie geht es über deren
 * Kontextmenü, weil der Dialog die Galerie verdeckt.
 */
export function CoverSlot({ owner }: { owner: Exclude<CoverOwner, { kind: 'task' }> }) {
  const file = useRef<HTMLInputElement>(null);
  const drop = useFileDrop(owner);
  const id = owner.item.coverImageId;
  const pick = (): void => file.current?.click();

  return (
    <span className={`cover-slot ${drop.over ? 'dz-on' : ''}`} {...drop.events}>
      <span
        className={`cover-slot-pic ${id ? '' : 'empty'}`}
        role="button"
        tabIndex={0}
        style={id ? { backgroundImage: `url(${imageUrl(id, 'klein')})` } : undefined}
        title={
          `Titelbild-Vorgabe für ${coverOwnerLabel(owner)} – gilt für alle Karten darunter ohne eigenes.\n` +
          (id
            ? 'Klicken, ein Bild hierher ziehen oder Strg+V ersetzt es.'
            : 'Klicken, ein Bild hierher ziehen oder Strg+V.')
        }
        aria-label={`Titelbild für ${coverOwnerLabel(owner)}`}
        onClick={pick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        }}
        onPaste={(e) => {
          if (!imagesIn(e.clipboardData.files).length) return;
          e.preventDefault();
          void uploadCover(owner, e.clipboardData.files);
        }}
      >
        {id ? null : '+'}
      </span>
      {id && (
        <button
          className="icon-btn cover-slot-del"
          title="Titelbild entfernen"
          aria-label={`Titelbild von ${coverOwnerLabel(owner)} entfernen`}
          onClick={() => void setCover(owner, null)}
        >
          ✕
        </button>
      )}
      <input
        ref={file}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void uploadCover(owner, e.target.files);
          e.target.value = '';
        }}
      />
    </span>
  );
}

/* ---------------------------------------------------------------- Karte */

function TaskCard({
  ws,
  task,
  menu,
  fan,
}: {
  ws: Workspace;
  task: Task;
  menu: Menu;
  /** In einer Schublade: die wievielte Karte – sie fächern versetzt heraus. */
  fan?: number;
}) {
  const { selected, select, marked, mark, editing, multi, toggleMulti, rangeMulti, clearMulti } = useStore();
  const drawer = useCardsOpen();
  const target = { type: 'task', task, card: true } as const;
  const zone = useZone(target);
  const files = useFileDrop({ kind: 'task', item: task });
  const dragging = useDragging(task.id);
  const kids = ws.kids(task.id);
  // Ist eine Unteraufgabe dieser Karte ausgewählt, bleibt die Karte markiert.
  const holds = selected !== task.id && hierarchyRoot(ws, selected)?.id === task.id;
  // Karten kippen beim Ziehen in die Bewegungsrichtung (`cardTilt.ts`).
  const drag = dragSource('task', task.id, !editing);

  // Strg+V mit einem Bild in der Zwischenablage macht es zum Titelbild der
  // markierten Karte – solange kein Eingabefeld den Fokus hat.
  const sel = selected === task.id && !multi.size;
  const focused = marked === task.id && !multi.size;
  const pastes = marked ? focused : sel;
  useEffect(() => {
    if (!pastes) return;
    const onPaste = (e: ClipboardEvent): void => {
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el?.closest('input, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      const files = e.clipboardData?.files;
      if (!imagesIn(files).length) return;
      e.preventDefault();
      void uploadCover({ kind: 'task', item: task }, files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [pastes, task]);

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
      className={`tcard-cell ${zone ? `dz-${zone}` : ''} ${files.over ? 'dz-into' : ''} ${fan === undefined ? '' : 'cfan'} ${kids.length ? 'is-stack' : ''}`}
      style={fan === undefined ? undefined : ({ '--i': Math.min(fan, 14) } as React.CSSProperties)}
      onDragLeave={files.events.onDragLeave}
      {...mergeDrop(files.events, dropTarget(target))}
    >
      {/* Mit Unteraufgaben ein Stapel, wie auf dem Tisch: zwei Kartenkanten dahinter.
          Eigene Elemente – `::before` und `::after` der Zelle sind die Einfügemarken. */}
      {kids.length > 0 && (
        <>
          <i className="tstack-edge" aria-hidden />
          <i className="tstack-edge" aria-hidden />
        </>
      )}
      <div
        data-row={task.id}
        className={[
          'tcard',
          multi.has(task.id) ? 'multi' : '',
          sel ? 'sel' : '',
          focused ? 'focus' : '',
          kids.length && drawer.open[task.id] ? 'drawer-open' : '',
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
            // Wie auf dem Tisch: ein Klick markiert (und deckt die Unteraufgaben
            // auf oder räumt sie weg), erst der zweite Klick eines Doppelklicks
            // öffnet den Inspektor.
            clearMulti();
            mark(task.id);
            if (e.detail >= 2) select(task.id);
            else if (kids.length) drawer.toggle(task.id);
          }
        }}
        {...drag}
        onDragStart={(e) => {
          drag.onDragStart(e);
          startTilt(e);
        }}
      >
        <CardFace
          ws={ws}
          task={task}
          onCell={cell}
          // Mit Unteraufgaben wird der Titel im Baum des Inspektors bearbeitet.
          titleEdit={
            editing === task.id && !kids.length ? <TitleEdit kind="task" id={task.id} title={task.title} /> : undefined
          }
        />
      </div>
    </div>
  );
}

/**
 * Das Innere einer Karte: Titelbild, Titel und Fuß – in der Kartenansicht und
 * auf dem Abhängigkeits-Board gleich (Wunsch des Nutzers). Ohne `onCell` lässt
 * sich darin nichts anklicken – so zeigt das Board seine Tasks.
 *
 * `crumb`: über dem Titel steht, zu welchen Eltern-Tasks eine Unteraufgabe
 * gehört („Icons › App-Icons ›“) – auf dem Tisch im Spiel und auf dem Board,
 * wo Unteraufgaben sonst nicht als solche zu erkennen sind.
 */
export function CardFace({
  ws,
  task,
  titleEdit,
  onTitleDoubleClick,
  onCell,
  crumb = false,
}: {
  ws: Workspace;
  task: Task;
  crumb?: boolean;
  /** Steht statt des Titels da, solange er bearbeitet wird. */
  titleEdit?: React.ReactNode;
  onTitleDoubleClick?: () => void;
  onCell?: (kind: CellKind) => (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const kids = ws.kids(task.id);
  // Zähler und Balken zählen erledigt Archiviertes mit (siehe `countedKids`).
  const counted = ws.countedKids(task.id).length;
  const doc = ws.isDoc(task);
  const mark = ws.mark(task.markId);
  const cover = coverOf(ws, task);
  const segments = statusSegments(ws, task);
  const cl = checklist(task.desc);
  const implicit =
    !isDone(task) && task.status === 'open' && kids.length > 0 && ws.desc(task).some((d) => d.status === 'progress');
  const cellProps = (kind: CellKind) => (onCell ? { role: 'button', tabIndex: -1, onClick: onCell(kind) } : {});

  return (
    <>
      {cover && <div className="tcard-cover" style={{ backgroundImage: `url(${cover})` }} />}
      {crumb && <Crumb ws={ws} task={task} />}

      {/* Die Markierung steht als Zeichen vor dem Titel und bricht mit ihm um
          (Wunsch des Nutzers) – anklickbar wie die Zellen im Fuß. */}
      <div className="tcard-head">
        {titleEdit ?? (
          <span className="tcard-title" onDoubleClick={onTitleDoubleClick}>
            {mark && (
              <>
                <span
                  className="tcard-title-mark cell"
                  title={onCell ? `${mark.name} – klicken zum Ändern` : mark.name}
                  {...cellProps('mark')}
                >
                  {mark.emoji}
                </span>{' '}
              </>
            )}
            {task.title || <em>Ohne Titel</em>}
          </span>
        )}
      </div>

      {/* Eine Doku-Seite hat wie im Inspektor weder Status noch Priorität noch Fortschritt. */}
      <div className={`tcard-foot${doc ? '' : ` st-${task.status}`}`}>
        <div className="tcard-meta">
          {!doc && <StatusDot task={task} implicit={implicit} />}
          {/* Die Priorität steht immer da, auch ohne – wie in der Liste. */}
          {!doc && (
            <span className="cell" {...cellProps('prio')}>
              <PrioIcon prio={task.prio} cell={!!onCell} />
            </span>
          )}
          {/* Abzeichen und Zähler rücken nach rechts, Status und Priorität bleiben links. */}
          <span className="tcard-badges">
            <LockBadge ws={ws} task={task} />
            {/* Mit Unteraufgaben zählt die Checkliste im Zähler mit (Wunsch des Nutzers) –
                zwei Zähler nebeneinander sprengen die Karte. */}
            {(doc || !counted) && <ChecklistBadge desc={task.desc} />}
            <DrawingBadge ownerId={task.id} />
            {doc
              ? kids.length > 0 && (
                  <span
                    className="tcard-count"
                    title={`${kids.length} ${kids.length === 1 ? 'Unterseite' : 'Unterseiten'}`}
                  >
                    {kids.length}
                  </span>
                )
              : counted > 0 && (
                  <span
                    className="tcard-count"
                    title={
                      cl.total
                        ? `${doneCount(ws, task)} von ${total(ws, task)} Aufgaben und ${cl.done} von ${cl.total} Checklisten-Punkten erledigt`
                        : `${doneCount(ws, task)} von ${total(ws, task)} Aufgaben erledigt`
                    }
                  >
                    {doneCount(ws, task) + cl.done}/{total(ws, task) + cl.total}
                  </span>
                )}
          </span>
        </div>
        {!doc && (counted > 0 || cl.total > 0) && <SegBar segments={segments} />}
      </div>
    </>
  );
}

function Crumb({ ws, task }: { ws: Workspace; task: Task }) {
  const up = ws.ancestors(task);
  if (!up.length) return null;
  const path = up.map((a) => a.title || 'Ohne Titel').join(' › ');
  return (
    <div className="tcard-crumb" title={path}>
      {path} ›
    </div>
  );
}

/**
 * Der Baum im Inspektor: dieselben Zeilen wie in der Liste, mit Auswahl,
 * Ziehen, Kontextmenü und Titelbearbeitung. Er steht am Ende des Inspektors
 * (Wunsch des Nutzers) – in der Karten- wie in der Listenansicht, ein
 * Inspektor für beide.
 */
export function Hierarchy({ ws, id, menu }: { ws: Workspace; id: string | null; menu: Menu }) {
  const state = useStore();
  // Ohne Unteraufgaben steht der Abschnitt trotzdem da – nur mit dem Knopf zum
  // Anlegen, damit er nicht beim ersten Kind von „Unteraufgaben“ umspringt.
  const task = ws.task(id);
  const root = hierarchyRoot(ws, id) ?? (task ? ws.root(task) : null);
  if (!root) return null;
  const empty = !ws.kids(root.id).length;
  const rows = treeRows(ws, root, state.collapsed);
  const current = ws.task(state.selected);
  const open = !state.collapsed[HIER_KEY];
  const doc = ws.isDoc(root);
  // Neben der Liste wird der Titel dort bearbeitet, nicht im Baum. Bewusst ohne
  // `visible`: das meldet die Liste erst nach dem Zeichnen – im ersten Durchgang
  // stünden sonst doch zwei Eingabefelder da.
  const listEdits = isLayoutView(state.view) && !cardsOn(state);

  return (
    <section className={`d-section hier-sec ${open && !empty ? '' : 'shut'}`}>
      <div className="h3row">
        {/* Ohne Unteraufgaben gibt es nichts zu klappen – nur die Überschrift. */}
        {empty ? (
          <h3>Hierarchie</h3>
        ) : (
          <button
            className="hier-toggle"
            onClick={() => state.setCollapsed(HIER_KEY, open)}
            aria-expanded={open}
            title={open ? 'Hierarchie zuklappen' : 'Hierarchie aufklappen'}
          >
            {open ? CHEVRON_DOWN : CHEVRON_RIGHT}
            <h3>{doc ? 'Hierarchie' : `Hierarchie · ${doneCount(ws, root)}/${total(ws, root)}`}</h3>
          </button>
        )}
        {(open || empty) && current && !state.multi.size && (
          <button className="linkish" onClick={() => void addChild(current)}>
            {doc ? '+ Unterseite' : '+ Unteraufgabe'}
          </button>
        )}
      </div>
      {open && !empty && (
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
                  doc={doc}
                  menu={menu}
                  fixed={r.id === root.id}
                  compact
                  noEdit={listEdits}
                />
              ),
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Umschalter Liste/Karten rechts in der Titelzeile: ein Icon-Knopf, der auf
 * die jeweils andere Darstellung wechselt.
 */
export function LayoutSwitch() {
  const state = useStore();
  const { view, layouts, setLayout } = state;
  if (!isLayoutView(view)) return null;
  const other: Layout = layouts[view] === 'list' ? 'cards' : 'list';
  const label = other === 'cards' ? 'Als Karten' : 'Als Liste';
  return (
    <button className="head-icon" onClick={() => setLayout(view, other)} title={label} aria-label={label}>
      {other === 'cards' ? CARDS_ICON : LIST_ICON}
    </button>
  );
}
