import { useEffect, useMemo, useRef, useState } from 'react';
import { dependsOn, inheritedBlock } from '@shared/blocking.js';
import { checklist } from '@shared/checklist.js';
import { effectiveCategory, effectiveTags, projectTags } from '@shared/inherit.js';
import { isArchived, isDone, type Milestone, type Status, type Task } from '@shared/model.js';
import { areaLabel, placeLabel } from '@shared/outline.js';
import {
  allDone,
  doneCount,
  milestoneDone,
  milestoneStats,
  statusSegments,
  total,
} from '@shared/progress.js';
import { schedule } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { imageMarkdown } from '../api.js';
import { useStore } from '../store.js';
import { Burnup } from './Burnup.js';
import { cardsOn, CoverRow, Hierarchy, hierarchyRoot, InspectorCover } from './Cards.js';
import { categoryHue, tagHue } from './colors.js';
import { dropTarget, useDrag, useZone } from './dnd.js';
import { DrawingEmbed, useDrawings } from './Drawings.js';
import {
  DEFAULT_MARK,
  DOC_ICON,
  MS_STATUS,
  PRIO_LABEL,
  PrioIcon,
  SegBar,
  STATUS_LABEL,
  StatusIcon,
} from './icons.js';
import {
  appendMarkdown,
  hasFiles,
  insertAtCursor,
  refreshGallery,
  useFileOver,
  useUpload,
} from './imageDrop.js';
import { imagesIn } from './imageFile.js';
import { markdownParts, checkboxClick } from './markdown.js';
import { focusAtEnd, useSmartEditor } from './editor.js';
import { refClick, useRefResolver } from './refs.js';
import { categorySub, docMenu, markSub, milestoneMenu, taskMenu } from './rowMenu.js';
import { type MenuItem, PropButton, useMenu } from './Menu.js';

/** Fortschrittskette links, Sonderstatus rechts – zusammen eine Auswahl. */
const PROGRESS_CHAIN: Status[] = ['open', 'progress', 'done'];
const SPECIAL: Status[] = ['unclear', 'blocked'];
const MS_KEYS: Status[] = ['open', 'progress', 'done'];

/**
 * Der Inspektor, Aufbau wie im Prototyp: oben der Pfad, darunter ein Raster
 * aus beschrifteten Werten, dann der Inhalt (Titel und Markdown in einem
 * Feld), die Unteraufgaben und die Abhängigkeiten.
 */
export function Inspector({ ws, id }: { ws: Workspace; id: string }) {
  const task = ws.task(id);
  const milestone = ws.milestone(id);
  const select = useStore((s) => s.select);
  const menu = useMenu();
  const hier = useStore((s) => cardsOn(s)) && !!hierarchyRoot(ws, id);

  // Der Inhalt wird als Ganzes bearbeitet – beim Wechsel des Objekts zurück.
  const [editing, setEditing] = useState(false);
  useEffect(() => setEditing(false), [id]);

  if (!task && !milestone) return null;
  const kind = task ? 'task' : 'milestone';
  const item = (task ?? milestone) as Task | Milestone;

  return (
    <aside className="detail">
      {/* Karten: das Titelbild liegt dezent im Hintergrund. */}
      <InspectorCover task={task} />
      <div className="d-top">
        <Crumbs ws={ws} task={task} milestone={milestone} />
        <button
          className="icon-btn"
          title="Weitere Aktionen"
          aria-label="Weitere Aktionen"
          aria-haspopup="menu"
          onClick={(e) => menu.openAt(e.currentTarget, moreMenu(ws, kind, item), e.detail === 0)}
        >
          ⋯
        </button>
        <button className="icon-btn" onClick={() => select(null)} aria-label="Details schließen">
          ✕
        </button>
      </div>

      <ArchiveBanner ws={ws} kind={kind} item={item} />

      <div className="d-head">
        {task && <TaskHead ws={ws} task={task} menu={menu} />}
        {milestone && <MilestoneHead ws={ws} milestone={milestone} />}
      </div>

      <Content
        ws={ws}
        kind={kind}
        item={item}
        editing={editing}
        setEditing={setEditing}
        placeholder={task ? 'Ohne Titel' : 'Neuer Milestone'}
      />

      {task && !hier && <TaskChildren ws={ws} task={task} />}
      {milestone && <Burnup ws={ws} milestone={milestone} />}
      {milestone && <MilestoneChildren ws={ws} milestone={milestone} />}

      {/* Doku-Seiten haben wie im Prototyp keine Abhängigkeiten. */}
      {!(task && ws.isDoc(task)) && <Deps ws={ws} kind={kind} item={item} />}

      {/* Karten: der ganze Baum der Karte am Ende, auch bei einer Unteraufgabe. */}
      {hier && <Hierarchy ws={ws} id={id} menu={menu} />}

      {menu.node}
    </aside>
  );
}

/* ------------------------------------------------------------------ Pfad */

