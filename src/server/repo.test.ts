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
  applySteps,
  archive,
  bulk,
  convertToMilestone,
  create,
  duplicate,
  hiddenMismatches,
  loadArchive,
  loadBootstrap,
  loadTrash,
  move,
  patch,
  purgeTrash,
  remove,
  restore,
  restoreTrash,
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
    // Der Unterbaum kommt zum Aufklappen mit.
    assert.deepEqual(
      loadArchive(ctx, { limit: 50, offset: 0 }).tasks.map((t) => t.id).sort(),
      [parent.id, kind.id, enkel.id].sort(),
    );
  });

  // Prototyp `restore`: liegt der alte Ort im Archiv, kommt die Aufgabe lose in den Backlog.
  it('einzeln Archiviertes in einem archivierten Eltern kommt lose zurück', () => {
    const p = mkProject();
    const parent = mkTask({ projectId: p.id, title: 'Eltern' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: parent.id });
    const enkel = mkTask({ projectId: p.id, title: 'Enkel', parentId: kind.id });
    archive(ctx, 'task', kind.id);
    archive(ctx, 'task', parent.id);

    const r = restore(ctx, 'task', kind.id, { toEnd: true });
    assert.equal(r.moved, true);
    assert.equal(one(kind.id).parentId, null);
    assert.deepEqual(active(), [kind.id, enkel.id].sort());
    assert.deepEqual(hiddenMismatches(ctx), []);
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

  it('zählt den Platz nur unter den aktiven Geschwistern, wie die Liste', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    for (const title of ['X', 'A', 'B', 'C']) mkTask({ projectId: p.id, title, milestoneId: m.id });
    const x = loadBootstrap(ctx).tasks.find((t) => t.title === 'X')!;
    archive(ctx, 'task', x.id);
    const c = loadBootstrap(ctx).tasks.find((t) => t.title === 'C')!;

    // Die Liste zeigt A, B, C – „vor B“ ist dort Platz 1.
    move(ctx, c.id, c.version, { milestoneId: m.id, index: 1 });

    assert.deepEqual(order(m.id), ['X', 'A', 'C', 'B']);
  });

  /**
   * Lose Aufgaben hängen an keinem Milestone und keiner Gruppe, stehen aber in
   * verschiedenen Behältern: „Unsortiert“ im Backlog (nicht ready) und in
   * „Ready“ je Markierung, ohne Markierung je Kategorie.
   */
  it('nummeriert Unsortiert und die Gruppen in „Ready“ getrennt', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { projectId: p.id, emoji: '🐛', name: 'Bug' }) as { id: string };
    const c = create(ctx, 'category', { projectId: p.id, name: 'Arena' }) as { id: string };
    for (const title of ['A', 'B']) mkTask({ projectId: p.id, title, markId: k.id });
    for (const title of ['X', 'Y']) mkTask({ projectId: p.id, title, ready: true, markId: k.id });
    for (const title of ['R', 'S']) mkTask({ projectId: p.id, title, ready: true, categoryId: c.id });
    const byTitle = (title: string) => loadBootstrap(ctx).tasks.find((t) => t.title === title)!;

    move(ctx, byTitle('Y').id, byTitle('Y').version, { projectId: p.id, ready: true, markId: k.id, index: 0 });
    move(ctx, byTitle('S').id, byTitle('S').version, {
      projectId: p.id,
      ready: true,
      markId: null,
      categoryId: c.id,
      index: 0,
    });
    move(ctx, byTitle('B').id, byTitle('B').version, { projectId: p.id, ready: false, index: 0 });

    const titles = (where: string, ...params: unknown[]) =>
      (
        ctx.sqlite
          .prepare(
            `SELECT title FROM task WHERE parent_id IS NULL AND milestone_id IS NULL
               AND group_id IS NULL AND ${where} ORDER BY sort_order`,
          )
          .all(...params) as { title: string }[]
      ).map((r) => r.title);

    assert.deepEqual(titles('ready = 0'), ['B', 'A']);
    assert.deepEqual(titles('ready = 1 AND mark_id = ?', k.id), ['Y', 'X']);
    assert.deepEqual(titles('ready = 1 AND category_id = ?', c.id), ['S', 'R']);
  });

  it('in eine Gruppe von „Ready“ setzt ready, Markierung oder Kategorie; zurück nach Unsortiert lässt beides', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { projectId: p.id, emoji: '🐛', name: 'Bug' }) as { id: string };
    const c = create(ctx, 'category', { projectId: p.id, name: 'Arena' }) as { id: string };
    const t = mkTask({ projectId: p.id, title: 'A' });

    move(ctx, t.id, one(t.id).version, { projectId: p.id, ready: true, markId: k.id, index: 0 });
    assert.deepEqual([one(t.id).ready, one(t.id).markId], [true, k.id]);

    // In eine Kategorie-Gruppe: die Markierung geht, sonst stünde sie bei der Markierung.
    move(ctx, t.id, one(t.id).version, { projectId: p.id, ready: true, markId: null, categoryId: c.id, index: 0 });
    assert.deepEqual([one(t.id).ready, one(t.id).markId, one(t.id).categoryId], [true, null, c.id]);

    move(ctx, t.id, one(t.id).version, { projectId: p.id, markId: k.id, index: 0 });
    move(ctx, t.id, one(t.id).version, { projectId: p.id, ready: false, index: 0 });
    assert.deepEqual([one(t.id).ready, one(t.id).markId, one(t.id).categoryId], [false, k.id, c.id]);
  });

  it('ready gibt es nur für lose Wurzeln – in Gruppe, Milestone oder unter eine Aufgabe fällt es weg', () => {
    const p = mkProject();
    const g = create(ctx, 'group', { projectId: p.id, title: 'G' }) as { id: string };
    const t = mkTask({ projectId: p.id, title: 'A', ready: true });
    assert.equal(one(t.id).ready, true);

    move(ctx, t.id, one(t.id).version, { groupId: g.id, index: 0 });
    assert.equal(one(t.id).ready, false);

    // Zurück lose ohne Angabe: bleibt im Backlog.
    move(ctx, t.id, one(t.id).version, { projectId: p.id, index: 0 });
    assert.equal(one(t.id).ready, false);

    const inGroup = mkTask({ projectId: p.id, title: 'B', groupId: g.id, ready: true });
    assert.equal(one(inGroup.id).ready, false);
  });

  it('lässt die Markierung stehen, wenn keine mitgeschickt wird', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { projectId: p.id, emoji: '🐛', name: 'Bug' }) as { id: string };
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

  // Wie im Prototyp (`trashItem`): im Archiv gehören die Aufgaben zum Milestone.
  it('ein archivierter Milestone nimmt seine Aufgaben mit in den Papierkorb', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });
    archive(ctx, 'milestone', m.id);

    const { trashId } = remove(ctx, 'milestone', m.id);
    assert.deepEqual(active(), []);
    assert.equal(loadArchive(ctx, { limit: 50, offset: 0 }).total, 0);
    assert.equal(loadTrash(ctx)[0]?.taskCount, 2);
    assert.equal(loadTrash(ctx)[0]?.where, 'aus dem Archiv');

    restoreTrash(ctx, trashId, { toEnd: true });
    assert.deepEqual(active(), []);
    assert.equal(row(kind.id).parent_id, a.id);
    assert.equal(row(a.id).hidden_by, m.id);
    assert.deepEqual(loadArchive(ctx, { limit: 50, offset: 0 }).entries.map((e) => e.id), [m.id]);
    assert.deepEqual(hiddenMismatches(ctx), []);
  });

  it('ein wiederhergestellter Milestone holt seine Aufgaben zurück und reiht sich hinten ein', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M', planned: true });
    const n = mkMilestone({ projectId: p.id, title: 'N', planned: true });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    const b = mkTask({ projectId: p.id, title: 'B', milestoneId: m.id });

    const { trashId } = remove(ctx, 'milestone', m.id);
    // B ist inzwischen woanders hin – das bleibt so.
    move(ctx, b.id, one(b.id).version, { parentId: a.id });

    const r = restoreTrash(ctx, trashId, { toEnd: true });
    assert.equal(r.label, 'im Plan');
    assert.equal(one(a.id).milestoneId, m.id);
    assert.equal(one(b.id).parentId, a.id);
    const ms = loadBootstrap(ctx).milestones.sort((x, y) => x.qorder - y.qorder);
    assert.deepEqual(ms.map((x) => x.id), [n.id, m.id]);
  });

  it('eine Aufgabe, deren Eltern weg sind, kommt lose in den Backlog zurück', () => {
    const p = mkProject();
    const parent = mkTask({ projectId: p.id, title: 'Eltern' });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: parent.id });
    const { trashId } = remove(ctx, 'task', kind.id);
    remove(ctx, 'task', parent.id);

    const r = restoreTrash(ctx, trashId, { toEnd: true });
    assert.equal(one(kind.id).parentId, null);
    assert.equal(r.label, 'im Backlog › Unsortiert · Spiel');
    assert.equal(loadTrash(ctx).find((e) => e.title === 'Eltern')?.where, 'im Backlog › Unsortiert · Spiel');
  });

  it('ohne sein Projekt lässt sich ein Eintrag nicht wiederherstellen', () => {
    const p = mkProject();
    create(ctx, 'project', { name: 'Anderes' });
    const t = mkTask({ projectId: p.id, title: 'T' });
    const { trashId } = remove(ctx, 'task', t.id);
    remove(ctx, 'project', p.id);

    assert.throws(() => restoreTrash(ctx, trashId), /stell zuerst das Projekt wieder her/);
  });

  it('endgültig Gelöschtes kommt mit Rückgängig zurück in den Papierkorb', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const b = mkTask({ projectId: p.id, title: 'B' });
    const x = remove(ctx, 'task', a.id).trashId;
    const y = remove(ctx, 'task', b.id).trashId;

    const { count, undo } = purgeTrash(ctx, [x, y]);
    assert.equal(count, 2);
    assert.deepEqual(loadTrash(ctx), []);

    applySteps(ctx, undo);
    assert.deepEqual(loadTrash(ctx).map((e) => e.title).sort(), ['A', 'B']);
    restoreTrash(ctx, x);
    assert.equal(one(a.id).title, 'A');
  });

  /**
   * „Endgültig löschen“ im Kontextmenü ist Papierkorb plus sofortiges Leeren.
   * Die Rücknahme verkettet beide Gegen-Schritte: erst zurück in den
   * Papierkorb, dann wieder heraus – in einer Transaktion.
   */
  it('direkt endgültig gelöscht kommt mit einem Rückgängig ganz zurück', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const trashId = remove(ctx, 'task', a.id).trashId;
    const { undo } = purgeTrash(ctx, [trashId]);
    assert.deepEqual(loadTrash(ctx), []);

    applySteps(ctx, [...undo, { op: 'untrash', trashId }]);
    assert.deepEqual(loadTrash(ctx), []);
    assert.equal(one(a.id).title, 'A');
  });

  /**
   * Ein Projekt besitzt Kategorien, Gruppen und Milestones – sie gehen mit in
   * den Papierkorb und kommen beim Wiederherstellen samt Zuordnung zurück.
   */
  it('ein gelöschtes Projekt kommt vollständig wieder', () => {
    const p = mkProject();
    const other = create(ctx, 'project', { name: 'Website' }) as { id: string };
    const c = create(ctx, 'category', { projectId: p.id, name: 'Technik' }) as { id: string };
    const g = create(ctx, 'group', { projectId: p.id, title: 'G' }) as { id: string };
    const m = mkMilestone({ projectId: p.id, title: 'M', planned: true });
    const m2 = mkMilestone({ projectId: p.id, title: 'M2', planned: true });
    patch(ctx, 'milestone', m2.id, 1, { deps: [m.id] });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    const kind = mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });
    patch(ctx, 'task', kind.id, 1, { categoryId: c.id, tags: ['code'] });
    const b = mkTask({ projectId: p.id, title: 'B', groupId: g.id });
    // Das Kind wird zur Wurzel und B sein Elternteil: das Kind liegt dann vor B in der Tabelle.
    move(ctx, kind.id, 2, { parentId: b.id });
    const x = mkTask({ projectId: other.id, title: 'X' });
    patch(ctx, 'task', x.id, 1, { deps: [a.id] });

    const { trashId } = remove(ctx, 'project', p.id);
    const empty = loadBootstrap(ctx);
    assert.deepEqual(empty.projects.map((q) => q.id), [other.id]);
    assert.deepEqual(empty.milestones, []);

    restoreTrash(ctx, trashId);
    const boot = loadBootstrap(ctx);
    assert.deepEqual(boot.projects.map((q) => q.id).sort(), [p.id, other.id].sort());
    assert.deepEqual(boot.categories.map((q) => q.id), [c.id]);
    assert.deepEqual(boot.groups.map((q) => q.id), [g.id]);
    assert.deepEqual(boot.milestones.map((q) => q.id).sort(), [m.id, m2.id].sort());
    assert.deepEqual(boot.milestones.find((q) => q.id === m2.id)?.deps, [m.id]);
    assert.equal(one(a.id).milestoneId, m.id);
    assert.equal(one(b.id).groupId, g.id);
    assert.equal(one(kind.id).parentId, b.id);
    assert.equal(one(kind.id).categoryId, c.id);
    assert.deepEqual(one(kind.id).tags, ['code']);
    assert.deepEqual(one(x.id).deps, [a.id]);
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

