import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { pickActiveRelease } from '../shared/release.js';
import type { Milestone, Release, ReleaseStage, Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import { archive, create, loadBootstrap, loadChangelog, move, patch, remove } from './repo.js';
import { activeReleaseId, ensureSidequestGroups } from './sidequests.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-sq-'));
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

const mkProject = () => create(ctx, 'project', { name: 'Spiel' }) as { id: string };
const mkTask = (o: Record<string, unknown>) => create(ctx, 'task', o) as Task;
const mkMilestone = (o: Record<string, unknown>) => create(ctx, 'milestone', o) as Milestone;
const mkRelease = (projectId: string, name: string) => create(ctx, 'release', { projectId, name }) as Release;
const mkStage = (releaseId: string) => create(ctx, 'stage', { releaseId, name: 'itch' }) as ReleaseStage;
const task = (id: string) => loadBootstrap(ctx).tasks.find((t) => t.id === id) as Task;
const setStatus = (id: string, status: string) => patch(ctx, 'task', id, task(id).version, { status }) as Task;
const sidequests = (projectId: string) =>
  loadBootstrap(ctx).groups.find((g) => g.projectId === projectId && g.kind === 'sidequest');
const publish = (s: ReleaseStage) => patch(ctx, 'stage', s.id, s.version, { doneAt: '2026-10-24T12:00:00.000Z' });

describe('Nebenquests', () => {
  it('jedes Projekt hat genau eine Nebenquests-Gruppe, die sich nicht löschen lässt', () => {
    const p = mkProject();
    const g = sidequests(p.id);
    assert.equal(g?.title, 'Nebenquests');
    assert.equal(ensureSidequestGroups(ctx), 0);
    assert.throws(() => remove(ctx, 'group', g!.id), /nicht löschen/);
  });

  it('stempelt beim Beginnen mit dem aktiven Release und nimmt den Stempel beim Zurücklegen wieder weg', () => {
    const p = mkProject();
    const r = mkRelease(p.id, '0.4');
    const t = mkTask({ projectId: p.id, title: 'Bug', status: 'ready' });
    assert.equal(setStatus(t.id, 'progress').releasedIn, r.id);
    assert.equal(setStatus(t.id, 'ready').releasedIn, null);
    assert.equal(setStatus(t.id, 'done').releasedIn, r.id);
  });

  it('merkt sich Begonnenes ohne aktives Release vor und stempelt nach', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'Bug', status: 'ready' });
    assert.equal(setStatus(t.id, 'done').releasedIn, null);
    const r = mkRelease(p.id, '0.4');
    assert.equal(task(t.id).releasedIn, r.id);
  });

  it('der Bestand bleibt ungestempelt, auch wenn ein Release dazukommt', () => {
    const p = mkProject();
    const old = mkTask({ projectId: p.id, title: 'Alt' });
    ctx.sqlite.prepare(`UPDATE task SET status = 'done' WHERE id = ?`).run(old.id);
    mkRelease(p.id, '0.4');
    assert.equal(task(old.id).releasedIn, null);
  });

  it('in Release-Milestones gilt deren Release – gestempelt wird nicht, beim Herausnehmen kommt es mit', () => {
    const p = mkProject();
    mkRelease(p.id, '0.4');
    const next = mkRelease(p.id, '0.5');
    const m = mkMilestone({ projectId: p.id, title: 'M', releaseId: next.id });
    const t = mkTask({ projectId: p.id, milestoneId: m.id, title: 'A', status: 'ready' });
    assert.equal(setStatus(t.id, 'progress').releasedIn, null);
    move(ctx, t.id, task(t.id).version, { groupId: sidequests(p.id)!.id });
    assert.equal(task(t.id).releasedIn, next.id);
  });

  it('eine Unteraufgabe gibt ihren Stempel an die Aufgaben darüber weiter', () => {
    const p = mkProject();
    const r = mkRelease(p.id, '0.4');
    const parent = mkTask({ projectId: p.id, title: 'Stapel' });
    const kid = mkTask({ projectId: p.id, parentId: parent.id, title: 'Kind', status: 'ready' });
    setStatus(kid.id, 'progress');
    assert.equal(task(parent.id).releasedIn, r.id);
  });

  it('wählt das erste unveröffentlichte Release mit laufendem Milestone, sonst das erste überhaupt', () => {
    const p = mkProject();
    const a = mkRelease(p.id, '0.4');
    const b = mkRelease(p.id, '0.5');
    assert.equal(activeReleaseId(ctx, p.id), a.id);
    mkMilestone({ projectId: p.id, title: 'M', releaseId: b.id, status: 'progress' });
    assert.equal(activeReleaseId(ctx, p.id), b.id);
    assert.equal(
      pickActiveRelease([
        { id: 'x', order: 2, archived: false, released: false, running: false },
        { id: 'y', order: 1, archived: false, released: true, running: true },
      ]),
      'x',
    );
  });

  it('beim Veröffentlichen bleibt Erledigtes, Unerledigtes geht bereit zurück in die Nebenquests', () => {
    const p = mkProject();
    const r = mkRelease(p.id, '0.4');
    const s = mkStage(r.id);
    const done = mkTask({ projectId: p.id, title: 'Fertig', status: 'ready' });
    const open = mkTask({ projectId: p.id, title: 'Halb', status: 'ready' });
    const stack = mkTask({ projectId: p.id, title: 'Stapel' });
    const doneKid = mkTask({ projectId: p.id, parentId: stack.id, title: 'K1', status: 'ready' });
    const openKid = mkTask({ projectId: p.id, parentId: stack.id, title: 'K2', status: 'ready' });
    setStatus(done.id, 'done');
    setStatus(open.id, 'progress');
    setStatus(doneKid.id, 'done');
    setStatus(openKid.id, 'progress');

    publish(s);
    const next = mkRelease(p.id, '0.5');

    assert.equal(task(done.id).releasedIn, r.id);
    assert.equal(task(open.id).releasedIn, null);
    assert.equal(task(open.id).status, 'ready');
    assert.equal(task(open.id).groupId, sidequests(p.id)!.id);
    assert.equal(task(stack.id).releasedIn, null);
    assert.equal(task(stack.id).groupId, sidequests(p.id)!.id);
    assert.equal(task(doneKid.id).releasedIn, r.id);
    assert.equal(task(openKid.id).status, 'ready');
    assert.equal(task(openKid.id).releasedIn, null);
    // Wieder begonnen, geht es mit dem nächsten Release raus.
    assert.equal(setStatus(open.id, 'progress').releasedIn, next.id);
  });

  it('das Changelog sammelt Bonus-Aufgaben ein, auch archivierte; das Release zählt sie', () => {
    const p = mkProject();
    const r = mkRelease(p.id, '0.4');
    const t = mkTask({ projectId: p.id, title: 'Bug', status: 'ready' });
    setStatus(t.id, 'done');
    archive(ctx, 'task', t.id);
    assert.deepEqual(loadChangelog(ctx, r.id).tasks.map((x) => x.id), [t.id]);
    assert.equal(loadBootstrap(ctx).releases.find((x) => x.id === r.id)?.archivedBonus, 1);
  });

  it('beim Wechsel des Projekts bleibt der Stempel zurück', () => {
    const p = mkProject();
    const q = mkProject();
    mkRelease(p.id, '0.4');
    const t = mkTask({ projectId: p.id, title: 'Bug', status: 'ready' });
    setStatus(t.id, 'progress');
    move(ctx, t.id, task(t.id).version, { projectId: q.id });
    assert.equal(task(t.id).releasedIn, null);
  });
});
