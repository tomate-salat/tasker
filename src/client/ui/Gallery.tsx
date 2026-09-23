import { useEffect, useMemo, useState } from 'react';
import type { ImageEntry, ImageUse } from '../api.js';
import { imageUrl } from '../api.js';
import { scopeProjectIds, useStore } from '../store.js';
import { dragSource } from './dnd.js';
import { hasFiles, refreshGallery, useUpload } from './imageDrop.js';
import { humanSize } from './imageFile.js';

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
  const [filter, setFilter] = useState<Filter>('alle');
  const [months, setMonths] = useState(12);
  const [sort, setSort] = useState<Sort>('neu');
  const [over, setOver] = useState(false);
  const projectId = scope === 'all' ? null : scope;
  const uploader = useUpload(projectId);

  useEffect(() => {
    if (!imagesLoaded) void loadImages();
  }, [imagesLoaded, loadImages]);

  const projectIds = scopeProjectIds(state);
  const shown = useMemo(() => {
    const cutoff = new Date(Date.now() - months * 30 * 864e5).toISOString();
    const list = images.filter((b) => {
      // Ein Bild aus einem gelöschten Projekt hat keinen Bezug mehr – es steht
      // unter „Alle Projekte“ und muss dort erreichbar bleiben.
      const bekannt = !b.projectId || projectIds.includes(b.projectId);
      if (scope !== 'all' && !bekannt) return false;
      if (b.deletedAt) return false;
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
  }, [images, filter, months, sort, scope, projectIds]);

  const total = shown.reduce((n, b) => n + b.size, 0);
  const deleted = images.filter((b) => b.deletedAt);
  const ungenutzt = images.filter((b) => !b.deletedAt && uses(b).length === 0);

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
      <div className="gal-scroll">
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

      {shown.length === 0 ? (
        <div className="empty-state">
          {images.length
            ? 'Kein Bild passt zu diesem Filter.'
            : 'Noch keine Bilder. Füge in einer Beschreibung eines ein – mit Strg+V oder indem du es hineinziehst.'}
        </div>
      ) : (
        <div className="gal-grid">
          {shown.map((b) => (
            <figure key={b.id} className="gal-item" {...dragSource('image', b.id)}>
              <img src={imageUrl(b.id, 'klein')} alt={b.name} loading="lazy" draggable={false} />
              <figcaption>
                <span className="gal-name" title={b.name}>
                  {b.name}
                </span>
                <span className="gal-meta">
                  {b.width}×{b.height} · {humanSize(b.size)}
                </span>
                <Usage entry={b} onGo={(id) => { select(id); reveal(id); }} />
                <button
                  className="linkish gal-del"
                  title="In den Papierkorb legen"
                  onClick={() => void trashImage(b.id)}
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
    </div>
  );
}

/** Wo das Bild steckt – anklickbar, der Klick springt dorthin. */
function Usage({ entry, onGo }: { entry: ImageEntry; onGo: (id: string) => void }) {
  const u = entry.usage;
  const alle = uses(entry);
  if (!alle.length) return <span className="gal-use none">Ohne Verwendung</span>;

  return (
    <span className="gal-use">
      {u?.live.map((e) => (
        <button key={e.id} className="linkish" onClick={() => onGo(e.id)} title="Dorthin springen">
          {e.kind === 'milestone' ? '◆ ' : ''}
          {e.title || 'Ohne Titel'}
        </button>
      ))}
      {/* Archiviertes und Gelöschtes ist nicht anspringbar – es steht nicht in der Liste. */}
      {!!u?.archived.length && <span className="gal-tag">{count(u.archived.length, 'archiviert', 'archiviert')}</span>}
      {!!u?.trashed.length && <span className="gal-tag">{count(u.trashed.length, 'im Papierkorb', 'im Papierkorb')}</span>}
    </span>
  );
}
