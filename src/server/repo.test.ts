import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Milestone, Task } from '../shared/model.js';
import { createDbCtx, type DbCtx } from './db.js';
import {
  Conflict,
  NotFound,
  archive,
  create,
  hiddenMismatches,
  loadArchive,
  loadBootstrap,
  move,
  patch,
  remove,
  restore,
} from './repo.js';

const dir = mkdtempSync(join(tmpdir(), 'tasker-test-'));
const opened: DbCtx[] = [];

after(() => {
  // Erst schließen, sonst hält Windows die Dateien fest.
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
const active = () => loadBootstrap(ctx).tasks.map((t) => t.id).sort();

describe('Anlegen', () => {
  it('vergibt IDs mit Präfix und zählt die Reihenfolge hoch', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const b = mkTask({ projectId: p.id, title: 'B' });
    assert.match(a.id, /^t/);
    assert.equal(a.order, 0);
    assert.equal(b.order, 1);
  });

  it('ein Kind hängt nie zusätzlich an Milestone oder Gruppe', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const parent = mkTask({ projectId: p.id, title: 'Eltern', milestoneId: m.id });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: parent.id, milestoneId: m.id });
    assert.equal(kind.milestoneId, null);
    assert.equal(kind.parentId, parent.id);
  });

  it('nimmt Labels, Abhängigkeiten und Status schon beim Anlegen mit', () => {
    // Das braucht die Schnell-Erfassung: eine Zeile, eine fertige Aufgabe.
    const p = mkProject();
    const erst = mkTask({ projectId: p.id, title: 'Erst' });
    const t = mkTask({
      projectId: p.id,
      title: 'Danach',
      prio: 1,
      status: 'done',
      tags: ['code', 'ui'],
      deps: [erst.id],
    });

    assert.deepEqual(t.tags, ['code', 'ui']);
    assert.deepEqual(t.deps, [erst.id]);
    assert.equal(t.prio, 1);
    assert.equal(t.status, 'done');
    assert.ok(t.doneAt, 'erledigt angelegt heißt auch: mit Zeitpunkt');
  });
});

describe('Ändern mit Versionsprüfung', () => {
  it('erhöht die Version bei jeder Änderung', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'A' });
    const v1 = read(t.id);
    assert.equal(v1.version, 1);
    patch(ctx, 'task', t.id, 1, { title: 'B' });
    assert.equal(read(t.id).version, 2);
    assert.equal(read(t.id).title, 'B');
  });

  it('lehnt eine Änderung auf veraltetem Stand ab und liefert den aktuellen Stand', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'A' });
    patch(ctx, 'task', t.id, 1, { title: 'von Tab 1' });

    // Tab 2 kennt noch Version 1
    let caught: unknown;
    try {
      patch(ctx, 'task', t.id, 1, { title: 'von Tab 2' });
    } catch (e) {
      caught = e;
    }
    assert.ok(caught instanceof Conflict, 'erwartet: Conflict');
    // Der aktuelle Stand kommt mit, damit der Client nicht nachfragen muss.
    assert.equal((caught.current as Task).title, 'von Tab 1');
    assert.equal(read(t.id).title, 'von Tab 1');
  });

  it('meldet Unbekanntes als nicht gefunden', () => {
    assert.throws(() => patch(ctx, 'task', 'gibtsnicht', 1, { title: 'X' }), NotFound);
  });

  it('setzt und entfernt Labels', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'A' });
    patch(ctx, 'task', t.id, 1, { tags: ['code', 'ui'] });
    assert.deepEqual(one(t.id).tags, ['code', 'ui']);
    patch(ctx, 'task', t.id, 2, { tags: ['ui'] });
    assert.deepEqual(one(t.id).tags, ['ui']);
  });

  it('führt den Erledigt-Zeitpunkt mit dem Status', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'A' });
    patch(ctx, 'task', t.id, 1, { status: 'done' });
    assert.notEqual(one(t.id).doneAt, null);
    patch(ctx, 'task', t.id, 2, { status: 'open' });
    assert.equal(one(t.id).doneAt, null);
  });
});

