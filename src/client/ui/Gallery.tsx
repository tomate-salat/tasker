import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ImageEntry, ImageFolder, ImageUse } from '../api.js';
import { imageUrl } from '../api.js';
import { folderPath, scopeProjectIds, useStore } from '../store.js';
import { startTilt } from './cardTilt.js';
import { dragSource, dropTarget, useZone } from './dnd.js';
import { hasFiles, refreshGallery, useUpload } from './imageDrop.js';
import { humanSize } from './imageFile.js';
import { useMenu, type MenuItem } from './Menu.js';
import { coverMenu } from './Cards.js';

/**
 * Die Galerie: ein Bestand wie das Archiv, keine Liste von Aufgaben. Sie zeigt
 * zu jedem Bild, wo es steckt, und hilft beim Aufräumen – denn ein Bild, das
 * niemand mehr erwähnt, merkt sonst niemand.
 *
 * Wer ein Bild verwendet, wird beim Laden nachgesehen und nicht mitgeschrieben
 * (siehe images.ts). „Ohne Verwendung“ ist deshalb eine Auskunft und keine
 * Vermutung – das ist bei einer Ansicht, aus der heraus gelöscht wird, der
 * entscheidende Punkt.
 */

type Filter = 'alle' | 'ungenutzt' | 'archiviert' | 'papierkorb' | 'alt';
type Sort = 'neu' | 'gross';

const FILTER_LABEL: Record<Filter, string> = {
  alle: 'Alle',
  ungenutzt: 'Ohne Verwendung',
  archiviert: 'Nur noch archiviert',
  papierkorb: 'Nur noch im Papierkorb',
  alt: 'Älter als',
};

/** Die Altersstufen des letzten Filters. */
const AGES: { months: number; label: string }[] = [
  { months: 3, label: '3 Monate' },
  { months: 6, label: '6 Monate' },
  { months: 12, label: '1 Jahr' },
  { months: 24, label: '2 Jahre' },
];

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

const uses = (b: ImageEntry): ImageUse[] => [
  ...(b.usage?.live ?? []),
  ...(b.usage?.archived ?? []),
  ...(b.usage?.trashed ?? []),
];

/** Nur noch da drin, und sonst nirgends. */
const onlyIn = (b: ImageEntry, where: 'archived' | 'trashed'): boolean => {
  const u = b.usage;
  if (!u || !u[where].length) return false;
  return !u.live.length && (where === 'archived' ? !u.trashed.length : !u.archived.length);
};

