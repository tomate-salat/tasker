import type { CSSProperties, ReactNode } from 'react';
import type { Status } from '@shared/model.js';
import { dateFromWeeks, isoWeek, schedule, type ScheduledMilestone } from '@shared/schedule.js';
import type { Workspace } from '@shared/workspace.js';
import { scopeProjectIds, useStore } from '../store.js';

const MS_STATUS: Record<Status, string> = {
  open: 'Offen',
  progress: 'In Progress',
  done: 'Done',
  blocked: 'Blockiert',
  unclear: 'Unklar',
};

/** Ein Stück Balken – Anfang und Ende in Wochen ab heute. */
type Segment = { cls: string; from: number; to: number; title: string };

/**
 * Der Zeitplan aus dem Prototyp: eine Zeile je eingeplantem Milestone, der
 * Balken zeigt den gerechneten Zeitraum auf einer Wochenachse.
 *
 * Gerechnet wird immer über alle Projekte – du arbeitest allein, also liegen
 * die Milestones hintereinander. Der Projektfilter wählt nur aus, welche
 * Zeilen davon sichtbar sind.
 */
export function Timeline({ ws }: { ws: Workspace }) {
  const state = useStore();
  const { settings, scope, select } = state;
  const velocity = Math.max(1, settings.velocity);
  const all = schedule(ws, { velocity }).list;
  const ids = new Set(scopeProjectIds(state));
  const list = all.filter((x) => ids.has(x.milestone.projectId));

  if (!list.length) return <div className="empty-state">Keine Milestones im Plan.</div>;

  // Die Achse umfasst alles, was Platz braucht – auch Vergangenes und auch
  // Milestones aus anderen Projekten, damit die Balken vergleichbar bleiben.
  const shown = all.filter((x) => x.open || x.fixed || x.fixedEnd);
  const minW = Math.min(0, Math.floor(Math.min(0, ...shown.map((x) => x.start))));
  const maxW = Math.max(minW + 4, Math.ceil(Math.max(...all.map((x) => Math.max(x.end, x.forecastEnd)))));
  const span = maxW - minW;
  const pos = (w: number): number => ((w - minW) / span) * 100;
  const step = span > 24 ? 4 : span > 12 ? 2 : 1;

  const ticks: number[] = [];
  for (let w = minW; w <= maxW; w += step) ticks.push(w);

  return (
    <div className="tl">
      <p className="tl-note">
        Du arbeitest allein, also werden alle Milestones im Plan{' '}
        <b>projektübergreifend nacheinander</b> eingeplant – in der Reihenfolge des Plans, außer eine
        Abhängigkeit erzwingt etwas anderes. Hat ein Milestone ein <b>Startdatum</b>, beginnt er dort
        – so steuerst du den Zeitplan; der blassere Teil des Balkens ist die bereits vergangene Zeit,
        die Restarbeit wird ab heute gerechnet. Die Dauer ergibt sich aus den offenen Aufgaben und
        deinem Tempo. Vorbereitete Milestones im Backlog zählen nicht mit.
      </p>

      <div className="tl-axis">
        <span>Milestone</span>
        <span>Zeitraum</span>
        <div className="tl-weeks">
          {ticks.map((w) => (
            <span key={w} style={{ left: `${pos(w)}%` }}>
              KW{isoWeek(dateFromWeeks(w))}
            </span>
          ))}
        </div>
      </div>

      {list.map((x) => (
        <Row
          key={x.milestone.id}
          ws={ws}
          x={x}
          velocity={velocity}
          span={span}
          pos={pos}
          showProject={scope === 'all'}
          showToday={minW < 0}
          onSelect={() => select(x.milestone.id)}
        />
      ))}
    </div>
  );
}