describe('Mehrfachauswahl', () => {
  const at = (t: Task) => ({ id: t.id, version: t.version });

  it('setzt ein Feld auf allen ausgewählten Aufgaben', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const b = mkTask({ projectId: p.id, title: 'B' });

    const r = bulk(ctx, [at(a), at(b)], { type: 'patch', changes: { prio: 1 } });

    assert.equal(r.count, 2);
    assert.equal(one(a.id).prio, 1);
    assert.equal(one(b.id).prio, 1);
  });

  it('nimmt eine Aufgabe auch dann mit, wenn ihr Elternteil ausgewählt ist – beim Ändern', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const k = mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });

    bulk(ctx, [at(a), at(k)], { type: 'patch', changes: { status: 'done' } });

    assert.equal(one(k.id).status, 'done');
  });

  it('fügt ein Label hinzu, ohne die vorhandenen zu verlieren, und nimmt es wieder weg', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A', tags: ['code'] });
    const b = mkTask({ projectId: p.id, title: 'B' });

    bulk(ctx, [at(one(a.id)), at(one(b.id))], { type: 'tag', tag: 'ui', add: true });
    assert.deepEqual(one(a.id).tags.sort(), ['code', 'ui']);
    assert.deepEqual(one(b.id).tags, ['ui']);

    bulk(ctx, [at(one(a.id)), at(one(b.id))], { type: 'tag', tag: 'ui', add: false });
    assert.deepEqual(one(a.id).tags, ['code']);
    assert.deepEqual(one(b.id).tags, []);
  });

  /** Beim Verschieben zählt nur die oberste ausgewählte Ebene – sonst risse es den Baum auseinander. */
  it('verschiebt nur die obersten Ausgewählten und hängt sie hinten an', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const schon = mkTask({ projectId: p.id, title: 'Schon da', milestoneId: m.id });
    const a = mkTask({ projectId: p.id, title: 'A' });
    const k = mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });
    const b = mkTask({ projectId: p.id, title: 'B' });

    const r = bulk(ctx, [at(a), at(k), at(b)], { type: 'move', target: { milestoneId: m.id } });

    assert.equal(r.count, 2);
    assert.equal(one(k.id).parentId, a.id, 'das Kind bleibt, wo es ist');
    const inMs = loadBootstrap(ctx)
      .tasks.filter((t) => t.milestoneId === m.id)
      .sort((x, y) => x.order - y.order)
      .map((t) => t.title);
    assert.deepEqual(inMs, ['Schon da', 'A', 'B']);
  });

  /** Ziehen einer Auswahl zwischen zwei Zeilen: alle zusammen an genau diese Stelle. */
  it('setzt verschobene Ausgewählte mit Platzangabe als Block an die Stelle', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const x = mkTask({ projectId: p.id, title: 'X', milestoneId: m.id });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    mkTask({ projectId: p.id, title: 'Y', milestoneId: m.id });
    const b = mkTask({ projectId: p.id, title: 'B' });

    // Hinter X, also Platz 1 unter den übrigen (X, Y).
    bulk(ctx, [at(a), at(b)], { type: 'move', target: { milestoneId: m.id, index: 1 } });

    const inMs = loadBootstrap(ctx)
      .tasks.filter((t) => t.milestoneId === m.id)
      .sort((u, v) => u.order - v.order)
      .map((t) => t.title);
    assert.deepEqual(inMs, ['X', 'A', 'B', 'Y']);
    assert.equal(one(x.id).order, 0);
  });

  it('archiviert und löscht ebenfalls nur die obersten Ausgewählten', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const k = mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });

    assert.equal(bulk(ctx, [at(a), at(k)], { type: 'archive' }).count, 1);
    assert.deepEqual(active(), []);
    assert.deepEqual(hiddenMismatches(ctx), []);

    restore(ctx, 'task', a.id);
    assert.equal(bulk(ctx, [at(one(a.id)), at(one(k.id))], { type: 'trash' }).count, 1);
    assert.deepEqual(active(), []);
  });

  /** Alles oder nichts: eine überholte Version darf nicht die halbe Auswahl ändern. */
  it('lässt bei einer veralteten Version den ganzen Stapel liegen', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const b = mkTask({ projectId: p.id, title: 'B' });

    assert.throws(
      () => bulk(ctx, [at(a), { id: b.id, version: 99 }], { type: 'patch', changes: { prio: 2 } }),
      Conflict,
    );
    assert.equal(one(a.id).prio, 0);
  });
});