function Crumbs({
  ws,
  task,
  milestone,
}: {
  ws: Workspace;
  task: Task | null;
  milestone: Milestone | null;
}) {
  const select = useStore((s) => s.select);
  const projectId = (task ?? milestone)?.projectId ?? null;
  const project = ws.project(projectId);

  const link = (t: Task | Milestone, label: string) => (
    <button key={t.id} className="linkish" onClick={() => select(t.id)}>
      {label}
    </button>
  );

  const middle: React.ReactNode[] = [];
  if (milestone) {
    middle.push(<span key="plan">{milestone.planned ? 'Plan' : 'Backlog'}</span>);
    middle.push(
      <span key="kind" className="kind">
        ◆ Milestone
      </span>,
    );
  } else if (task) {
    const root = ws.root(task);
    const ms = ws.milestone(root.milestoneId);
    if (ms) middle.push(link(ms, `◆ ${ms.title || 'Ohne Titel'}`));
    // Wie im Prototyp als Text – das Symbol-Raster brach hier die Zeile um.
    else if (root.doc) middle.push(<span key="doc">📄 Dokumentation</span>);
    else {
      middle.push(<span key="bl">{areaLabel(ws, root)}</span>);
      middle.push(<span key="grp">{placeLabel(ws, root)}</span>);
    }
    for (const a of ws.ancestors(task)) middle.push(link(a, a.title || 'Ohne Titel'));
  }

  return (
    <div className="crumbs">
      {project && (
        <>
          <span className="dot" style={{ background: project.color }} aria-hidden="true" />
          {project.name}
        </>
      )}
      {middle.map((node, i) => (
        <span key={i} className="crumb">
          <span aria-hidden="true">›</span> {node}
        </span>
      ))}
      {(task ?? milestone) && <RefNo item={(task ?? milestone) as Task | Milestone} />}
    </div>
  );
}

/** Die Verweis-Nummer; ein Klick kopiert `$142` zum Einfügen in einen anderen Text. */
function RefNo({ item }: { item: Task | Milestone }) {
  const say = useStore((s) => s.say);
  const text = `$${item.ref}`;
  return (
    <button
      className="ref-no"
      title={`Verweis-Nummer – ${text} in einem Text verlinkt hierher. Klicken zum Kopieren.`}
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => say(`${text} kopiert`))
          .catch(() => say(`Kopieren nicht möglich – die Nummer ist ${text}`))
      }
    >
      {text}
    </button>
  );
}

/** Archiviertes bleibt sichtbar, sagt aber deutlich, dass es beiseitegelegt ist. */
function ArchiveBanner({
  ws,
  kind,
  item,
}: {
  ws: Workspace;
  kind: 'task' | 'milestone';
  item: Task | Milestone;
}) {
  const { unarchive, select } = useStore();

  if (isArchived(item)) {
    return (
      <div className="arch-banner">
        <span>Archiviert am {new Date(item.archivedAt as string).toLocaleDateString('de-DE')}</span>
        <button className="btn tiny" onClick={() => void unarchive(kind, item.id)}>
          ↩ Wiederherstellen
        </button>
      </div>
    );
  }

  // Nicht selbst archiviert, aber in etwas Archiviertem – dann zeigt der
  // Hinweis auf den Träger, sonst wirkt die Aufgabe grundlos verschwunden.
  if (kind !== 'task') return null;
  const task = item as Task;
  const holder =
    [...ws.ancestors(task)].reverse().find(isArchived) ??
    (ws.milestoneOf(task) && isArchived(ws.milestoneOf(task) as Milestone)
      ? ws.milestoneOf(task)
      : null);
  if (!holder) return null;

  return (
    <div className="arch-banner">
      <span>Liegt in einem archivierten {'planned' in holder ? 'Milestone' : 'Task'}:</span>
      <button className="linkish" onClick={() => select(holder.id)}>
        {holder.title}
      </button>
    </div>
  );
}

/* ------------------------------------------------------------ Kopf: Task */

