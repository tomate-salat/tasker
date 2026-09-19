/**
 * Vergleicht die übernommene Logik mit dem Prototyp.
 *
 * Die Datei `prototype-parity.json` wurde im laufenden Prototyp erzeugt: sie
 * enthält dessen Beispieldaten und die Werte, die er selbst dafür errechnet.
 * Dieser Test füttert die neuen Funktionen mit denselben Daten und erwartet
 * dieselben Ergebnisse. Weicht etwas ab, ist beim Übernehmen etwas verrutscht.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { isBlocked } from './blocking.js';
import { effectiveCategory, effectiveTags } from './inherit.js';
import type { Data, Prio, Status, Task } from './model.js';
import {
  allDone,
  doneCount,
  milestoneProgressPct,
  milestoneStats,
  progressPct,
  statusSegments,
  total,
} from './progress.js';
import { schedule } from './schedule.js';
import { Workspace } from './workspace.js';

type Dump = {
  data: {
    projects: { id: string; name: string; color: string; order: number; categories: { id: string; name: string }[] }[];
    milestones: Record<string, unknown>[];
    groups: { id: string; project: string; title: string; order: number }[];
    marks: { id: string; emoji: string; name: string }[];
    tasks: Record<string, unknown>[];
    velocity: number;
    today: string;
  };
  expect: {
    tasks: Record<string, {
      total: number; done: number; pct: number; allDone: boolean;
      blocked: boolean; active: boolean; cat: string | null; tags: string[]; segs: string[];
    }>;
    milestones: Record<string, {
      stats: { tot: number; dn: number; open: number; count: number; done: boolean; tasksDone: boolean };
      pct: number; segs: string[];
    }>;
    schedule: {
      id: string; pos: number; deps: string[]; start: number; end: number;
      forecastEnd: number; late: boolean; early: boolean; fixed: boolean; fixedEnd: boolean; open: number;
    }[];
  };
};

const dump = JSON.parse(
  readFileSync(new URL('./prototype-parity.json', import.meta.url), 'utf8'),
) as Dump;

/** Übersetzt den Prototyp-State ins neue Datenmodell. */
function toData(d: Dump['data']): Data {
  return {
    projects: d.projects.map((p, i) => ({ id: p.id, name: p.name, color: p.color, order: i })),
    categories: d.projects.flatMap((p) =>
      p.categories.map((c, i) => ({ id: c.id, projectId: p.id, name: c.name, order: i })),
    ),
    marks: d.marks.map((k, i) => ({ ...k, order: i })),
    groups: d.groups.map((g) => ({ id: g.id, projectId: g.project, title: g.title, order: g.order })),
    milestones: d.milestones.map((m) => ({
      id: m['id'] as string,
      projectId: m['project'] as string,
      title: m['title'] as string,
      desc: m['desc'] as string,
      planned: m['planned'] as boolean,
      status: m['status'] as Status,
      order: m['order'] as number,
      qorder: m['qorder'] as number,
      startDate: (m['startDate'] as string | null) ?? null,
      endDate: (m['endDate'] as string | null) ?? null,
      endAuto: Boolean(m['endAuto']),
      archivedAt: (m['archived'] as string | null) ?? null,
      deps: m['deps'] as string[],
    })),
    tasks: d.tasks.map((t) => ({
      id: t['id'] as string,
      projectId: t['project'] as string,
      parentId: (t['parent'] as string | null) ?? null,
      milestoneId: (t['ms'] as string | null) ?? null,
      // Der Prototyp kennt die Pseudo-Gruppen 'doc' und 'k:<markId>';
      // im neuen Modell sind das ein Flag beziehungsweise die Markierung selbst.
      groupId: realGroupId(t['group'] as string | null),
      doc: t['group'] === 'doc',
      title: t['title'] as string,
      desc: t['desc'] as string,
      prio: t['prio'] as Prio,
      status: t['status'] as Status,
      doneAt: (t['doneAt'] as string | null) ?? null,
      order: t['order'] as number,
      categoryId: (t['cat'] as string | null) ?? null,
      markId: (t['mark'] as string | null) ?? null,
      archivedAt: (t['archived'] as string | null) ?? null,
      tags: t['tags'] as string[],
      deps: t['deps'] as string[],
    })),
  };
}

const realGroupId = (g: string | null): string | null =>
  !g || g === 'doc' || g.startsWith('k:') ? null : g;

const ws = new Workspace(toData(dump.data));
const segKey = (s: ReturnType<typeof statusSegments>[number]): string =>
  s.kind === 'checklist' ? `cl:${s.done ? 1 : 0}` : `t:${s.status}`;

describe('Gleichstand mit dem Prototyp', () => {
  const tasks = Object.entries(dump.expect.tasks);

  it(`kennt alle ${tasks.length} Aufgaben aus den Beispieldaten`, () => {
    assert.equal(ws.tasks.length, tasks.length);
  });

  for (const [id, want] of tasks) {
    it(`Aufgabe ${id} (${ws.task(id)?.title ?? '?'})`, () => {
      const t = ws.task(id) as Task;
      assert.equal(total(ws, t), want.total, 'Anzahl');
      assert.equal(doneCount(ws, t), want.done, 'erledigt');
      assert.equal(progressPct(ws, t), want.pct, 'Prozent');
      assert.equal(allDone(ws, t), want.allDone, 'allDone');
      assert.equal(isBlocked(ws, t), want.blocked, 'blockiert');
      assert.equal(ws.isActive(t), want.active, 'aktiv');
      assert.equal(effectiveCategory(ws, t)?.category.id ?? null, want.cat, 'Kategorie');
      assert.deepEqual(effectiveTags(ws, t).tags, want.tags, 'Labels');
      assert.deepEqual(statusSegments(ws, t).map(segKey), want.segs, 'Segmente');
    });
  }

  for (const [id, want] of Object.entries(dump.expect.milestones)) {
    it(`Milestone ${id} (${ws.milestone(id)?.title ?? '?'})`, () => {
      const m = ws.milestone(id)!;
      const s = milestoneStats(ws, m);
      // `unest` ist ein Rest der abgeschafften Punkte-Schätzung und im Prototyp
      // konstant 0; beim Übernehmen ist es entfallen.
      const { unest: _unest, ...want2 } = want.stats as typeof want.stats & { unest?: number };
      assert.deepEqual(
        { tot: s.total, dn: s.done, open: s.open, count: s.count, done: s.isDone, tasksDone: s.tasksDone },
        want2,
      );
      assert.equal(milestoneProgressPct(ws, m), want.pct, 'Prozent');
      assert.deepEqual(statusSegments(ws, m).map(segKey), want.segs, 'Segmente');
    });
  }

  it('Zeitplan stimmt überein', () => {
    const got = schedule(ws, {
      velocity: dump.data.velocity,
      today: new Date(dump.data.today),
    });
    assert.deepEqual(
      got.list.map((x) => ({
        id: x.milestone.id,
        pos: x.pos,
        deps: [...x.deps].sort(),
        start: x.start,
        end: x.end,
        forecastEnd: x.forecastEnd,
        late: x.late,
        early: x.early,
        fixed: x.fixed,
        fixedEnd: x.fixedEnd,
        open: x.open,
      })),
      dump.expect.schedule,
    );
  });
});
