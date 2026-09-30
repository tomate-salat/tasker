import type { Prio, Settings, Status } from '@shared/model.js';
import type { Segment } from '@shared/progress.js';

/** Die Symbole der Seitenleiste, unverändert aus dem Prototyp. */
export const SIDE_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

export const THEME_LABEL: Record<Settings['theme'], string> = {
  system: 'System',
  light: 'Hell',
  dark: 'Dunkel',
};

export const THEME_ICON: Record<Settings['theme'], React.ReactNode> = {
  system: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
    </svg>
  ),
  light: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      <path
        d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  dark: (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M13.5 10.2A5.8 5.8 0 0 1 5.8 2.5a5.8 5.8 0 1 0 7.7 7.7z" fill="currentColor" />
    </svg>
  ),
};

export const STATUS_LABEL: Record<Status, string> = {
  open: 'Offen',
  progress: 'In Progress',
  done: 'Erledigt',
  unclear: 'Unklar',
  blocked: 'Blockiert',
};

export const PRIO_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Hoch',
  2: 'Mittel',
  3: 'Niedrig',
};

/** Signalbalken wie im Prototyp: P1 = drei volle Balken, P0 bleibt blass sichtbar. */
export function PrioIcon({ prio, cell = false }: { prio: Prio; cell?: boolean }) {
  const label = prio ? `Priorität ${PRIO_LABEL[prio]}` : 'Keine Priorität';
  // In der Listenzelle wie im Prototyp (`prioIconAny`): mit Stufe und Hinweis aufs Klicken.
  const title = cell
    ? `${prio ? `Priorität: P${prio} · ${PRIO_LABEL[prio]}` : 'Keine Priorität'} – klicken zum Ändern`
    : label;
  return (
    <span className={`prio-ico p${prio}`} role="img" aria-label={label} title={title}>
      <svg width="14" height="12" viewBox="0 0 14 12" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <rect
            key={i}
            x={1 + i * 4.5}
            y={8 - i * 3}
            width="3"
            height={4 + i * 3}
            rx="1"
            fill="currentColor"
            opacity={prio && i < 4 - prio ? 1 : 0.22}
          />
        ))}
      </svg>
    </span>
  );
}

/** Nur diese drei Stufen kennt ein Milestone. */
export const MS_STATUS: Record<'open' | 'progress' | 'done', string> = {
  open: 'Offen',
  progress: 'In Progress',
  done: 'Done',
};

/** Statuszeichen im Inspektor: dieselbe Kreis-Familie für Tasks und Milestones. */
export function StatusIcon({ status }: { status: Status }) {
  return (
    <svg className="st-ico" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
      {status === 'progress' && <path d="M7 2.4a4.6 4.6 0 010 9.2z" fill="currentColor" />}
      {status === 'unclear' && (
        <>
          <path
            d="M5.5 5.4a1.6 1.6 0 112.1 1.5c-.4.2-.6.5-.6.9v.3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <circle cx="7" cy="10" r=".85" fill="currentColor" />
        </>
      )}
      {status === 'blocked' && <path d="M4.6 7h4.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />}
      {status === 'done' && (
        <path
          d="M4.5 7.1l1.8 1.8 3.2-3.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
    </svg>
  );
}

/** Statuszeichen in der Zeile: erledigt, blockiert, unklar – sonst leer. */
export const statusMark = (status: Status): string =>
  status === 'done' ? '✓' : status === 'blocked' ? '!' : status === 'unclear' ? '?' : '';

const SEG_CLASS: Record<Status, string> = {
  done: 'done',
  progress: 'prog',
  blocked: 'blocked',
  unclear: 'unclear',
  open: 'open',
};

/** Reihenfolge der Segmente: erledigt, in Arbeit, eigene Checkliste, dann der Rest. */
const RANK: Record<string, number> = {
  done: 0,
  prog: 1,
  cl: 2,
  blocked: 3,
  unclear: 4,
  open: 5,
};

/** Ein durchgehender Balken, ein Abschnitt je Checklisten-Punkt und Blatt-Aufgabe. */
export function SegBar({ segments }: { segments: Segment[] }) {
  if (!segments.length) return null;

  const classes = segments
    .map((s) => (s.kind === 'checklist' ? (s.done ? 'done' : 'cl') : SEG_CLASS[s.status]))
    .sort((a, b) => (RANK[a] ?? 9) - (RANK[b] ?? 9));

  const counts = classes.reduce<Record<string, number>>((acc, c) => {
    acc[c] = (acc[c] ?? 0) + 1;
    return acc;
  }, {});
  const title = Object.entries(counts)
    .map(([c, n]) => `${n}× ${SEG_TITLE[c] ?? c}`)
    .join(' · ');

  return (
    <span className="segbar" title={title} role="img" aria-label={title}>
      {classes.map((c, i) => (
        <span key={i} className={`sg ${c}`} />
      ))}
    </span>
  );
}

const SEG_TITLE: Record<string, string> = {
  done: 'erledigt',
  prog: 'in Arbeit',
  cl: 'Checkliste offen',
  blocked: 'blockiert',
  unclear: 'unklar',
  open: 'offen',
};

/** Die Aufklapppfeile des Prototyps (`CHEV_D`, `CHEV_R`). */
export const CHEVRON_DOWN = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M2.5 4.5L6 8l3.5-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
export const CHEVRON_RIGHT = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <path
      d="M4.5 2.5L8 6l-3.5 3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Schloss für blockierte Aufgaben. */
export const LOCK_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="2" y="5.5" width="8" height="5.5" rx="1.2" fill="currentColor" />
    <path d="M3.8 5.5V4a2.2 2.2 0 0 1 4.4 0v1.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
  </svg>
);

/** Kästchen für die Checkliste in der Beschreibung. */
export const CHECK_ICON = (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
    <rect x="1" y="1" width="10" height="10" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3.6 6.1l1.6 1.6 3.2-3.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/** Hinweis auf eine Zeichnung an der Aufgabe. */
export const DRAW_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="3" width="6" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12" cy="11.5" r="2.6" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 6.5c2 0 3.5 1 3.8 2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/** Öffnet den Abhängigkeits-Graph eines Milestones. */
export const GRAPH_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="3.5" cy="4" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="3.5" cy="12" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <circle cx="12.5" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M5.4 4.9 10.6 7.1M5.4 11.1l5.2-2.2"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

/** Seitensymbol in der Doku-Ansicht. */
export const DOC_ICON = (
  <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 1.8h5.2L12.5 5v9.2H4z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    <path
      d="M9 2v3.2h3.3M6 8.5h4.5M6 11h3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
);

/** Darstellung „Liste“ – der Umschalter im schmalen Kopf. */
export const LIST_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4h12M2 8h12M2 12h12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

/** Darstellung „Karten“ – der Umschalter im schmalen Kopf. */
export const CARDS_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="2" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="9" y="2" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="2" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <rect x="9" y="9" width="5" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
  </svg>
);

/** „Erledigte archivieren“ im schmalen Kopf. */
export const ARCHIVE_ICON = (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.8" y="2.5" width="12.4" height="3.3" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path
      d="M3 5.8v6.7a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5.8M6.3 8.7h3.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

/** Ohne eigene Markierung gilt die Standard-Markierung „Aufgabe“. */
export const DEFAULT_MARK = { emoji: '📋', name: 'Aufgabe' };