function Row({
  ws,
  x,
  velocity,
  span,
  pos,
  showProject,
  showToday,
  onSelect,
}: {
  ws: Workspace;
  x: ScheduledMilestone;
  velocity: number;
  span: number;
  pos: (w: number) => number;
  showProject: boolean;
  showToday: boolean;
  onSelect: () => void;
}) {
  const m = x.milestone;
  const project = ws.project(m.projectId);
  const color = project?.color ?? 'var(--accent)';
  const waits = x.deps.map((d) => ws.milestone(d)?.title).filter((t): t is string => !!t);

  const segments: Segment[] = [];
  let note: ReactNode = null;
  const workFrom = Math.max(x.start, 0);

  if (x.isDone) {
    if ((x.fixed || x.fixedEnd) && x.end > x.start) {
      segments.push({
        cls: 'donebar',
        from: x.start,
        to: x.end,
        title: `Done${x.fixedEnd && m.endDate ? ` am ${day(new Date(m.endDate))}` : ''}`,
      });
      note = (
        <span className="tl-done" style={{ paddingLeft: `${pos(x.end)}%` }}>
          ✓
        </span>
      );
    } else {
      note = <span className="tl-done">✓ Done</span>;
    }
  } else if (!x.open && !x.fixedEnd && !x.fixed) {
    note = <span className="tl-done">keine offenen Aufgaben</span>;
  } else {
    // Ein Startdatum in der Vergangenheit bekommt einen blassen Vorlauf.
    if (x.fixed && x.start < 0 && m.startDate) {
      segments.push({
        cls: 'past',
        from: x.start,
        to: Math.min(0, x.end),
        title: `Läuft seit ${day(new Date(m.startDate))}`,
      });
    }
    segments.push({
      cls: '',
      from: workFrom,
      to: x.end,
      title: `${x.open} offene Aufgaben ≈ ${(x.open / velocity).toFixed(1)} Wochen`,
    });
    if (x.late) {
      segments.push({
        cls: 'over',
        from: Math.max(x.end, workFrom),
        to: x.forecastEnd,
        title: `Prognose ${day(dateFromWeeks(x.forecastEnd))} – nach dem Enddatum`,
      });
    }
  }

  const startLabel = x.fixed && m.startDate ? day(new Date(m.startDate)) : day(dateFromWeeks(x.start));
  const endLabel = x.fixedEnd && m.endDate ? day(new Date(m.endDate)) : day(dateFromWeeks(x.end));
  const dates =
    x.open || x.fixedEnd || (x.fixed && !x.isDone)
      ? `${startLabel} → ${x.open || x.fixedEnd ? endLabel : ''}`
      : x.isDone && x.fixed
        ? `${startLabel} →`
        : '–';

  return (
    <div className="tl-row">
      <div>
        <div className="tl-name">
          <span className="dot" style={{ background: color }} aria-hidden="true" />
          <button className="linkish" onClick={onSelect}>
            {m.title || 'Ohne Titel'}
          </button>
        </div>
        <div className="tl-sub">
          {showProject && `${project?.name ?? ''} · `}
          {MS_STATUS[m.status]}
          {x.fixed && m.startDate && ` ${x.start <= 0 ? 'seit' : 'ab'} ${day(new Date(m.startDate))}`}
          {` · ${x.done}/${x.total} erledigt`}
          {x.early ? (
            <> · <span className="warn-text">startet vor Ende von {waits.join(', ')}</span></>
          ) : waits.length ? (
            <> · <span className="wait">wartet auf {waits.join(', ')}</span></>
          ) : null}
          {x.late && (
            <>
              {' · '}
              <span className="warn-text">
                Prognose {day(dateFromWeeks(x.forecastEnd))} – nach dem Enddatum
              </span>
            </>
          )}
        </div>
      </div>

      <div className="tl-dates">{dates}</div>

      <div className="tl-track" style={{ '--wk': `${100 / span}%` } as CSSProperties}>
        {showToday && <span className="tl-today" style={{ left: `${pos(0)}%` }} title="Heute" />}
        {segments
          .filter((s) => s.to > s.from)
          .map((s, i) => (
            <i
              key={i}
              className={`tl-bar ${s.cls}`}
              style={{ left: `${pos(s.from)}%`, width: `${pos(s.to) - pos(s.from)}%`, background: color }}
              title={s.title}
            />
          ))}
        {note}
      </div>
    </div>
  );
}

const day = (d: Date): string => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