describe('Schritte und Rücknahme', () => {
  const at = (t: Task) => ({ id: t.id, version: t.version });

  it('führt gemischte Schritte aus und liefert die Gegen-Schritte', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });

    const done = applySteps(ctx, [
      { op: 'archive', kind: 'milestone', id: m.id },
      { op: 'patch', kind: 'task', id: a.id, version: a.version, changes: { prio: 2 } },
    ]);

    assert.equal(done.count, 2);
    assert.equal(one(a.id).prio, 2);
    assert.deepEqual(loadBootstrap(ctx).milestones, []);

    // Rückwärts: erst die Änderung zurück, dann das Archiv.
    applySteps(ctx, done.undo);
    assert.equal(one(a.id).prio, 0);
    assert.equal(loadBootstrap(ctx).milestones.length, 1);
    assert.deepEqual(hiddenMismatches(ctx), []);
  });

  it('holt eine gelöschte Aufgabe samt Teilbaum aus dem Papierkorb zurück', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    mkTask({ projectId: p.id, title: 'Kind', parentId: a.id });

    const done = applySteps(ctx, [{ op: 'trash', kind: 'task', id: a.id }]);
    assert.deepEqual(active(), []);

    applySteps(ctx, done.undo);
    assert.equal(loadBootstrap(ctx).tasks.length, 2);
  });

  /** Die Rücknahme muss die Reihenfolge wiederherstellen, nicht nur den Behälter. */
  it('stellt beim Zurückschieben auch den alten Platz wieder her', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id });
    mkTask({ projectId: p.id, title: 'B', milestoneId: m.id });
    mkTask({ projectId: p.id, title: 'C', milestoneId: m.id });

    const done = bulk(ctx, [at(a)], { type: 'move', target: { groupId: null, projectId: p.id } });
    applySteps(ctx, done.undo);

    const inMs = loadBootstrap(ctx)
      .tasks.filter((t) => t.milestoneId === m.id)
      .sort((x, y) => x.order - y.order)
      .map((t) => t.title);
    assert.deepEqual(inMs, ['A', 'B', 'C']);
  });

  it('lehnt eine Rücknahme auf veraltetem Stand ab', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const done = bulk(ctx, [at(a)], { type: 'patch', changes: { prio: 1 } });

    // Jemand anderes ändert dazwischen.
    patch(ctx, 'task', a.id, one(a.id).version, { title: 'anders' });

    assert.throws(() => applySteps(ctx, done.undo), Conflict);
    assert.equal(one(a.id).prio, 1, 'nichts halb zurückgenommen');
  });
});