describe('Archiv', () => {
  it('nimmt den Teilbaum mit, ohne ihn selbst zu archivieren', () => {
    const p = mkProject();
    const parent = mkTask({ projectId: p.id, title: 'Eltern' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: parent.id });
    const enkel = mkTask({ projectId: p.id, title: 'Enkel', parentId: kind.id });
    const frei = mkTask({ projectId: p.id, title: 'Frei' });

    archive(ctx, 'task', parent.id);

    assert.deepEqual(active(), [frei.id]);
    assert.equal(row(kind.id).hidden_by, parent.id);
    assert.equal(row(enkel.id).hidden_by, parent.id);
    // Nur der angeklickte Eintrag gilt als archiviert – das Archiv listet einen, nicht drei.
    assert.equal(row(kind.id).archived_at, null);
    assert.equal(loadArchive(ctx, { limit: 50, offset: 0 }).total, 1);
    assert.equal(loadArchive(ctx, { limit: 50, offset: 0 }).entries[0]?.hiddenCount, 2);
  });

  it('ein archivierter Milestone verdeckt auch seine Wurzelaufgaben', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const wurzel = mkTask({ projectId: p.id, title: 'Wurzel', milestoneId: m.id });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: wurzel.id });

    archive(ctx, 'milestone', m.id);

    assert.deepEqual(active(), []);
    assert.equal(row(wurzel.id).hidden_by, m.id);
    assert.equal(row(kind.id).hidden_by, m.id);
    assert.deepEqual(loadBootstrap(ctx).milestones, []);
  });

  it('Wiederherstellen holt nur zurück, was wegen dieses Eintrags verdeckt war', () => {
    const p = mkProject();
    const parent = mkTask({ projectId: p.id, title: 'Eltern' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: parent.id });
    const enkel = mkTask({ projectId: p.id, title: 'Enkel', parentId: kind.id });

    archive(ctx, 'task', kind.id); // Kind zuerst einzeln
    archive(ctx, 'task', parent.id); // dann der ganze Ast
    assert.equal(row(enkel.id).hidden_by, kind.id, 'der nähere Vorfahre gewinnt');

    restore(ctx, 'task', parent.id);
    // Das Kind war für sich archiviert und bleibt es
    assert.deepEqual(active(), [parent.id]);
    assert.equal(row(kind.id).archived_at !== null, true);
    assert.equal(row(enkel.id).hidden_by, kind.id);

    restore(ctx, 'task', kind.id);
    assert.deepEqual(active().sort(), [enkel.id, kind.id, parent.id].sort());
  });

  it('zählt das Archiv je Projekt, ohne es zu laden', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'A' });
    mkTask({ projectId: p.id, title: 'B', parentId: t.id });
    archive(ctx, 'task', t.id);
    assert.deepEqual(loadBootstrap(ctx).archiveCounts, { [p.id]: 1 });
  });
});