function TaskHead({
  ws,
  task,
  menu,
}: {
  ws: Workspace;
  task: Task;
  menu: ReturnType<typeof useMenu>;
}) {
  const patch = useStore((s) => s.patch);
  const kids = ws.kids(task.id);
  const cl = checklist(task.desc);
  const cat = effectiveCategory(ws, task);
  const mark = ws.mark(task.markId);
  const tags = effectiveTags(ws, task);

  const catIndex = cat
    ? ws.categories
        .filter((c) => c.projectId === cat.category.projectId)
        .sort((a, b) => a.order - b.order)
        .findIndex((c) => c.id === cat.category.id)
    : 0;

  // Wie im Prototyp hat eine Doku-Seite keinen Status, keinen Fortschritt und
  // keine Priorität – nur Kategorie, Markierung und Labels.
  const doc = ws.isDoc(task);

  return (
    <>
      {!doc && (
        // Karten: rechts neben dem Status steht das Titelbild (nur in der Kartenansicht).
        <div className="status-line">
          <MetaRow k="status" label="Status">
            <StatusGroups kind="task" item={task} groups={[PROGRESS_CHAIN, SPECIAL]} labels={STATUS_LABEL} />
          </MetaRow>
          <CoverRow task={task} />
        </div>
      )}

      {!doc && (cl.total > 0 || kids.length > 0) && (
        <MetaRow k="prog" label="Fortschritt">
          <SegBar segments={statusSegments(ws, task)} />
        </MetaRow>
      )}

      {!doc && (
        <MetaRow k="prio" label="Priorität">
          <PropButton
            menu={menu}
            empty={!task.prio}
            title="Priorität"
            items={() =>
              ([0, 1, 2, 3] as const).map((v) => ({
                label: v ? `P${v} · ${PRIO_LABEL[v]}` : 'Keine',
                check: task.prio === v,
                onSelect: () => void patch('task', task.id, { prio: v }),
              }))
            }
          >
            {task.prio ? (
              <>
                <PrioIcon prio={task.prio} />
                {PRIO_LABEL[task.prio]}
              </>
            ) : (
              'Keine'
            )}
          </PropButton>
        </MetaRow>
      )}

      <MetaRow k="cat" label="Kategorie">
        <PropButton
          menu={menu}
          empty={!cat || !!cat.from}
          title={cat?.from ? `Kategorie – geerbt von „${cat.from.title}“` : 'Kategorie'}
          items={() => categorySub(ws, task)}
        >
          {cat ? (
            <>
              <span className="cat-sw" style={{ '--h': categoryHue(catIndex) } as React.CSSProperties} />
              <span className={cat.from ? 'inherited-val' : ''}>
                {cat.category.name}
                {cat.from ? ' · geerbt' : ''}
              </span>
            </>
          ) : (
            'Keine'
          )}
        </PropButton>
      </MetaRow>

      <MetaRow k="mark" label="Markierung">
        <PropButton menu={menu} empty={!mark} title="Markierung" items={() => markSub(ws, task)}>
          {mark ? `${mark.emoji} ${mark.name}` : 'Keine'}
        </PropButton>
      </MetaRow>

      <MetaRow k="tags" label="Labels">
        {task.tags.map((tag) => (
          <span key={tag} className="tag" style={{ '--h': tagHue(tag) } as React.CSSProperties}>
            {tag}
            <button
              aria-label={`Label ${tag} entfernen`}
              onClick={() =>
                void patch('task', task.id, { tags: task.tags.filter((g) => g !== tag) })
              }
            >
              ×
            </button>
          </span>
        ))}
        {tags.extra.map((x) => (
          <span
            key={x.tag}
            className="tag inherited-val"
            style={{ '--h': tagHue(x.tag) } as React.CSSProperties}
            title={`Aus Unteraufgabe „${x.from.title}“ – hier nur angezeigt`}
          >
            {x.tag}
          </span>
        ))}
        <TagInput ws={ws} task={task} />
      </MetaRow>
    </>
  );
}

/** Neues Label mit Vorschlägen aus denen des eigenen Projekts. */
function TagInput({ ws, task }: { ws: Workspace; task: Task }) {
  const patch = useStore((s) => s.patch);
  const [value, setValue] = useState('');
  const all = useMemo(
    () => projectTags(ws, [task.projectId]).filter((g) => !task.tags.includes(g)),
    [ws, task.projectId, task.tags],
  );

  const commit = (): void => {
    const tag = value.trim();
    setValue('');
    if (tag && !task.tags.includes(tag)) void patch('task', task.id, { tags: [...task.tags, tag] });
  };

  return (
    <>
      <input
        id="d-tag"
        className="prop-tag"
        list="tag-list"
        placeholder="+ Label"
        aria-label="Label hinzufügen"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') setValue('');
        }}
      />
      <datalist id="tag-list">
        {all.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
    </>
  );
}

/* ------------------------------------------------------- Kopf: Milestone */

function MilestoneHead({ ws, milestone }: { ws: Workspace; milestone: Milestone }) {
  const { patch, settings, setMilestoneStatus } = useStore();
  const stats = milestoneStats(ws, milestone);
  const plan = schedule(ws, { velocity: settings.velocity });
  const line = plan.byId.get(milestone.id) ?? null;
  const weeks = stats.open / Math.max(1, settings.velocity);

  const forecast = stats.isDone
    ? '✓ Done'
    : milestone.planned && line && stats.open
      ? `Prognose ${formatWeeks(line.forecastEnd)}`
      : stats.open
        ? `≈ ${weeks.toFixed(1)} Wochen`
        : 'nicht geschätzt';

  const forecastTitle = milestone.planned
    ? `Position ${line ? line.pos : '–'} im Plan · ${weeks.toFixed(1)} Wochen bei ${settings.velocity} Aufgaben/Woche${line?.late ? ' · liegt nach dem Enddatum' : ''}`
    : 'Ein Datum gibt es, sobald der Milestone im Plan ist';

  return (
    <>
      <MetaRow k="status" label="Status">
        <StatusGroups kind="milestone" item={milestone} groups={[MS_KEYS]} labels={MS_STATUS} />
        {stats.tasksDone && !stats.isDone && (
          <span className="hint ms-hint">
            Alle Tasks erledigt –{' '}
            <button
              className="linkish"
              onClick={() => void setMilestoneStatus(milestone.id, 'done')}
            >
              Done
            </button>
            ?
          </span>
        )}
      </MetaRow>

      <MetaRow k="prog" label="Fortschritt">
        <SegBar segments={statusSegments(ws, milestone)} />
        <span className={`m-sub ${line?.late ? 'late' : ''}`} title={forecastTitle}>
          {forecast}
        </span>
      </MetaRow>

      <MetaRow k="span" label="Zeitraum">
        <DateProp
          value={milestone.startDate}
          label="Start"
          title="Startdatum – wird beim Wechsel auf In Progress automatisch gesetzt"
          onChange={(v) => void patch('milestone', milestone.id, { startDate: v })}
        />
        <span className="m-dash">–</span>
        <DateProp
          value={milestone.endDate}
          label="Ende"
          title="Enddatum – wird beim Wechsel auf Done automatisch gesetzt"
          onChange={(v) =>
            void patch('milestone', milestone.id, { endDate: v, ...(v ? {} : { endAuto: false }) })
          }
        />
      </MetaRow>
    </>
  );
}