describe('Duplizieren', () => {
  it('kopiert den ganzen Teilbaum samt Labels und legt ihn direkt darunter', () => {
    const p = mkProject();
    const m = mkMilestone({ projectId: p.id, title: 'M' });
    const a = mkTask({ projectId: p.id, title: 'A', milestoneId: m.id, tags: ['ui'] });
    mkTask({ projectId: p.id, title: 'A1', parentId: a.id });
    mkTask({ projectId: p.id, title: 'B', milestoneId: m.id });

    const copy = duplicate(ctx, a.id);
    const boot = loadBootstrap(ctx);
    const inMs = boot.tasks
      .filter((t) => t.milestoneId === m.id)
      .sort((x, y) => x.order - y.order)
      .map((t) => t.title);

    assert.deepEqual(inMs, ['A', 'A (Kopie)', 'B'], 'die Kopie liegt direkt unter dem Original');
    const made = boot.tasks.find((t) => t.id === copy.id) as Task;
    assert.deepEqual(made.tags, ['ui']);
    assert.equal(made.version, 1);
    const kids = boot.tasks.filter((t) => t.parentId === copy.id);
    assert.deepEqual(kids.map((t) => t.title), ['A1'], 'Unteraufgaben heißen weiter wie vorher');
  });

  it('eine Unteraufgabe wird unter demselben Elternteil kopiert', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const kid = mkTask({ projectId: p.id, title: 'A1', parentId: a.id });

    const copy = duplicate(ctx, kid.id);
    const made = loadBootstrap(ctx).tasks.find((t) => t.id === copy.id) as Task;
    assert.equal(made.parentId, a.id);
    assert.equal(made.title, 'A1 (Kopie)');
  });
});