describe('Verschieben und die hidden_by-Invariante', () => {
  it('zieht hidden_by nach, wenn ein Ast ins Archiv wandert', () => {
    const p = mkProject();
    const archiviert = mkTask({ projectId: p.id, title: 'Archiviert' });
    const frei = mkTask({ projectId: p.id, title: 'Frei' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: frei.id });
    archive(ctx, 'task', archiviert.id);

    move(ctx, frei.id, read(frei.id).version as number, { parentId: archiviert.id });

    assert.equal(row(frei.id).hidden_by, archiviert.id);
    assert.equal(row(kind.id).hidden_by, archiviert.id);
    assert.deepEqual(active(), []);
    assert.deepEqual(hiddenMismatches(ctx), []);
  });

  it('macht den Ast beim Herausziehen wieder sichtbar', () => {
    const p = mkProject();
    const archiviert = mkTask({ projectId: p.id, title: 'Archiviert' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: archiviert.id });
    const enkel = mkTask({ projectId: p.id, title: 'Enkel', parentId: kind.id });
    archive(ctx, 'task', archiviert.id);

    move(ctx, kind.id, read(kind.id).version as number, { parentId: null });

    assert.equal(row(kind.id).hidden_by, null);
    assert.equal(row(enkel.id).hidden_by, null);
    assert.deepEqual(active().sort(), [enkel.id, kind.id].sort());
    assert.deepEqual(hiddenMismatches(ctx), []);
  });

  it('das Projekt des Ziels gilt für den ganzen Teilbaum', () => {
    const p1 = mkProject();
    const p2 = create(ctx, 'project', { name: 'Website' }) as { id: string };
    const ziel = mkTask({ projectId: p2.id, title: 'Ziel' });
    const t = mkTask({ projectId: p1.id, title: 'Wandert' });
    const kind = mkTask({ projectId: p1.id, title: 'Kind', parentId: t.id });

    move(ctx, t.id, read(t.id).version as number, { parentId: ziel.id });

    assert.equal(one(t.id).projectId, p2.id);
    assert.equal(one(kind.id).projectId, p2.id);
  });

  it('verhindert, dass eine Aufgabe unter ihre eigene Unteraufgabe wandert', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'A' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: t.id });
    assert.throws(() => move(ctx, t.id, read(t.id).version as number, { parentId: kind.id }));
  });

  it('die Invariante hält nach einer Folge von Eingriffen', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    const b = mkTask({ projectId: p.id, title: 'B', parentId: a.id });
    const c = mkTask({ projectId: p.id, title: 'C', parentId: b.id });
    const d = mkTask({ projectId: p.id, title: 'D' });

    archive(ctx, 'task', b.id);
    assert.deepEqual(hiddenMismatches(ctx), []);
    archive(ctx, 'milestone', m.id);
    assert.deepEqual(hiddenMismatches(ctx), []);
    move(ctx, d.id, read(d.id).version as number, { parentId: c.id });
    assert.deepEqual(hiddenMismatches(ctx), []);
    restore(ctx, 'milestone', m.id);
    assert.deepEqual(hiddenMismatches(ctx), []);
    restore(ctx, 'task', b.id);
    assert.deepEqual(hiddenMismatches(ctx), []);
    // a, b, c und das darunter geschobene d – alles wieder sichtbar
    assert.deepEqual(active().sort(), [a.id, b.id, c.id, d.id].sort());
  });
});

