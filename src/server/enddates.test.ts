import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dayKey } from '../shared/burnup.js';
import type { Milestone, Release } from '../shared/model.js';
import { dateFromWeeks } from '../shared/schedule.js';
import { createDbCtx, type DbCtx } from './db.js';
import { create, loadBootstrap, patch } from './repo.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-end-'));
const opened: DbCtx[] = [];

after(() => {
  for (const c of opened) c.sqlite.close();
  rmSync(dir, { recursive: true, force: true });
});

let ctx: DbCtx;
let n = 0;

beforeEach(() => {
  ctx = createDbCtx(join(dir, `t${n++}.db`));
  opened.push(ctx);
  migrate(ctx.db, { migrationsFolder: 'db/migrations' });
});

const ms = (id: string) => loadBootstrap(ctx).milestones.find((m) => m.id === id) as Milestone;
const rel = (id: string) => loadBootstrap(ctx).releases.find((r) => r.id === id) as Release;
const set = (id: string, changes: Record<string, unknown>) => patch(ctx, 'milestone', id, ms(id).version, changes);
/** Ein Release mit Milestones aus so vielen Aufgaben – beim Tempo 8 sind 8 Aufgaben eine Woche. */
function setup(...sizes: [string, number, Record<string, unknown>?][]) {
  const p = create(ctx, 'project', { name: 'Spiel' }) as { id: string };
  const r = create(ctx, 'release', { projectId: p.id, name: '0.4' }) as Release;
  const ids = sizes.map(([title, count, o]) => {
    const m = create(ctx, 'milestone', { projectId: p.id, releaseId: r.id, title, ...o }) as Milestone;
    for (let i = 0; i < count; i++) create(ctx, 'task', { projectId: p.id, milestoneId: m.id, title: `${title}${i}` });
    return m.id;
  });
  return { r, ids };
}
const inWeeks = (w: number) => dayKey(dateFromWeeks(w));

describe('Marschplan', () => {
  it('beim ersten Start eines Releases wird die Prognose zum Enddatum – Gesetztes bleibt', () => {
    const { r, ids } = setup(['A', 8], ['B', 16], ['C', 8, { endDate: '2027-06-01' }]);
    const [a, b, c] = ids as [string, string, string];
    assert.equal(rel(r.id).readyPlanned, null);

    set(a, { status: 'progress' });
    assert.equal(ms(a).endDate, inWeeks(1));
    assert.equal(ms(b).endDate, inWeeks(3));
    assert.equal(ms(c).endDate, '2027-06-01');
    assert.equal(ms(a).endAuto, false);
    // Bereit, wenn der letzte fertig ist – hier C mit seinem Enddatum.
    assert.equal(rel(r.id).readyPlanned, '2027-06-01');
    // Das Festhalten ist keine Verschiebung.
    assert.deepEqual(ms(a).endChanges, []);
  });

  it('ohne festes Datum ist das Release bereit, wenn die Prognose des letzten durch ist', () => {
    const { r, ids } = setup(['A', 8], ['B', 8]);
    set(ids[0]!, { status: 'progress' });
    assert.equal(rel(r.id).readyPlanned, inWeeks(2));
  });

  it('nur beim ersten Mal – ein weiterer Start schreibt nichts neu', () => {
    const { r, ids } = setup(['A', 8], ['B', 8]);
    const [a, b] = ids as [string, string];
    set(a, { status: 'progress' });
    const ready = rel(r.id).readyPlanned;
    set(b, { endDate: null });
    set(b, { status: 'progress' });
    assert.equal(ms(b).endDate, null);
    assert.equal(rel(r.id).readyPlanned, ready);
  });

  it('merkt sich Verschiebungen des Enddatums nur, solange der Milestone läuft', () => {
    const { ids } = setup(['A', 8], ['B', 8]);
    const [a, b] = ids as [string, string];
    set(b, { endDate: '2027-01-10' });
    set(a, { status: 'progress' });
    assert.deepEqual(ms(b).endChanges, []);

    const before = ms(a).endDate;
    set(a, { endDate: '2027-02-01', endAuto: false });
    set(a, { endDate: null });
    const list = ms(a).endChanges;
    assert.deepEqual(list.map(({ from, to }) => ({ from, to })), [
      { from: before, to: '2027-02-01' },
      { from: '2027-02-01', to: null },
    ]);
    assert.ok(!Number.isNaN(Date.parse(list[0]!.at)));
  });

  it('„Erledigt“ führt den Zeitpunkt mit und lässt das Enddatum stehen', () => {
    const { ids } = setup(['A', 8]);
    const a = ids[0]!;
    set(a, { status: 'progress' });
    const end = ms(a).endDate;
    set(a, { status: 'done' });
    assert.ok(ms(a).doneAt);
    assert.equal(ms(a).endDate, end);
    assert.deepEqual(ms(a).endChanges, []);
    set(a, { status: 'progress' });
    assert.equal(ms(a).doneAt, null);
  });
});