describe('In Milestone umwandeln', () => {
  /** Armor mit zwei Unteraufgaben, dazu Kategorie, Label und Abhängigkeiten. */
  const scene = () => {
    const p = mkProject();
    const cat = create(ctx, 'category', { projectId: p.id, name: 'Feature' }) as { id: string };
    const vorher = mkTask({ projectId: p.id, title: 'Vorher' });
    const armor = mkTask({
      projectId: p.id,
      title: 'Armor',
      categoryId: cat.id,
      tags: ['art'],
      deps: [vorher.id],
    });
    const a = mkTask({ projectId: p.id, title: 'Actors', parentId: armor.id, tags: ['ui'] });
    const b = mkTask({ projectId: p.id, title: 'Repair', parentId: armor.id });
    const wartet = mkTask({ projectId: p.id, title: 'Wartet', deps: [armor.id] });
    return { p, cat, vorher, armor, a, b, wartet };
  };

  it('macht aus dem Task einen vorbereiteten Milestone mit seiner Verweis-Nummer', () => {
    const s = scene();
    const out = convertToMilestone(ctx, s.armor.id, s.armor.version);
    const boot = loadBootstrap(ctx);
    const ms = boot.milestones.find((m) => m.id === out.id) as Milestone;

    assert.equal(ms.title, 'Armor');
    assert.equal(ms.planned, false);
    assert.equal(ms.ref, s.armor.ref, 'Verweise im Text zeigen weiter aufs Richtige');
    assert.equal(out.count, 2);
    assert.equal(boot.tasks.some((t) => t.id === s.armor.id), false, 'der Task ist weg');
    assert.deepEqual(
      boot.tasks.filter((t) => t.milestoneId === ms.id).map((t) => t.title),
      ['Actors', 'Repair'],
    );
  });

  it('gibt Kategorie, Labels und Blocker an die Unteraufgaben weiter', () => {
    const s = scene();
    convertToMilestone(ctx, s.armor.id, s.armor.version);
    const boot = loadBootstrap(ctx);
    const a = boot.tasks.find((t) => t.id === s.a.id) as Task;
    const b = boot.tasks.find((t) => t.id === s.b.id) as Task;

    assert.equal(a.categoryId, s.cat.id);
    assert.deepEqual(a.tags, ['art', 'ui']);
    assert.deepEqual(a.deps, [s.vorher.id], 'geerbte Blocker bleiben erhalten');
    assert.deepEqual(b.deps, [s.vorher.id]);
  });

  it('wer auf den Task gewartet hat, wartet danach auf den Milestone', () => {
    const s = scene();
    const out = convertToMilestone(ctx, s.armor.id, s.armor.version);
    const wartet = loadBootstrap(ctx).tasks.find((t) => t.id === s.wartet.id) as Task;
    assert.deepEqual(wartet.deps, [out.id]);
  });

  it('nimmt eigene Kategorie und Labels der Unteraufgabe nicht weg', () => {
    const p = mkProject();
    const eigene = create(ctx, 'category', { projectId: p.id, name: 'Bug' }) as { id: string };
    const andere = create(ctx, 'category', { projectId: p.id, name: 'Feature' }) as { id: string };
    const armor = mkTask({ projectId: p.id, title: 'Armor', categoryId: andere.id });
    const kid = mkTask({ projectId: p.id, title: 'Kind', parentId: armor.id, categoryId: eigene.id });

    convertToMilestone(ctx, armor.id, armor.version);
    assert.equal(one(kid.id).categoryId, eigene.id);
  });

  it('ohne Unteraufgaben geht es nicht', () => {
    const p = mkProject();
    const t = mkTask({ projectId: p.id, title: 'Allein' });
    assert.throws(() => convertToMilestone(ctx, t.id, t.version), /Unteraufgaben/);
  });

  it('auf einem überholten Stand gibt es einen Konflikt', () => {
    const s = scene();
    assert.throws(() => convertToMilestone(ctx, s.armor.id, s.armor.version + 1), Conflict);
  });

  it('die Rücknahme stellt Task, Unteraufgaben und Abhängigkeiten wieder her', () => {
    const s = scene();
    const out = convertToMilestone(ctx, s.armor.id, s.armor.version);
    applySteps(ctx, out.undo);

    const boot = loadBootstrap(ctx);
    const armor = boot.tasks.find((t) => t.id === s.armor.id) as Task;
    assert.ok(armor, 'der Task ist zurück');
    assert.equal(armor.ref, s.armor.ref);
    assert.deepEqual(armor.deps, [s.vorher.id]);
    assert.equal(boot.milestones.some((m) => m.id === out.id), false, 'der Milestone ist weg');
    assert.equal(loadTrash(ctx).length, 0, 'und liegt auch nicht im Papierkorb');
    assert.deepEqual(
      boot.tasks.filter((t) => t.parentId === s.armor.id).map((t) => t.title),
      ['Actors', 'Repair'],
    );
    const a = boot.tasks.find((t) => t.id === s.a.id) as Task;
    assert.deepEqual(a.tags, ['ui'], 'die weitergegebenen Labels sind wieder weg');
    assert.equal(a.categoryId, null);
    assert.deepEqual(
      boot.tasks.find((t) => t.id === s.wartet.id)?.deps,
      [s.armor.id],
      'wer gewartet hat, wartet wieder auf den Task',
    );
  });
});