describe('Reihenfolge beim Verschieben', () => {
  /** Die Titel der Wurzelaufgaben eines Milestones in Anzeigereihenfolge. */
  const order = (milestoneId: string) =>
    (
      ctx.sqlite
        .prepare('SELECT title FROM task WHERE milestone_id = ? AND parent_id IS NULL ORDER BY sort_order')
        .all(milestoneId) as { title: string }[]
    ).map((r) => r.title);

  it('setzt eine Aufgabe auf den gewünschten Platz und nummeriert lückenlos neu', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    for (const title of ['A', 'B', 'C', 'D']) mkTask({ projectId: p.id, title, milestoneId: m.id });
    const d = loadBootstrap(ctx).tasks.find((t) => t.title === 'D')!;

    move(ctx, d.id, d.version, { milestoneId: m.id, index: 1 });

    assert.deepEqual(order(m.id), ['A', 'D', 'B', 'C']);
    // Lückenlos, damit der nächste Platz eindeutig bleibt.
    assert.deepEqual(
      loadBootstrap(ctx)
        .tasks.filter((t) => t.milestoneId === m.id)
        .map((t) => t.order)
        .sort(),
      [0, 1, 2, 3],
    );
  });

  it('zählt beim Einsortieren die verschobene Aufgabe nicht mit', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    for (const title of ['A', 'B', 'C']) mkTask({ projectId: p.id, title, milestoneId: m.id });
    const a = loadBootstrap(ctx).tasks.find((t) => t.title === 'A')!;

    // „Hinter C“ heißt Platz 2, wenn A schon aus der Liste genommen ist.
    move(ctx, a.id, a.version, { milestoneId: m.id, index: 2 });

    assert.deepEqual(order(m.id), ['B', 'C', 'A']);
  });

  /**
   * Im Backlog sind „Unsortiert“ und jede smarte Gruppe eigene Behälter,
   * obwohl alle Aufgaben darin lose an keinem Milestone und keiner Gruppe
   * hängen. Unterschieden werden sie an der Markierung.
   */
  it('nummeriert Unsortiert und smarte Gruppe getrennt', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { emoji: '🐛', name: 'Bug' }) as { id: string };
    for (const title of ['A', 'B']) mkTask({ projectId: p.id, title });
    for (const title of ['X', 'Y']) mkTask({ projectId: p.id, title, markId: k.id });
    const y = loadBootstrap(ctx).tasks.find((t) => t.title === 'Y')!;

    move(ctx, y.id, y.version, { projectId: p.id, markId: k.id, index: 0 });

    const loose = (markId: string | null) =>
      (
        ctx.sqlite
          .prepare(
            `SELECT title FROM task WHERE parent_id IS NULL AND milestone_id IS NULL
               AND group_id IS NULL AND mark_id IS ? ORDER BY sort_order`,
          )
          .all(markId) as { title: string }[]
      ).map((r) => r.title);

    assert.deepEqual(loose(k.id), ['Y', 'X']);
    // Die unmarkierten daneben bleiben unberührt.
    assert.deepEqual(loose(null), ['A', 'B']);
  });

  it('setzt beim Verschieben in eine smarte Gruppe die Markierung, im Backlog wieder weg', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { emoji: '🐛', name: 'Bug' }) as { id: string };
    const t = mkTask({ projectId: p.id, title: 'A' });

    move(ctx, t.id, one(t.id).version, { projectId: p.id, markId: k.id, index: 0 });
    assert.equal(one(t.id).markId, k.id);

    move(ctx, t.id, one(t.id).version, { projectId: p.id, markId: null, index: 0 });
    assert.equal(one(t.id).markId, null);
  });

  it('lässt die Markierung stehen, wenn keine mitgeschickt wird', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { emoji: '🐛', name: 'Bug' }) as { id: string };
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const t = mkTask({ projectId: p.id, title: 'A', markId: k.id });

    move(ctx, t.id, one(t.id).version, { milestoneId: m.id, index: 0 });

    assert.equal(one(t.id).markId, k.id);
  });

  it('nimmt das Projekt aus dem Ziel, wenn der Behälter keines mitbringt', () => {
    const p1 = mkProject();
    const p2 = create(ctx, 'project', { name: 'Website' }) as { id: string };
    const t = mkTask({ projectId: p1.id, title: 'Wandert' });
    const kind = mkTask({ projectId: p1.id, title: 'Kind', parentId: t.id });

    move(ctx, t.id, one(t.id).version, { projectId: p2.id, index: 0 });

    assert.equal(one(t.id).projectId, p2.id);
    assert.equal(one(kind.id).projectId, p2.id);
  });
});

describe('Bootstrap', () => {
  it('liefert Verweise ins Archiv als Platzhalter statt das Archiv zu laden', () => {
    const p = mkProject();
    const alt = mkTask({ projectId: p.id, title: 'Alte Vorarbeit' });
    const neu = mkTask({ projectId: p.id, title: 'Neu' });
    patch(ctx, 'task', neu.id, 1, { deps: [alt.id] });
    archive(ctx, 'task', alt.id);

    const boot = loadBootstrap(ctx);
    assert.deepEqual(boot.tasks.map((t) => t.id), [neu.id]);
    assert.deepEqual(boot.stubs, [{ id: alt.id, title: 'Alte Vorarbeit', archived: true }]);
    assert.deepEqual(boot.tasks[0]?.deps, [alt.id]);
  });

  it('bringt Labels und Abhängigkeiten der aktiven Aufgaben mit', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const b = mkTask({ projectId: p.id, title: 'B' });
    patch(ctx, 'task', b.id, 1, { tags: ['code'], deps: [a.id] });

    const boot = loadBootstrap(ctx);
    const got = boot.tasks.find((t) => t.id === b.id)!;
    assert.deepEqual(got.tags, ['code']);
    assert.deepEqual(got.deps, [a.id]);
  });
});