export function Gallery() {
  const state = useStore();
  const { images, imagesLoaded, loadImages, scope, trashImage, restoreImage, select, reveal } = state;
  const { ws, imageSel, setImageSel, toggleImageSel, clearImageSel, trashImages } = state;
  const { folders, folderAt, openFolder, addFolder, renameFolder, deleteFolder, sortIntoFolder } = state;
  const [filter, setFilter] = useState<Filter>('alle');
  const [months, setMonths] = useState(12);
  const [sort, setSort] = useState<Sort>('neu');
  const [over, setOver] = useState(false);
  /** Ankerkachel für die Bereichsauswahl mit der Umschalttaste. */
  const [anchor, setAnchor] = useState<string | null>(null);
  const menu = useMenu();
  const projectId = scope === 'all' ? null : scope;
  const here = folders.find((f) => f.id === folderAt) ?? null;
  // Im Ordner gilt dessen Projekt: dort abgelegte Bilder gehören dorthin.
  const uploader = useUpload(here ? here.projectId : projectId, folderAt);

  useEffect(() => {
    if (!imagesLoaded) void loadImages();
  }, [imagesLoaded, loadImages]);

  // Ein anderer Filter zeigt andere Bilder; eine Auswahl, die man nicht mehr
  // sieht, aber noch löschen könnte, wäre eine Falle.
  useEffect(() => {
    clearImageSel();
    setAnchor(null);
  }, [filter, months, scope, clearImageSel]);

  const projectIds = scopeProjectIds(state);

  /** Ein Ordner mit allem, was darin liegt – für Zählung und für die Filter. */
  const subtree = useCallback(
    (id: string): Set<string> => {
      const ids = new Set([id]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const f of folders) {
          if (f.parentId && ids.has(f.parentId) && !ids.has(f.id)) {
            ids.add(f.id);
            grew = true;
          }
        }
      }
      return ids;
    },
    [folders],
  );

  const shown = useMemo(() => {
    const cutoff = new Date(Date.now() - months * 30 * 864e5).toISOString();
    // „Alle“ zeigt einen Ordner; die übrigen Filter suchen – und zwar in diesem
    // Ordner und allem darunter, sonst verlöre die Suche ihren Ort.
    const tree = folderAt ? subtree(folderAt) : null;
    const list = images.filter((b) => {
      // Ein Bild aus einem gelöschten Projekt hat keinen Bezug mehr – es steht
      // unter „Alle Projekte“ und muss dort erreichbar bleiben.
      const bekannt = !b.projectId || projectIds.includes(b.projectId);
      if (scope !== 'all' && !bekannt) return false;
      if (b.deletedAt) return false;
      if (filter === 'alle') {
        if ((b.folderId ?? null) !== folderAt) return false;
      } else if (tree && !(b.folderId && tree.has(b.folderId))) {
        return false;
      }
      switch (filter) {
        case 'ungenutzt':
          return uses(b).length === 0;
        case 'archiviert':
          return onlyIn(b, 'archived');
        case 'papierkorb':
          return onlyIn(b, 'trashed');
        case 'alt':
          return b.createdAt < cutoff;
        default:
          return true;
      }
    });
    return list.sort((a, b) => (sort === 'gross' ? b.size - a.size : b.createdAt.localeCompare(a.createdAt)));
  }, [images, filter, months, sort, scope, projectIds, folderAt, subtree]);

  const total = shown.reduce((n, b) => n + b.size, 0);
  const deleted = images.filter((b) => b.deletedAt);
  const ungenutzt = images.filter((b) => !b.deletedAt && uses(b).length === 0);

  /** Die Ordner dieser Ebene. Ein Ordner ohne Projekt steht überall. */
  const hier = folders
    .filter((f) => (f.parentId ?? null) === folderAt)
    .filter((f) => scope === 'all' || !f.projectId || f.projectId === scope)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  /** Wie viele Bilder in einem Ordner liegen – samt allem darunter. */
  const countInFolder = (id: string): number => {
    const ids = subtree(id);
    return images.filter((b) => !b.deletedAt && b.folderId && ids.has(b.folderId)).length;
  };

  const spur = folderPath(folderAt, folders);

  /**
   * Eine Verwendung anspringen. Die Vorgaben für Titelbilder haben keine Zeile
   * in der Liste – dafür öffnet sich der Dialog, in dem sie gesetzt werden.
   */
  const goUse = (u: ImageUse): void => {
    if (u.kind === 'project') state.openCategories(u.id);
    else if (u.kind === 'category') state.openCategories(ws?.category(u.id)?.projectId);
    else if (u.kind === 'mark') state.openMarks(ws?.mark(u.id)?.projectId);
    else {
      select(u.id);
      reveal(u.id);
    }
  };

  /** Anklicken: einzeln, mit Strg dazu, mit Umschalt der Bereich dazwischen. */
  const pick = (e: React.MouseEvent, id: string): void => {
    if (e.ctrlKey || e.metaKey) {
      toggleImageSel(id);
      setAnchor(id);
      return;
    }
    const ids = shown.map((b) => b.id);
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (e.shiftKey && from >= 0 && to >= 0) {
      setImageSel(ids.slice(Math.min(from, to), Math.max(from, to) + 1));
      return;
    }
    setImageSel([id]);
    setAnchor(id);
  };

  /**
   * Die Sammelaktionen im Kontextmenü. „Anhängen“ gibt es hier nicht – im
   * Menü machte es das Menü unruhig, und der offene Inspektor nimmt Bilder
   * per Ziehen (Wunsch des Nutzers).
   */
  const bulkMenu = (ids: string[]): MenuItem[] => {
    const list = ids.map((id) => images.find((b) => b.id === id)).filter((b) => !!b);
    return [
      ...(list.length > 1 ? [{ head: count(list.length, 'Bild', 'Bilder') + ' ausgewählt' } as MenuItem] : []),
      // Titelbilder: für genau ein Bild – als Vorgabe für Projekt, Kategorie
      // und Markierung.
      ...(ws
        ? coverMenu(ws, scope === 'all' ? null : scope, list.length === 1 ? (list[0]?.id ?? null) : null)
        : []),
      { label: 'In Ordner verschieben', sub: folderTargets((to) => void sortIntoFolder(ids, to)) },
      { sep: true },
      { label: 'Alle auswählen', onSelect: () => setImageSel(shown.map((b) => b.id)) },
      { label: 'Auswahl aufheben', disabled: !imageSel.size, onSelect: clearImageSel },
      { sep: true },
      {
        label: list.length > 1 ? `${list.length} Bilder in den Papierkorb` : 'In den Papierkorb',
        danger: true,
        onSelect: () => void trashImages(ids),
      },
      {
        label: list.length > 1 ? `${list.length} Bilder endgültig löschen` : 'Endgültig löschen',
        danger: true,
        onSelect: () => void state.destroyImages(ids),
      },
    ];
  };

  /**
   * Alle Ordner als Ziele, eingerückt nach Tiefe – dieselbe Liste dient dem
   * Einsortieren von Bildern und dem Umhängen eines Ordners. `skip` nimmt den
   * Ordner samt Inhalt heraus, der gerade selbst verschoben wird.
   */
  const folderTargets = (go: (to: string | null) => void, skip?: string): MenuItem[] => {
    const aus = skip ? subtree(skip) : null;
    const out: MenuItem[] = [{ label: 'Ganz nach oben', onSelect: () => go(null) }];
    const walk = (parent: string | null, depth: number): void => {
      for (const f of folders
        .filter((f) => (f.parentId ?? null) === parent)
        .filter((f) => scope === 'all' || !f.projectId || f.projectId === scope)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))) {
        if (aus?.has(f.id)) continue;
        out.push({ label: '   '.repeat(depth) + f.name, onSelect: () => go(f.id) });
        walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out.length > 1 ? out : [{ label: 'Noch keine Ordner', disabled: true }];
  };

  /** Das Menü einer Ordnerkachel. */
  const folderMenu = (folder: ImageFolder): MenuItem[] => [
    { label: 'Öffnen', onSelect: () => openFolder(folder.id) },
    {
      label: 'Umbenennen',
      sub: [{ input: folder.name, onSubmit: (name) => void renameFolder(folder.id, name) }],
    },
    { label: 'Verschieben nach', sub: folderTargets((to) => void moveFolderTo(folder, to), folder.id) },
    { sep: true },
    { label: 'Neuer Ordner darin', sub: [{ input: 'Name', onSubmit: (name) => void addFolder(name, folder.projectId, folder.id) }] },
    { sep: true },
    // Zwei verschiedene Dinge, deshalb zwei Einträge: die Hülle wegnehmen oder
    // den Inhalt mitnehmen. Verloren geht dabei nichts – die Bilder gehen in
    // den Papierkorb und sind von dort einzeln zurückzuholen.
    { label: 'Ordner auflösen', danger: true, onSelect: () => void deleteFolder(folder.id) },
    { label: 'Ordner löschen', danger: true, onSelect: () => void deleteFolder(folder.id, true) },
  ];

  const moveFolderTo = (folder: ImageFolder, to: string | null): Promise<void> =>
    state.moveFolder(folder.id, to);

  /**
   * Das Menü der freien Fläche – hier entsteht ein Ordner an der Stelle, an der
   * man gerade steht. Rechtsklick statt Knopf: so liegt die Handlung dort, wo
   * sie wirkt, und die Leiste bleibt frei.
   */
  const emptyMenu = (): MenuItem[] => [
    {
      label: 'Neuer Ordner',
      sub: [
        {
          input: 'Name des Ordners',
          onSubmit: (name) => void addFolder(name, here ? here.projectId : projectId, folderAt),
        },
      ],
    },
    { sep: true },
    { label: 'Alle auswählen', disabled: !shown.length, onSelect: () => setImageSel(shown.map((b) => b.id)) },
    { label: 'Auswahl aufheben', disabled: !imageSel.size, onSelect: clearImageSel },
  ];

  /**
   * Rechtsklick auf eine Kachel außerhalb der Auswahl meint nur diese Kachel –
   * er öffnet ihr Menü, wählt sie aber nicht aus (wie bei den Zeilen der Liste).
   */
  const onContext = (e: React.MouseEvent, id: string): void => {
    e.preventDefault();
    const ids = imageSel.has(id) ? [...imageSel] : [id];
    menu.openAtPoint(e.clientX, e.clientY, bulkMenu(ids));
  };

  /** Dateien ins Fenster gezogen: hier landen sie nur im Bestand. */
  const dropZone = {
    onDragOver: (e: React.DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      setOver(false);
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      void uploader.upload(e.dataTransfer.files).then(refreshGallery);
    },
  };

  return (
    <div className={`gallery ${over ? 'dz-on' : ''}`} {...dropZone}>
      {/* Die Spur: wo man steht, und zugleich der Weg zurück. Man kann Bilder
          und Ordner auf eine Stufe ziehen, um sie dorthin zu heben. */}
      <div className="gal-path">
        <Crumb id={null} label="Alle Bilder" at={folderAt} onGo={openFolder} />
        {spur.map((f) => (
          <span key={f.id} className="gal-crumb-wrap">
            <span className="sep" aria-hidden="true">
              ›
            </span>
            <Crumb id={f.id} label={f.name} at={folderAt} onGo={openFolder} />
          </span>
        ))}
      </div>

      <div className="gal-bar">
        <div className="seg" role="radiogroup" aria-label="Filter">
          {(Object.keys(FILTER_LABEL) as Filter[]).map((f) => (
            <button
              key={f}
              role="radio"
              aria-checked={filter === f}
              className={filter === f ? 'on' : ''}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {filter === 'alt' && (
          <select
            className="gal-age"
            aria-label="Alter"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {AGES.map((a) => (
              <option key={a.months} value={a.months}>
                {a.label}
              </option>
            ))}
          </select>
        )}

        <span className="spacer" />

        <select
          className="gal-age"
          aria-label="Sortierung"
          value={sort}
          onChange={(e) => setSort(e.target.value as Sort)}
        >
          <option value="neu">Neueste zuerst</option>
          <option value="gross">Größte zuerst</option>
        </select>

        <span className="sum">
          {count(shown.length, 'Bild', 'Bilder')} · {humanSize(total)}
        </span>

        {/* Die Verwendungen werden beim Laden nachgesehen – nach Änderungen
            anderswo holt man sich damit den frischen Stand. */}
        <button
          className="btn tiny ghost"
          title="Bestand und Verwendungen neu einlesen"
          onClick={() => void loadImages()}
        >
          Aktualisieren
        </button>
      </div>

      {/* Gescrollt wird nur unterhalb der Leiste – so verdeckt sie nichts. */}
      <div
        className="gal-scroll"
        // Daneben geklickt heißt: nichts mehr gemeint – die Leiste zum Aufräumen
        // hebt die Auswahl aber nicht auf.
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('.gal-item, .gal-sweep')) clearImageSel();
        }}
        // Rechtsklick daneben: das Menü der Fläche, nicht das einer Kachel.
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('.gal-item')) return;
          e.preventDefault();
          menu.openAtPoint(e.clientX, e.clientY, emptyMenu());
        }}
      >
      {ungenutzt.length > 0 && filter === 'ungenutzt' && (
        <div className="gal-sweep">
          <span>{count(ungenutzt.length, 'Bild wird', 'Bilder werden')} nirgends mehr erwähnt.</span>
          <button
            className="btn tiny ghost"
            onClick={() => {
              for (const b of ungenutzt) void trashImage(b.id);
            }}
          >
            Alle in den Papierkorb
          </button>
        </div>
      )}

      {/* Unter einem Filter verschwinden die Ordner – dann ist es eine Suche
          und keine Ablage. Das sollte dastehen, sonst wirkt der Bestand leer. */}
      {filter !== 'alle' && folders.length > 0 && (
        <div className="gal-hint">
          Gesucht wird in allen Ordnern{here ? ` unterhalb von „${here.name}“` : ''}.
        </div>
      )}

      {shown.length === 0 && (filter !== 'alle' || hier.length === 0) ? (
        <div className="empty-state">
          {here
            ? 'Dieser Ordner ist leer. Zieh Bilder hierher oder lege einen Unterordner an.'
            : images.length
              ? 'Kein Bild passt zu diesem Filter.'
              : 'Noch keine Bilder. Füge in einer Beschreibung eines ein – mit Strg+V oder indem du es hineinziehst.'}
        </div>
      ) : (
        <div className="gal-grid">
          {filter === 'alle' &&
            hier.map((f) => (
              <FolderTile
                key={f.id}
                folder={f}
                count={countInFolder(f.id)}
                onOpen={() => openFolder(f.id)}
                onMenu={(e) => {
                  e.preventDefault();
                  menu.openAtPoint(e.clientX, e.clientY, folderMenu(f));
                }}
              />
            ))}
          {shown.map((b) => (
            <figure
              key={b.id}
              className={`gal-item ${imageSel.has(b.id) ? 'sel' : ''}`}
              aria-selected={imageSel.has(b.id)}
              onClick={(e) => pick(e, b.id)}
              onContextMenu={(e) => onContext(e, b.id)}
              {...dragSource('image', b.id)}
              // Bilder kippen beim Ziehen wie die Karten (`cardTilt.ts`).
              onDragStart={(e) => {
                dragSource('image', b.id).onDragStart(e);
                startTilt(e);
              }}
            >
              <img src={imageUrl(b.id, 'klein')} alt={b.name} loading="lazy" draggable={false} />
              <figcaption>
                <span className="gal-name" title={b.name}>
                  {b.name}
                </span>
                <span className="gal-meta">
                  {b.width}×{b.height} · {humanSize(b.size)}
                </span>
                {/* Die Verweise darin springen weg – ein Klick darauf ist keine Auswahl. */}
                <Usage entry={b} onGo={goUse} />
                <button
                  className="linkish gal-del"
                  title="In den Papierkorb legen"
                  onClick={(e) => {
                    e.stopPropagation();
                    void trashImage(b.id);
                  }}
                >
                  Löschen
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {deleted.length > 0 && (
        <div className="gal-deleted">
          <h3>Im Papierkorb</h3>
          <div className="gal-grid">
            {deleted.map((b) => (
              <figure key={b.id} className="gal-item gone">
                <img src={imageUrl(b.id, 'klein')} alt={b.name} loading="lazy" />
                <figcaption>
                  <span className="gal-name">{b.name}</span>
                  <span className="gal-meta">{humanSize(b.size)}</span>
                  <button className="linkish" onClick={() => void restoreImage(b.id)}>
                    Wiederherstellen
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
      </div>
      {menu.node}
    </div>
  );
}

/**
 * Eine Stufe der Spur. Sie ist zugleich Ablagefläche: ein Bild oder ein Ordner
 * darauf gezogen wandert eine oder mehrere Ebenen nach oben, ohne dass man erst
 * dorthin wechseln muss.
 */
function Crumb({
  id,
  label,
  at,
  onGo,
}: {
  id: string | null;
  label: string;
  at: string | null;
  onGo: (id: string | null) => void;
}) {
  const target = { type: 'folder', id } as const;
  const zone = useZone(target);
  return (
    <button
      className={`gal-crumb ${at === id ? 'on' : ''} ${zone ? 'dz-into' : ''}`}
      onClick={() => onGo(id)}
      {...dropTarget(target)}
    >
      {label}
    </button>
  );
}

/** Ein Ordner im Raster – er sieht aus wie eine Kachel und nimmt welche auf. */
function FolderTile({
  folder,
  count: n,
  onOpen,
  onMenu,
}: {
  folder: ImageFolder;
  count: number;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const target = { type: 'folder', id: folder.id } as const;
  const zone = useZone(target);
  return (
    <figure
      className={`gal-item gal-folder ${zone ? 'dz-into' : ''}`}
      // Geöffnet wird mit Doppelklick – ein einzelner Klick soll nicht gleich
      // die Ebene wechseln, wenn man eigentlich nur zielt.
      onDoubleClick={onOpen}
      onContextMenu={onMenu}
      {...dragSource('folder', folder.id)}
      {...dropTarget(target)}
      // Ordner kippen beim Ziehen wie Bilder und Karten (`cardTilt.ts`).
      onDragStart={(e) => {
        dragSource('folder', folder.id).onDragStart(e);
        startTilt(e);
      }}
    >
      <div className="gal-folder-face" aria-hidden="true">
        📁
      </div>
      <figcaption>
        <span className="gal-name" title={folder.name}>
          {folder.name}
        </span>
        <span className="gal-meta">{n === 1 ? '1 Bild' : `${n} Bilder`}</span>
      </figcaption>
    </figure>
  );
}

/** Die Vorgaben für Titelbilder, so wie sie in der Verwendung heißen. */
const USE_KIND: Partial<Record<ImageUse['kind'], string>> = {
  project: 'Projekt',
  category: 'Kategorie',
  mark: 'Markierung',
};

/** Wo das Bild steckt – anklickbar, der Klick springt dorthin. */
function Usage({ entry, onGo }: { entry: ImageEntry; onGo: (use: ImageUse) => void }) {
  const u = entry.usage;
  const alle = uses(entry);
  if (!alle.length) return <span className="gal-use none">Ohne Verwendung</span>;

  return (
    <span className="gal-use">
      {u?.live.map((e) => (
        <button
          key={e.id}
          className="linkish"
          onClick={(ev) => {
            ev.stopPropagation();
            onGo(e);
          }}
          title={USE_KIND[e.kind] ? 'Vorgabe für Titelbilder – dort verwalten' : 'Dorthin springen'}
        >
          {e.kind === 'milestone' ? '◆ ' : ''}
          {USE_KIND[e.kind] ? `${USE_KIND[e.kind]}: ` : ''}
          {e.title || 'Ohne Titel'}
        </button>
      ))}
      {/* Archiviertes und Gelöschtes ist nicht anspringbar – es steht nicht in der Liste. */}
      {!!u?.archived.length && <span className="gal-tag">{count(u.archived.length, 'archiviert', 'archiviert')}</span>}
      {!!u?.trashed.length && <span className="gal-tag">{count(u.trashed.length, 'im Papierkorb', 'im Papierkorb')}</span>}
    </span>
  );
}