describe('Milestone in ein anderes Projekt', () => {
  it('nimmt seine Wurzelaufgaben mitsamt Unteraufgaben mit', () => {
    const a = mkProject();
    const b = create(ctx, 'project', { name: 'Website' }) as { id: string };
    const m = mkMilestone({ projectId: a.id, title: 'M' });
    const root = mkTask({ projectId: a.id, title: 'A', milestoneId: m.id });
    const kid = mkTask({ projectId: a.id, title: 'A1', parentId: root.id });
    const other = mkTask({ projectId: a.id, title: 'Lose' });

    patch(ctx, 'milestone', m.id, m.version, { projectId: b.id });

    const boot = loadBootstrap(ctx);
    const project = (id: string) => boot.tasks.find((t) => t.id === id)?.projectId;
    assert.equal(boot.milestones.find((x) => x.id === m.id)?.projectId, b.id);
    assert.equal(project(root.id), b.id);
    assert.equal(project(kid.id), b.id, 'auch die Unteraufgabe wandert mit');
    assert.equal(project(other.id), a.id, 'was nicht am Milestone hängt, bleibt');
  });
});

/* ------------------------------------------------------------------ Hilfen */

const row = (id: string) =>
  ctx.sqlite.prepare('SELECT * FROM task WHERE id = ?').get(id) as {
    hidden_by: string | null;
    archived_at: string | null;
    parent_id: string | null;
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

describe('Markierungen je Projekt', () => {
  const marksIn = (projectId: string) =>
    loadBootstrap(ctx)
      .marks.filter((k) => k.projectId === projectId)
      .map((k) => `${k.emoji} ${k.name}`);

  it('ein neues Projekt fängt mit Bug und Refactoring an', () => {
    const p = mkProject();
    assert.deepEqual(marksIn(p.id), ['🐞 Bug', '🛠️ Refactoring']);
  });

  it('eine Markierung gilt nur im eigenen Projekt', () => {
    const a = mkProject();
    const b = mkProject();
    create(ctx, 'mark', { projectId: a.id, emoji: '🎨', name: 'Art' });
    assert.deepEqual(marksIn(a.id), ['🐞 Bug', '🛠️ Refactoring', '🎨 Art']);
    assert.deepEqual(marksIn(b.id), ['🐞 Bug', '🛠️ Refactoring']);
  });

  it('wandert ein Task ins andere Projekt, nimmt er dort die gleichnamige Markierung oder legt sie an', () => {
    const a = mkProject();
    const b = mkProject();
    const byName = (projectId: string, name: string) =>
      loadBootstrap(ctx).marks.find((k) => k.projectId === projectId && k.name === name)!.id;
    const art = create(ctx, 'mark', { projectId: a.id, emoji: '🎨', name: 'Art' }) as { id: string };
    const bug = mkTask({ projectId: a.id, title: 'Bug', markId: byName(a.id, 'Bug') });
    const kid = mkTask({ projectId: a.id, parentId: bug.id, title: 'Kind', markId: art.id });

    move(ctx, bug.id, bug.version, { projectId: b.id });

    assert.equal(one(bug.id).markId, byName(b.id, 'Bug'));
    assert.equal(one(kid.id).markId, byName(b.id, 'Art'));
    assert.deepEqual(marksIn(b.id), ['🐞 Bug', '🛠️ Refactoring', '🎨 Art']);
  });

  it('ein gelöschtes Projekt kommt mit seinen Markierungen zurück', () => {
    const p = mkProject();
    const k = create(ctx, 'mark', { projectId: p.id, emoji: '🎨', name: 'Art' }) as { id: string };
    const t = mkTask({ projectId: p.id, title: 'A', markId: k.id });
    const { trashId } = remove(ctx, 'project', p.id);
    assert.deepEqual(marksIn(p.id), []);

    restoreTrash(ctx, trashId);
    assert.deepEqual(marksIn(p.id), ['🐞 Bug', '🛠️ Refactoring', '🎨 Art']);
    assert.equal(one(t.id).markId, k.id);
  });
});

describe('Status der Eltern-Aufgabe', () => {
  const statusOf = (id: string) => loadBootstrap(ctx).tasks.find((t) => t.id === id)?.status;
  const set = (id: string, status: string) => {
    const t = loadBootstrap(ctx).tasks.find((x) => x.id === id) as Task;
    patch(ctx, 'task', id, t.version, { status });
  };

  it('zieht über mehrere Ebenen mit, aber erledigt nie von selbst', () => {
    const p = mkProject();
    const top = mkTask({ projectId: p.id, title: 'Oben' });
    const mid = mkTask({ projectId: p.id, title: 'Mitte', parentId: top.id });
    const leaf = mkTask({ projectId: p.id, title: 'Blatt', parentId: mid.id });

    set(leaf.id, 'progress');
    assert.equal(statusOf(mid.id), 'progress');
    assert.equal(statusOf(top.id), 'progress');

    set(leaf.id, 'done');
    assert.equal(statusOf(mid.id), 'progress');

    set(mid.id, 'done');
    set(leaf.id, 'progress');
    assert.equal(statusOf(mid.id), 'progress');

    set(leaf.id, 'open');
    assert.equal(statusOf(mid.id), 'open');
    assert.equal(statusOf(top.id), 'open');
  });

  it('Mehrfachauswahl mit Eltern- und Unteraufgabe scheitert nicht an Versionen', () => {
    const p = mkProject();
    const a = mkTask({ projectId: p.id, title: 'A' });
    const k = mkTask({ projectId: p.id, title: 'K', parentId: a.id });
    const at = (t: Task) => ({ id: t.id, version: t.version });
    bulk(ctx, [at(k), at(a)], { type: 'patch', changes: { status: 'done' } });
    assert.equal(statusOf(a.id), 'done');
  });
});