describe('Löschen', () => {
  it('legt eine Kopie in den Papierkorb und entfernt den Teilbaum', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'Eltern' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: t.id });
    patch(ctx, 'task', kind.id, 1, { tags: ['code'] });

    remove(ctx, 'task', t.id);

    assert.deepEqual(active(), []);
    const trash = ctx.sqlite.prepare('SELECT * FROM trash').all() as {
      kind: string;
      title: string;
      payload: string;
    }[];
    assert.equal(trash.length, 1);
    assert.equal(trash[0]?.title, 'Eltern');
    const payload = JSON.parse(trash[0]!.payload) as { tasks: unknown[]; tags: unknown[] };
    assert.equal(payload.tasks.length, 2);
    assert.equal(payload.tags.length, 1);
  });

  /**
   * Milestone und Gruppe sind eine Ablage, kein Besitzer: wird die Ablage
   * gelöscht, bleiben die Aufgaben und liegen unter „Unsortiert“ – wie im
   * Prototyp.
   */
  it('ein gelöschter Milestone lässt seine Aufgaben stehen', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });

    remove(ctx, 'milestone', m.id);

    assert.deepEqual(active().sort(), [a.id, kind.id].sort());
    assert.equal(one(a.id).milestoneId, null);
    assert.deepEqual(loadBootstrap(ctx).milestones, []);
    assert.deepEqual(hiddenMismatches(ctx), []);
  });

  it('eine gelöschte Gruppe lässt ihre Aufgaben stehen', () => {
    const p = mkProject();
    const g = create(ctx, 'group', { projectId: p.id, title: 'G' }) as { id: string };
    const a = mkTask({ projectId: p.id, title: 'A', groupId: g.id });

    remove(ctx, 'group', g.id);

    assert.deepEqual(active(), [a.id]);
    assert.equal(one(a.id).groupId, null);
  });

  it('die Aufgaben eines archivierten Milestones werden wieder sichtbar, wenn er gelöscht wird', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    archive(ctx, 'milestone', m.id);
    assert.deepEqual(active(), []);

    remove(ctx, 'milestone', m.id);

    assert.deepEqual(active(), [a.id]);
    assert.deepEqual(hiddenMismatches(ctx), []);
  });

  it('räumt verwaiste Abhängigkeiten ab', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const b = mkTask({ projectId: p.id, title: 'B' });
    patch(ctx, 'task', b.id, 1, { deps: [a.id] });
    remove(ctx, 'task', a.id);
    assert.equal(
      (ctx.sqlite.prepare('SELECT count(*) AS c FROM dependency').get() as { c: number }).c,
      0,
    );
  });
});

/* ------------------------------------------------------------------ Hilfen */

const row = (id: string) =>
  ctx.sqlite.prepare('SELECT * FROM task WHERE id = ?').get(id) as {
    hidden_by: string | null;
    archived_at: string | null;
  };

const read = (id: string) =>
  ctx.sqlite.prepare('SELECT * FROM task WHERE id = ?').get(id) as {
    version: number;
    title: string;
  };

/** Auch archivierte Aufgaben, direkt aus der Tabelle ins Modell. */
const one = (id: string): Task => {
  const boot = loadBootstrap(ctx);
  const found = boot.tasks.find((t) => t.id === id);
  if (found) return found;
  // Für archivierte Aufgaben reicht hier ein Rückgriff auf die Rohzeile.
  const r = ctx.sqlite.prepare('SELECT * FROM task WHERE id = ?').get(id) as Record<string, unknown>;
  const tags = (
    ctx.sqlite.prepare('SELECT tag FROM task_tag WHERE task_id = ? ORDER BY tag').all(id) as {
      tag: string;
    }[]
  ).map((x) => x.tag);
  return { ...(r as unknown as Task), tags, doneAt: (r['done_at'] as string | null) ?? null };
};