function DateProp({
  value,
  label,
  title,
  onChange,
}: {
  value: string | null;
  label: string;
  title: string;
  onChange: (value: string | null) => void;
}) {
  return (
    <label className={`prop date ${value ? '' : 'empty'}`} title={title}>
      <input
        type="date"
        value={value ?? ''}
        aria-label={`${label}datum`}
        onChange={(e) => onChange(e.target.value || null)}
      />
      {value && (
        <button
          aria-label={`${label}datum entfernen`}
          onClick={(e) => {
            e.preventDefault();
            onChange(null);
          }}
        >
          ×
        </button>
      )}
    </label>
  );
}

/* --------------------------------------------------------------- Inhalt */

/**
 * Titel und Beschreibung sind ein Feld: die erste Zeile ist der Titel. Das
 * spart den Wechsel zwischen zwei Eingaben und ist im Prototyp genauso.
 */
function Content({
  ws,
  kind,
  item,
  editing,
  setEditing,
  placeholder,
}: {
  ws: Workspace;
  kind: 'task' | 'milestone';
  item: Task | Milestone;
  editing: boolean;
  setEditing: (v: boolean) => void;
  placeholder: string;
}) {
  const patch = useStore((s) => s.patch);
  const mark = kind === 'task' ? ws.mark((item as Task).markId) : null;
  const drawings = useDrawings({ kind, id: item.id }, item.desc);
  const ref = useRef<HTMLTextAreaElement>(null);
  const resolve = useRefResolver();
  const picker = useSmartEditor(ws, ref, { projectId: item.projectId, self: item.id });
  const uploader = useUpload(item.projectId);

  /**
   * Eingefügte oder hereingezogene Bilder. Im Editor kommt der Verweis an die
   * Cursorposition, auf der Karte ans Ende des Textes – da gibt es keinen
   * Cursor, und das Bild gehört unter das, was schon dasteht.
   */
  const take = async (files: FileList | File[] | null | undefined): Promise<void> => {
    const added = await uploader.upload(files);
    if (!added.length) return;
    const area = ref.current;
    if (editing && area) {
      for (const m of added) insertAtCursor(area, imageMarkdown(m));
      // Der Text ist noch nicht gespeichert – die Verwendung sieht die Galerie
      // erst nach „Fertig“.
      refreshGallery();
      return;
    }
    let desc = item.desc;
    for (const m of added) desc = appendMarkdown(desc, m);
    await patch(kind, item.id, { desc });
    refreshGallery();
  };

  /**
   * Zwei Arten von Ablage auf demselben Fleck: Dateien von außen und ein Bild
   * aus der Galerie. Was gezogen wird, steht im `dataTransfer` – Dateien gehen
   * den Weg übers Hochladen, alles andere an das gewöhnliche Ziehen weiter.
   */
  const descTarget = { type: 'desc', kind, item } as const;
  const descDrop = dropTarget(descTarget);
  const descZone = useZone(descTarget);
  /**
   * Sobald ein Bild gezogen wird, zeigt die Beschreibung sich als Ablage – man
   * soll nicht erst darüberfahren müssen, um zu sehen, dass sie eine ist.
   */
  const imageDrag = useDrag((s) => s.drag?.kind === 'image');
  // Dasselbe für eine Datei von außen – die kennt der Ziehzustand der App nicht.
  const fileOver = useFileOver();

  const imageEvents = {
    ...fileOver.events,
    onPaste: (e: React.ClipboardEvent) => {
      if (!imagesIn(e.clipboardData?.files).length) return;
      e.preventDefault();
      void take(e.clipboardData.files);
    },
    onDragOver: (e: React.DragEvent) => {
      if (hasFiles(e.dataTransfer)) {
        e.preventDefault();
        return;
      }
      descDrop.onDragOver(e);
    },
    onDrop: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) {
        descDrop.onDrop(e);
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      void take(e.dataTransfer.files);
    },
  };

  const { parts, embedded } = markdownParts(item.desc, drawings.list, resolve);
  const loose = drawings.list.filter((d) => !embedded.has(d.id));

  useEffect(() => {
    if (editing) focusAtEnd(ref.current);
  }, [editing]);

  const commit = (text: string): void => {
    const [first = '', ...rest] = text.split('\n');
    const title = first.trim();
    const desc = rest.join('\n').replace(/^\n+/, '');
    setEditing(false);
    if (title !== item.title || desc !== item.desc) void patch(kind, item.id, { title, desc });
  };

  if (editing) {
    return (
      <>
        <textarea
          ref={ref}
          className={`d-content ${fileOver.over ? 'dz-on' : ''}`}
          spellCheck
          aria-label="Inhalt: erste Zeile ist der Titel"
          defaultValue={item.title + (item.desc ? `\n\n${item.desc}` : '')}
          onInput={picker.onInput}
          onSelect={picker.onSelect}
          onBlur={picker.onBlur}
          {...imageEvents}
          onKeyDown={(e) => {
            if (picker.onKeyDown(e)) return;
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              commit(e.currentTarget.value);
            }
          }}
        />
        {picker.node}
        <div className="d-editbar">
          <button className="btn tiny ghost" onClick={() => setEditing(false)} title="Änderungen verwerfen">
            Abbrechen
          </button>
          <button
            className="btn tiny"
            title="Übernehmen – auch mit Esc oder Strg+Enter"
            onClick={() => commit(ref.current?.value ?? '')}
          >
            Fertig
          </button>
        </div>
        {drawings.editor}
      </>
    );
  }

  return (
    <>
      <div
        className={`d-card ${imageDrag || fileOver.over ? 'drop-ready' : ''} ${
          descZone || fileOver.over ? 'dz-on' : ''
        }`}
        role="button"
        tabIndex={0}
        aria-label="Inhalt bearbeiten"
        title="Klicken zum Bearbeiten"
        {...imageEvents}
        onClick={(e) => {
          if (refClick(e)) return;
          // Ein gewöhnlicher Link öffnet sein Ziel, nicht den Editor.
          if ((e.target as HTMLElement).closest('a[href]')) return;
          const next = checkboxClick(e, item.desc);
          if (next !== null) {
            void patch(kind, item.id, { desc: next });
            return;
          }
          // Wer Text markiert, will kopieren und nicht in den Editor.
          if (window.getSelection()?.toString()) return;
          if ((e.target as HTMLElement).closest('.drawing-embed')) return;
          setEditing(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) setEditing(true);
        }}
      >
        <h2 className="d-h">
          {mark && (
            <span className="mk-emoji" title={mark.name}>
              {mark.emoji}{' '}
            </span>
          )}
          {item.title || <em>{placeholder}</em>}
        </h2>
        <div className="md">
          {parts.length === 0 && <p className="hint">Klicken, um eine Beschreibung zu schreiben …</p>}
          {parts.map((part, i) =>
            part.kind === 'html' ? (
              <div key={i} dangerouslySetInnerHTML={{ __html: part.html }} />
            ) : (
              <DrawingEmbed
                key={part.drawing.id}
                drawing={part.drawing}
                onOpen={() => drawings.open(part.drawing)}
              />
            ),
          )}
        </div>
      </div>

      {loose.length > 0 && (
        <div className="draw-loose">
          {loose.map((d) => (
            <DrawingEmbed key={d.id} drawing={d} onOpen={() => drawings.open(d)} />
          ))}
        </div>
      )}

      <div className="d-actions">
        <button
          className="linkish"
          disabled={drawings.busy}
          title="Neue Zeichnung anlegen und in die Beschreibung einbinden"
          onClick={() => void drawings.add()}
        >
          + Zeichnung
        </button>
      </div>

      {drawings.editor}
    </>
  );
}

