import { useRef, useState } from 'react';
import { backfillLog, burnupData, monotonePath, msPoints, withNow } from '@shared/burnup.js';
import type { Milestone } from '@shared/model.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';

const BU = { W: 460, H: 190, L: 30, R: 40, T: 18, B: 24 };

const fmtD = (d: Date): string => d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

/**
 * Burnup im Milestone-Inspektor, wie `burnupHtml` und `attachBurnup` im
 * Prototyp: Committed und Erledigt je Tag seit dem Start, gestrichelt die
 * Prognose bis zum Ende, beim Überfahren Datum und Werte.
 *
 * Das Protokoll kommt vom Server, mit Zeitpunkten in UTC; auf Tage verteilt
 * wird es hier, in der Zeitzone des Browsers. Den aktuellen Stand rechnet die
 * Ansicht selbst aus den Daten, damit die Kurve jeder Änderung sofort folgt.
 */
export function Burnup({ ws, milestone: m }: { ws: Workspace; milestone: Milestone }) {
  const stored = useStore((s) => s.boot?.milestoneLog?.[m.id]);
  const archived = useStore((s) => s.boot?.archivedPoints?.[m.id]);
  const velocity = useStore((s) => s.settings.velocity);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<{ i: number; s: number; dn: number; fc: boolean } | null>(null);

  const { s: nowS, dn: nowDn } = msPoints(ws, m, archived);
  const log = withNow(stored?.length ? stored : backfillLog(ws, m), nowS, nowDn, new Date().toISOString());
  const d = burnupData(m, log, velocity);
  if (!d) return null;

  const { W, H, L, R, T, B } = BU;
  const top = Math.ceil(d.maxV * 1.1);
  const xs = (i: number): number => L + (i / d.maxI) * (W - L - R);
  const ys = (v: number): number => T + (1 - v / top) * (H - T - B);
  const dateAt = (i: number): Date => {
    const x = new Date(`${d.start}T12:00:00`);
    x.setDate(x.getDate() + Math.round(i));
    return x;
  };
  const line = (arr: number[]): string => monotonePath(arr.map((v, i) => [xs(i), ys(v)]));
  const doneLine = line(d.doneS);
  const doneArea = `${doneLine}V${ys(0)}H${xs(0)}Z`;
  const late = d.fcI !== null && d.deadI !== null && d.fcI > d.deadI + 0.5;

  const labels: { x: number; t: string; cls: string }[] = [];
  if (!d.done) labels.push({ x: xs(d.todayI), t: 'Heute', cls: '' });
  if (d.deadI !== null) labels.push({ x: xs(d.deadI), t: `Ende ${fmtD(dateAt(d.deadI))}`, cls: 'bd-dead-lbl' });
  labels.sort((a, b) => a.x - b.x);
  const near = labels.length > 1 && Math.abs((labels[1] as { x: number }).x - (labels[0] as { x: number }).x) < 70;

  // Direkte Werte am Ende der beiden Linien; rücken auseinander, wenn sie sich überdecken würden.
  let yS = ys(d.s);
  let yD = ys(d.dn);
  if (Math.abs(yS - yD) < 12) {
    if (yS <= yD) {
      yS -= 6;
      yD += 6;
    } else {
      yS += 6;
      yD -= 6;
    }
  }
  const ex = xs(d.endI) + 5;

  /**
   * Wie weit die gepunktete Linie des committeten Umfangs nach rechts läuft:
   * bis zum geplanten Ende, und wenn die Prognose darüber hinausgeht, bis
   * dorthin. Vorher endete sie an der Prognose und ließ den Rest der Fläche
   * leer, als wäre ab da nichts mehr committet.
   */
  const scopeEndI = Math.max(d.todayI, d.fcI ?? d.todayI, d.deadI ?? d.todayI);

  const onMove = (e: React.MouseEvent): void => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(Math.max(0, Math.min(d.maxI, ((px - L) / (W - L - R)) * d.maxI)));
    if (i <= d.endI) setHover({ i, s: d.scope[i] as number, dn: d.doneS[i] as number, fc: false });
    else if (d.fcI !== null && i <= Math.ceil(d.fcI)) {
      const dn = Math.min(d.s, d.dn + ((d.s - d.dn) * (i - d.todayI)) / (d.fcI - d.todayI));
      setHover({ i, s: d.s, dn, fc: true });
    } else setHover(null);
  };

  const tip = (() => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!hover || !r) return null;
    const left = (xs(hover.i) / W) * r.width;
    const flip = left > r.width - 170;
    return (
      <div
        className="bd-tip"
        style={{
          left: flip ? left - 10 : left + 10,
          top: (ys(hover.s) / H) * r.height - 8,
          transform: flip ? 'translate(-100%, -100%)' : 'translate(0, -100%)',
        }}
      >
        <b>{fmtD(dateAt(hover.i))}</b>
        {hover.fc ? ' · Prognose' : ''}
        <br />
        Committed {hover.s} · Erledigt {Math.round(hover.dn * 10) / 10}
      </div>
    );
  })();

  return (
    <section className="d-section">
      <div className="h3row">
        <h3>Burnup</h3>
        <span className="hint" style={{ margin: 0 }}>
          {d.dn} von {d.s} Aufgaben erledigt
        </span>
      </div>
      <div className="burnup">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Burnup: ${d.dn} von ${d.s} committeten Aufgaben erledigt`}
        >
          {[0, Math.round(top / 2), top].map((v) => (
            <g key={v}>
              <line className="bd-grid" x1={L} x2={W - R} y1={ys(v)} y2={ys(v)} />
              <text className="bd-lbl" x={L - 6} y={ys(v) + 3} textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          <path className="bd-area" d={doneArea} />
          {!d.done && <line className="bd-today" x1={xs(d.todayI)} x2={xs(d.todayI)} y1={T - 4} y2={H - B} />}
          {d.deadI !== null && (
            <line className="bd-dead" x1={xs(d.deadI)} x2={xs(d.deadI)} y1={T - 4} y2={H - B} />
          )}
          {!d.done && scopeEndI > d.todayI && (
            <line className="bu-scope-fc" x1={xs(d.todayI)} y1={ys(d.s)} x2={xs(scopeEndI)} y2={ys(d.s)} />
          )}
          {d.fcI !== null && (
            <line className="bd-fc" x1={xs(d.todayI)} y1={ys(d.dn)} x2={xs(d.fcI)} y2={ys(d.s)} />
          )}
          <path className="bu-scope" d={line(d.scope)} />
          <path className="bd-actual" d={doneLine} />
          <text className="bd-lbl bu-val" x={ex} y={yS + 3}>
            {d.s}
          </text>
          <text className="bd-lbl bu-val acc" x={ex} y={yD + 3}>
            {d.dn}
          </text>
          {labels.map((l, i) => {
            const anchor = near ? (i === 0 ? 'end' : 'start') : l.x > W - R - 30 ? 'end' : 'middle';
            return (
              <text
                key={l.t}
                className={`bd-lbl ${l.cls}`}
                x={l.x + (anchor === 'end' ? -4 : anchor === 'start' ? 4 : 0)}
                y={T - 7}
                textAnchor={anchor}
              >
                {l.t}
              </text>
            );
          })}
          <text className="bd-lbl" x={L} y={H - 6}>
            {fmtD(dateAt(0))}
          </text>
          <text className="bd-lbl" x={W - R} y={H - 6} textAnchor="end">
            {fmtD(dateAt(d.maxI))}
          </text>
          {hover && (
            <>
              <line className="bd-cross" x1={xs(hover.i)} x2={xs(hover.i)} y1={T} y2={H - B} />
              <circle className="bu-dot-s" r={4} cx={xs(hover.i)} cy={ys(hover.s)} />
              <circle className="bd-dot" r={4} cx={xs(hover.i)} cy={ys(hover.dn)} />
            </>
          )}
          <rect
            className="bd-hit"
            x={L}
            y={T}
            width={W - L - R}
            height={H - T - B}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          />
        </svg>
        {tip}
      </div>
      <div className="bd-legend">
        <span>
          <i className="sw scope" />
          Committed
        </span>
        <span>
          <i className="sw actual" />
          Erledigt
        </span>
        {d.fcI !== null && (
          <span>
            <i className="sw fc" />
            Prognose {fmtD(dateAt(d.fcI))}
          </span>
        )}
      </div>
      {(d.added > 0 || d.removed > 0) && (
        <p className="hint" style={{ marginTop: 6 }}>
          Seit Start {d.added ? `+${d.added} ${d.added === 1 ? 'Aufgabe' : 'Aufgaben'} hinzugekommen` : ''}
          {d.added && d.removed ? ', ' : ''}
          {d.removed ? `−${d.removed} ${d.removed === 1 ? 'Aufgabe' : 'Aufgaben'} entfernt` : ''}.
        </p>
      )}
      {late && (
        <p className="hint warn-text" style={{ marginTop: 4 }}>
          Die Prognose liegt {Math.round((d.fcI as number) - (d.deadI as number))} Tage nach dem Enddatum.
        </p>
      )}
    </section>
  );
}
