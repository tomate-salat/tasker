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
export function PrioIcon({ prio }: { prio: Prio }) {
  const label = prio ? `Priorität ${PRIO_LABEL[prio]}` : 'Keine Priorität';
  return (
    <span className={`prio-ico p${prio}`} role="img" aria-label={label} title={label}>
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
const RANK: Record<string, number> = { done: 0, prog: 1, cl: 2, blocked: 3, unclear: 4, open: 5 };

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

export const CHEVRON_DOWN = '▾';
export const CHEVRON_RIGHT = '▸';

/** Ohne eigene Markierung gilt die Standard-Markierung „Aufgabe“. */
export const DEFAULT_MARK = { emoji: '📋', name: 'Aufgabe' };
