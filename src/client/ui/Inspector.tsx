import { useEffect, useState } from 'react';
import type { Milestone, Status, Task } from '@shared/model.js';
import { milestoneStats, statusSegments } from '@shared/progress.js';
import { blockers } from '@shared/blocking.js';
import { effectiveCategory, effectiveTags } from '@shared/inherit.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { PRIO_LABEL, PrioIcon, SegBar, STATUS_LABEL, statusMark } from './icons.js';

/** Fortschrittskette links, Sonderstatus rechts – zusammen eine Auswahl. */
const PROGRESS_CHAIN: Status[] = ['open', 'progress', 'done'];
const SPECIAL: Status[] = ['unclear', 'blocked'];

/**
 * Ein Inspektor für Aufgaben und Milestones, mit denselben beschrifteten Zeilen
 * für beide. Dokumente sind bewusst eine Ausnahme und kommen später.
 */
export function Inspector({ ws, id }: { ws: Workspace; id: string }) {
  const task = ws.task(id);
  const milestone = ws.milestone(id);
  const select = useStore((s) => s.select);

  if (!task && !milestone) return null;
  const kind = task ? 'task' : 'milestone';
  const item = (task ?? milestone) as Task | Milestone;

  return (
    <aside className="detail">
      <div className="d-head">
        <TitleField kind={kind} item={item} />
        <button className="icon-btn" onClick={() => select(null)} title="Schließen" aria-label="Inspektor schließen">
          ✕
        </button>
      </div>

      <div className="meta">
        <Row label="Status">
          <StatusGroups kind={kind} item={item} />
        </Row>

        {task && <TaskRows ws={ws} task={task} />}
        {milestone && <MilestoneRows ws={ws} milestone={milestone} />}
      </div>

      <Actions kind={kind} id={item.id} />
    </aside>
  );
}

function TaskRows({ ws, task }: { ws: Workspace; task: Task }) {
  const segments = statusSegments(ws, task);
  const cat = effectiveCategory(ws, task);
  const tags = effectiveTags(ws, task);
  const blocking = blockers(ws, task);
  const patch = useStore((s) => s.patch);

  return (
    <>
      {segments.length > 0 && (
        <Row label="Fortschritt">
          <SegBar segments={segments} />
        </Row>
      )}

      <Row label="Priorität">
        <div className="seg">
          {([0, 1, 2, 3] as const).map((p) => (
            <button
              key={p}
              className={task.prio === p ? 'on' : ''}
              onClick={() => void patch('task', task.id, { prio: p })}
              title={p ? `Priorität ${PRIO_LABEL[p]}` : 'Keine Priorität'}
            >
              <PrioIcon prio={p} />
            </button>
          ))}
        </div>
      </Row>

      <Row label="Kategorie">
        {cat ? (
          <span className={`chip ${cat.from ? 'inherited' : ''}`} title={cat.from ? `Von „${cat.from.title}“ geerbt` : undefined}>
            {cat.category.name}
          </span>
        ) : (
          <span className="empty-val">keine</span>
        )}
      </Row>

      <Row label="Labels">
        {tags.tags.length ? (
          <span className="chips">
            {tags.own.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
            {tags.extra.map((x) => (
              <span key={x.tag} className="tag inherited" title={`Aus Unteraufgabe „${x.from.title}“`}>
                {x.tag}
              </span>
            ))}
          </span>
        ) : (
          <span className="empty-val">keine</span>
        )}
      </Row>

      {blocking.length > 0 && (
        <Row label="Blockiert durch">
          <span className="chips">
            {blocking.map((b) => (
              <span key={b.id} className="chip warn">
                {b.title}
              </span>
            ))}
          </span>
        </Row>
      )}
    </>
  );
}

function MilestoneRows({ ws, milestone }: { ws: Workspace; milestone: Milestone }) {
  const stats = milestoneStats(ws, milestone);
  return (
    <>
      <Row label="Fortschritt">
        <SegBar segments={statusSegments(ws, milestone)} />
        <span className="sub">
          {stats.done} von {stats.total} erledigt
        </span>
      </Row>
      <Row label="Zeitraum">
        <span className={milestone.startDate ? '' : 'empty-val'}>
          {milestone.startDate ?? 'kein Start'}
        </span>
        <span className="sep">–</span>
        <span className={milestone.endDate ? '' : 'empty-val'}>
          {milestone.endDate ?? 'kein Ende'}
        </span>
      </Row>
    </>
  );
}

function StatusGroups({ kind, item }: { kind: 'task' | 'milestone'; item: Task | Milestone }) {
  const patch = useStore((s) => s.patch);
  const button = (s: Status) => (
    <button
      key={s}
      className={`st-${s} ${item.status === s ? 'on' : ''}`}
      role="radio"
      aria-checked={item.status === s}
      onClick={() => void patch(kind, item.id, { status: s })}
      title={STATUS_LABEL[s]}
    >
      <span className="st-ico" aria-hidden="true">
        {statusMark(s) || '·'}
      </span>
      <span>{STATUS_LABEL[s]}</span>
    </button>
  );

  return (
    <div className="status-groups" role="radiogroup" aria-label="Status">
      <div className="seg status-seg">{PROGRESS_CHAIN.map(button)}</div>
      <div className="seg status-seg">{SPECIAL.map(button)}</div>
    </div>
  );
}

function TitleField({ kind, item }: { kind: 'task' | 'milestone'; item: Task | Milestone }) {
  const patch = useStore((s) => s.patch);
  const [draft, setDraft] = useState(item.title);

  // Kommt von außen ein neuer Titel (anderes Objekt, fremde Änderung), gewinnt der.
  useEffect(() => setDraft(item.title), [item.id, item.title]);

  const commit = () => {
    if (draft !== item.title) void patch(kind, item.id, { title: draft });
  };

  return (
    <input
      className="d-title"
      value={draft}
      placeholder="Ohne Titel"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setDraft(item.title);
      }}
    />
  );
}

function Actions({ kind, id }: { kind: 'task' | 'milestone'; id: string }) {
  const archive = useStore((s) => s.archive);
  return (
    <div className="d-actions">
      <button className="btn ghost" onClick={() => void archive(kind, id)}>
        Archivieren
      </button>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="m-row">
      <span className="m-lbl">{label}</span>
      <div className="m-val">{children}</div>
    </div>
  );
}
