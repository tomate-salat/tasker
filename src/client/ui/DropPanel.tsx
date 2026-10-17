import { useRef } from 'react';
import type { Milestone, Task } from '@shared/model.js';
import {
  draftMilestones,
  groupsOf,
  groupTasks,
  plannedMilestones,
  unsortedId,
  unsortedTasks,
  type OutlineRow,
} from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { dropTarget, useZone, type Drag, type Target } from './dnd.js';

/**
 * Das Ablage-Panel (Wunsch des Nutzers): wird eine Aufgabe gezogen, gleitet
 * rechts ein Panel mit allen Zielen des Projekts herein – Unsortiert und die
 * eigenen Gruppen, die vorbereiteten Milestones und die im Plan, dazu Doku und
 * Archiv. Die Liste bleibt dabei, wie sie ist; auch ein Filter verdeckt hier
 * kein Ziel. Ist der Inspektor offen, tritt er solange zur Seite – seine
 * Abhängigkeitsfelder stehen dann hier.
 *
 * Das Panel bleibt eingehängt und gleitet nur hinein und hinaus; beim Hinaus
 * zeigt es weiter den Stand des letzten Ziehens.
 */
export function DropPanel({ ws, drag }: { ws: Workspace; drag: Drag | null }) {
  const last = useRef<Drag | null>(null);
  if (drag) last.current = drag;
  const shown = drag ?? last.current;
  const selected = useStore((s) => (s.multi.size > 1 ? null : s.selected));

  const task = shown ? ws.task(shown.id) : null;
  const projectId = task?.projectId ?? null;
  // Das Gegenüber im Inspektor – eine Abhängigkeit auf sich selbst gibt es nicht.
  const other = selected && !shown?.ids.includes(selected) ? (ws.task(selected) ?? ws.milestone(selected)) : null;

  return (
    <aside className={`drop-panel ${drag ? 'in' : ''}`} aria-hidden={!drag}>
      <div className="dp-head">Ablegen in …</div>
      {projectId && <Targets ws={ws} projectId={projectId} other={other} />}
    </aside>
  );
}

function Targets({ ws, projectId, other }: { ws: Workspace; projectId: string; other: Task | Milestone | null }) {
  const group = (row: Extract<OutlineRow, { type: 'group' }>) => (
    <Tile key={row.id} target={{ type: 'group', row }}>
      {row.title}
    </Tile>
  );
  const milestone = (m: Milestone) => (
    <Tile key={m.id} target={{ type: 'milestone', milestone: m }}>
      <span className="dp-ms">◆</span> {m.title || 'Ohne Titel'}
    </Tile>
  );
  const drafts = draftMilestones(ws, projectId);
  const planned = plannedMilestones(ws, projectId);

  return (
    <div className="dp-body">
      <Section title="Backlog">
        {group({
          type: 'group',
          id: unsortedId(projectId),
          title: 'Unsortiert',
          group: null,
          projectId,
          place: {},
          tasks: unsortedTasks(ws, projectId),
        })}
        {groupsOf(ws, projectId).map((g) =>
          group({
            type: 'group',
            id: g.id,
            title: g.title || 'Neue Gruppe',
            group: g,
            projectId,
            place: { groupId: g.id },
            tasks: groupTasks(ws, g.id),
          }),
        )}
      </Section>
      {drafts.length > 0 && <Section title="Vorbereitete Milestones">{drafts.map(milestone)}</Section>}
      {planned.length > 0 && <Section title="Im Plan">{planned.map(milestone)}</Section>}
      {other && (
        <Section title={`Abhängigkeit zu „${other.title || 'Ohne Titel'}“`}>
          <div className="dp-row">
            <Tile target={{ type: 'dep', dir: 'by', item: other }}>Benötigt</Tile>
            <Tile target={{ type: 'dep', dir: 'blocks', item: other }}>Blockiert</Tile>
          </div>
        </Section>
      )}
      <Section title="Sonst">
        <div className="dp-row">
          <Tile target={{ type: 'tab', view: 'docs', panel: true }}>Dokumentation</Tile>
          <Tile target={{ type: 'tab', view: 'archive', panel: true }}>Archiv</Tile>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="dp-sec">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Tile({ target, children }: { target: Target; children: React.ReactNode }) {
  const zone = useZone(target);
  return (
    <div className={`dp-tile ${zone ? 'on' : ''}`} {...dropTarget(target)}>
      {children}
    </div>
  );
}