/* -------------------------------------------------------- Unteraufgaben */

function TaskChildren({ ws, task }: { ws: Workspace; task: Task }) {
  const kids = ws.kids(task.id);
  const doc = ws.isDoc(task);
  const add = useAddChild();

  return (
    <section className="d-section">
      <div className="h3row">
        <h3>
          {doc
            ? `Unterseiten ${kids.length ? `· ${kids.length}` : ''}`
            : `Unteraufgaben ${kids.length ? `· ${kids.filter((k) => isDone(k)).length}/${kids.length}` : ''}`}
        </h3>
        <button className="linkish" onClick={() => void add({ projectId: task.projectId, parentId: task.id, ...(doc ? { doc: true } : {}) }, task.id)}>
          {doc ? '+ Unterseite' : '+ Unteraufgabe'}
        </button>
      </div>
      <ChildList ws={ws} tasks={kids} doc={doc} />
    </section>
  );
}

function MilestoneChildren({ ws, milestone }: { ws: Workspace; milestone: Milestone }) {
  const roots = ws.msRoots(milestone);
  const add = useAddChild();

  return (
    <section className="d-section">
      <div className="h3row">
        <h3>
          Tasks · {roots.filter((t) => allDone(ws, t)).length}/{roots.length}
        </h3>
        <button
          className="linkish"
          onClick={() =>
            void add({ projectId: milestone.projectId, milestoneId: milestone.id }, milestone.id)
          }
        >
          + Task
        </button>
      </div>
      {roots.length ? (
        <ChildList ws={ws} tasks={roots} doc={false} />
      ) : (
        <p className="hint" style={{ margin: 0 }}>
          Noch keine Tasks. Zieh welche aus dem Backlog auf den Milestone oder leg neue an.
        </p>
      )}
    </section>
  );
}

/** Legt an, klappt den Träger auf und öffnet gleich den Titel in der Liste. */
function useAddChild(): (input: Record<string, unknown>, parentId: string) => Promise<void> {
  const { addTask, setCollapsed, edit } = useStore();
  return async (input, parentId) => {
    const id = await addTask({ title: '', ...input });
    if (!id) return;
    setCollapsed(parentId, false);
    edit(id);
  };
}

function ChildList({ ws, tasks, doc }: { ws: Workspace; tasks: Task[]; doc: boolean }) {
  const select = useStore((s) => s.select);
  return (
    <>
      {tasks.map((k) => {
        const done = allDone(ws, k);
        const mark = ws.mark(k.markId);
        return (
          <button
            key={k.id}
            className={`child ${done && !doc ? 'done' : ''}`}
            onClick={() => select(k.id)}
          >
            {doc ? (
              <span className="doc-ico">{DOC_ICON}</span>
            ) : (
              <span className="minicheck">{done ? '✓' : ''}</span>
            )}
            <span>
              {mark && (
                <span className="mk-emoji" title={mark.name}>
                  {mark.emoji}
                </span>
              )}
              {k.title || <em>Ohne Titel</em>}
            </span>
            <span className="pts">
              {doc
                ? ws.kids(k.id).length || ''
                : ws.kids(k.id).length
                  ? `${doneCount(ws, k)}/${total(ws, k)}`
                  : ''}
            </span>
          </button>
        );
      })}
    </>
  );
}

/* ---------------------------------------------------- Abhängigkeiten */

/**
 * Bei Tasks und Milestones gleich aufgebaut: beide Richtungen untereinander,
 * darunter ein Suchfeld, das schon verknüpfte und zirkuläre Kandidaten
 * ausblendet.
 */
function Deps({
  ws,
  kind,
  item,
}: {
  ws: Workspace;
  kind: 'task' | 'milestone';
  item: Task | Milestone;
}) {
  const { patch, select } = useStore();
  // Solange eine Zeile gezogen wird, zeigt der Bereich seine beiden Ablagefelder.
  // Ein Bild gehört nicht hierher – dafür Felder anzubieten, wäre ein leeres Versprechen.
  // Was aus der Galerie kommt, ergibt hier keine Abhängigkeit – also auch keine Fläche.
  const dragging = useDrag((s) => !!s.drag && s.drag.kind !== 'image' && s.drag.kind !== 'folder');
  const isMs = kind === 'milestone';
  const [dir, setDir] = useState<'by' | 'blocks'>('by');
  // Wonach die Suche sucht, hängt an der Richtung: ein Milestone wartet nur auf
  // Milestones, warten dürfen auf ihn aber auch Tasks.
  const word = isMs
    ? dir === 'by'
      ? 'Milestone'
      : 'Milestone oder Task'
    : dir === 'by'
      ? 'Task oder Milestone'
      : 'Task';
  const [query, setQuery] = useState('');

  useEffect(() => setQuery(''), [item.id]);

  // Ein Task kann auch auf einen ganzen Milestone warten; umgekehrt wartet ein
  // Milestone nur auf Milestones – auf ihn warten dürfen aber auch Tasks.
  const lookup = (id: string): Task | Milestone | null =>
    isMs ? ws.milestone(id) : (ws.task(id) ?? ws.milestone(id));
  const deps = item.deps.map(lookup).filter((x): x is Task | Milestone => !!x);
  const rev: (Task | Milestone)[] = isMs
    ? [...ws.milestones.filter((m) => m.deps.includes(item.id)), ...ws.blocks(item)]
    : ws.blocks(item);
  const inherited = isMs
    ? { deps: [], statusVia: null }
    : inheritedBlock(ws, item as Task);

  const finished = (x: Task | Milestone): boolean =>
    'planned' in x ? milestoneDone(ws, x) : isDone(x);

  const removeDep = (otherId: string): void => {
    void patch(kind, item.id, { deps: item.deps.filter((d) => d !== otherId) });
  };
  const kindOf = (x: Task | Milestone): 'task' | 'milestone' =>
    'planned' in x ? 'milestone' : 'task';
  const removeReverse = (other: Task | Milestone): void => {
    void patch(kindOf(other), other.id, { deps: other.deps.filter((d) => d !== item.id) });
  };

  const candidates = depCandidates(ws, item, isMs, dir, query);

  const addDep = (other: Task | Milestone): void => {
    if (dir === 'blocks') void patch(kindOf(other), other.id, { deps: [...other.deps, item.id] });
    else void patch(kind, item.id, { deps: [...item.deps, other.id] });
    setQuery('');
  };

  // Dasselbe Zeichen wie in der Trefferliste: ◆ für Milestones, sonst die Markierung.
  const glyph = (x: Task | Milestone) =>
    'planned' in x ? (
      <span className="ico ms" title="Milestone">
        ◆
      </span>
    ) : (
      <MarkGlyph ws={ws} task={x} />
    );

  const row = (x: Task | Milestone, onRemove: () => void) => (
    <div key={x.id} className={`dep ${finished(x) ? 'ok' : ''}`}>
      <span className="st">{finished(x) ? '✓' : '●'}</span>
      {glyph(x)}
      <button className="linkish" onClick={() => select(x.id)}>
        {x.title || 'Ohne Titel'}
      </button>
      {x.projectId !== item.projectId && (
        <span className="muted">· {ws.project(x.projectId)?.name}</span>
      )}
      <button className="x" aria-label="Abhängigkeit entfernen" onClick={onRemove}>
        ×
      </button>
    </div>
  );

  return (
    <section className="d-section deps-sec">
      <h3>Abhängigkeiten</h3>

      {(deps.length > 0 || inherited.deps.length > 0 || inherited.statusVia) && (
        <>
          <div className="sub">Wird blockiert durch</div>
          {deps.map((d) => row(d, () => removeDep(d.id)))}
          {inherited.deps.map((x) => (
            <div key={x.blocker.id} className="dep inherited">
              <span className="st">●</span>
              {glyph(x.blocker)}
              <button className="linkish" onClick={() => select(x.blocker.id)}>
                {x.blocker.title}
              </button>
              <span className="via">
                geerbt von{' '}
                <button className="linkish" onClick={() => select(x.via.id)}>
                  {x.via.title}
                </button>
              </span>
            </div>
          ))}
          {inherited.statusVia && (
            <div className="dep inherited">
              <span className="st">!</span>
              <span>
                Übergeordneter Task{' '}
                <button className="linkish" onClick={() => select(inherited.statusVia!.id)}>
                  {inherited.statusVia.title}
                </button>{' '}
                ist als Blockiert markiert
              </span>
            </div>
          )}
        </>
      )}

      {rev.length > 0 && (
        <>
          <div className="sub">Blockiert</div>
          {rev.map((d) => row(d, () => removeReverse(d)))}
        </>
      )}

      {/*
        Während gezogen wird, nimmt der Bereich die Zeile entgegen – je Richtung
        ein Feld. Richtung und Suche treten so lange zurück: beim Ablegen steht
        beides ohnehin fest. Danach sind sie wieder da.
      */}
      {dragging ? (
        <div className="dep-drops">
          <DepDrop dir="by" item={item} />
          <DepDrop dir="blocks" item={item} />
        </div>
      ) : (
        <div className="dep-add">
          <div className="seg small" role="radiogroup" aria-label="Richtung der neuen Abhängigkeit">
            <button
              className={dir === 'by' ? 'on' : ''}
              role="radio"
              aria-checked={dir === 'by'}
              title={`Kann erst starten, wenn der gewählte ${word} erledigt ist`}
              onClick={() => setDir('by')}
            >
              Wird blockiert durch
            </button>
            <button
              className={dir === 'blocks' ? 'on' : ''}
              role="radio"
              aria-checked={dir === 'blocks'}
              title={`Der gewählte ${word} muss hierauf warten`}
              onClick={() => setDir('blocks')}
            >
              Blockiert
            </button>
          </div>
          <input
            type="search"
            autoComplete="off"
            spellCheck={false}
            className="dep-q"
            placeholder={`${word} suchen …`}
            aria-label={`${word} für Abhängigkeit suchen`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && candidates[0]) {
                e.preventDefault();
                addDep(candidates[0]);
              }
            }}
          />
        </div>
      )}

      {query.trim() && (
        <div className="dep-results" role="listbox">
          {candidates.length ? (
            candidates.map((x, i) => (
              <button
                key={x.id}
                className={`dep-res ${i === 0 ? 'hl' : ''}`}
                role="option"
                aria-selected={i === 0}
                onClick={() => addDep(x)}
              >
                <span className={`st ${finished(x) ? 'ok' : ''}`}>{finished(x) ? '✓' : '●'}</span>
                {glyph(x)}
                <span className="lab">{x.title || 'Ohne Titel'}</span>
                <span className="where">{whereLabel(ws, x)}</span>
              </button>
            ))
          ) : (
            <p className="hint" style={{ margin: '6px 0 0' }}>
              Kein passender {word} – bereits verknüpfte oder zirkuläre werden ausgeblendet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Ein Feld, auf das sich eine Zeile aus der Liste ziehen lässt – eines je
 * Richtung, damit schon beim Ablegen feststeht, wer auf wen wartet.
 */
function DepDrop({ dir, item }: { dir: 'by' | 'blocks'; item: Task | Milestone }) {
  const target = { type: 'dep', dir, item } as const;
  const zone = useZone(target);
  return (
    <div className={`dep-drop ${zone ? 'on' : ''}`} {...dropTarget(target)}>
      {dir === 'by' ? 'Wird blockiert durch' : 'Blockiert'}
    </div>
  );
}

function MarkGlyph({ ws, task }: { ws: Workspace; task: Task }) {
  const mark = ws.mark(task.markId);
  return <span className="mk-emoji">{mark ? mark.emoji : DEFAULT_MARK.emoji}</span>;
}

function depCandidates(
  ws: Workspace,
  item: Task | Milestone,
  isMs: boolean,
  dir: 'by' | 'blocks',
  query: string,
): (Task | Milestone)[] {
  const n = norm(query.trim());
  if (!n) return [];

  // Ein Task darf auf einen Milestone warten, ein Milestone nur auf Milestones.
  const tasks = (): Task[] => ws.tasks.filter((t) => ws.isActive(t));
  const milestones = (): Milestone[] => ws.milestones.filter((m) => !isArchived(m));
  const pool: (Task | Milestone)[] = isMs
    ? dir === 'by'
      ? milestones()
      : [...milestones(), ...tasks()]
    : dir === 'by'
      ? [...tasks(), ...milestones()]
      : tasks();

  return pool
    .filter((x) => {
      if (x.id === item.id || x.projectId !== item.projectId) return false;
      const circular =
        dir === 'by'
          ? item.deps.includes(x.id) || dependsOn(ws, x, item.id)
          : x.deps.includes(item.id) || dependsOn(ws, item, x.id);
      return !circular && norm(x.title).includes(n);
    })
    .sort(
      (a, b) =>
        Number(!norm(a.title).startsWith(n)) - Number(!norm(b.title).startsWith(n)) ||
        a.title.length - b.title.length,
    )
    .slice(0, 8);
}

/** Wo etwas liegt – kurz, für die Trefferliste. */
function whereLabel(ws: Workspace, x: Task | Milestone): string {
  if ('planned' in x) return `${MS_STATUS[x.status as 'open' | 'progress' | 'done'] ?? STATUS_LABEL[x.status]}${x.planned ? '' : ' · Backlog'}`;
  if (x.parentId) return `unter „${ws.task(x.parentId)?.title ?? ''}“`;
  const ms = ws.milestone(x.milestoneId);
  if (ms) return `in ◆ ${ms.title}${ms.planned ? '' : ' (Backlog)'}`;
  if (x.doc) return 'in Dokumentation';
  return `${areaLabel(ws, x) === 'Ready' ? 'in Ready' : 'im Backlog'} › ${placeLabel(ws, x)}`;
}

/* ---------------------------------------------------------------- Teile */

function MetaRow({
  k,
  label,
  children,
}: {
  k: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="m-row" data-r={k}>
      <span className="m-lbl">{label}</span>
      <div className="m-val">{children}</div>
    </div>
  );
}

/**
 * Symbol immer, Beschriftung nur beim aktiven Status – so bleibt die Leiste
 * schmal und trotzdem lesbar.
 */
function StatusGroups({
  kind,
  item,
  groups,
  labels,
}: {
  kind: 'task' | 'milestone';
  item: Task | Milestone;
  groups: Status[][];
  labels: Record<string, string>;
}) {
  const patch = useStore((s) => s.patch);
  const setMilestoneStatus = useStore((s) => s.setMilestoneStatus);
  const choose = (s: Status): void => {
    if (kind === 'milestone') void setMilestoneStatus(item.id, s as 'open' | 'progress' | 'done');
    else void patch(kind, item.id, { status: s });
  };

  return (
    <div className="status-groups" role="radiogroup" aria-label="Status">
      {groups.map((group, i) => (
        <div key={i} className="seg status-seg">
          {group.map((s) => (
            <button
              key={s}
              className={`st-${s} ${item.status === s ? 'on' : ''}`}
              role="radio"
              aria-checked={item.status === s}
              title={labels[s]}
              aria-label={labels[s]}
              onClick={() => choose(s)}
            >
              <StatusIcon status={s} />
              <span>{labels[s]}</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------------- Menüs */

/**
 * Das „⋯“-Menü ist dasselbe wie der Rechtsklick auf die Zeile, nur ohne
 * „Details öffnen“ – die stehen ja schon offen. Genauso macht es der Prototyp.
 */
const moreMenu = (ws: Workspace, kind: 'task' | 'milestone', item: Task | Milestone): MenuItem[] =>
  (kind === 'milestone'
    ? milestoneMenu(ws, item as Milestone)
    : ws.isDoc(item as Task)
      ? docMenu(ws, item as Task)
      : taskMenu(ws, item as Task)
  ).slice(1);

/* --------------------------------------------------------------- Kleinkram */

const norm = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const formatWeeks = (weeks: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + Math.round(weeks * 7));
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
};
