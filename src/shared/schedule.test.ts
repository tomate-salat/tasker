import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dateFromWeeks, isoWeek, schedule, sharedFinish, weeksFromToday } from './schedule.js';
import { Builder } from './testing.js';

// Fester Bezugstag, damit die Tests nicht vom Kalender abhängen.
const TODAY = new Date('2026-09-19T09:00:00');
const day = (n: number): string => {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

describe('weeksFromToday', () => {
  it('rechnet Tage in Wochen um', () => {
    assert.equal(weeksFromToday(day(7), TODAY), 1);
    assert.equal(weeksFromToday(day(0), TODAY), 0);
    assert.equal(weeksFromToday(day(-14), TODAY), -2);
  });

  it('lässt sich mit dateFromWeeks wieder umkehren', () => {
    for (const w of [-2, 0, 1, 3.5]) {
      assert.equal(weeksFromToday(iso(dateFromWeeks(w, TODAY)), TODAY), Math.round(w * 7) / 7);
    }
  });
});

describe('isoWeek', () => {
  it('zählt die Kalenderwochen nach ISO 8601', () => {
    // Der 1.1.2027 ist ein Freitag und gehört noch zur 53. Woche von 2026.
    assert.equal(isoWeek(new Date('2027-01-01T12:00:00')), 53);
    // Der 4.1.2027 ist der Montag der ersten Woche.
    assert.equal(isoWeek(new Date('2027-01-04T12:00:00')), 1);
    assert.equal(isoWeek(new Date('2026-09-19T12:00:00')), 38);
  });
});

const iso = (d: Date): string => d.toISOString().slice(0, 10);

describe('Zeitplan', () => {
  it('rechnet offene Aufgaben durch das Tempo', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .task('t2', 'p1', { milestoneId: 'm1' })
      .task('t3', 'p1', { milestoneId: 'm1' })
      .task('t4', 'p1', { milestoneId: 'm1' })
      .build();

    const s = schedule(ws, { velocity: 2, today: TODAY });
    assert.equal(s.list[0]!.open, 4);
    assert.equal(s.list[0]!.end, 2); // 4 Aufgaben bei 2 pro Woche
  });

  it('höheres Tempo zieht das Ende nach vorn', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .task('t2', 'p1', { milestoneId: 'm1' })
      .build();

    const langsam = schedule(ws, { velocity: 1, today: TODAY }).list[0]!.end;
    const schnell = schedule(ws, { velocity: 4, today: TODAY }).list[0]!.end;
    assert.ok(schnell < langsam, `${schnell} < ${langsam}`);
  });

  it('reiht Milestones nacheinander auf', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, qorder: 0 })
      .milestone('m2', 'p1', { planned: true, qorder: 1 })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .task('t2', 'p1', { milestoneId: 'm2' })
      .build();

    const s = schedule(ws, { velocity: 1, today: TODAY });
    assert.equal(s.byId.get('m1')!.end, 1);
    assert.equal(s.byId.get('m2')!.start, 1);
    assert.equal(s.byId.get('m2')!.end, 2);
  });

  it('Projekte verschieben sich nicht gegenseitig – außer über eine Abhängigkeit', () => {
    const build = (deps: string[]) =>
      new Builder()
        .project('p1')
        .project('p2')
        .milestone('m1', 'p1', { planned: true, qorder: 0 })
        .milestone('m2', 'p2', { planned: true, qorder: 1 })
        .milestone('m3', 'p1', { planned: true, qorder: 2, deps })
        .task('t1', 'p1', { milestoneId: 'm1' })
        .task('t2', 'p2', { milestoneId: 'm2' })
        .task('t3', 'p2', { milestoneId: 'm2' })
        .task('t4', 'p1', { milestoneId: 'm3' })
        .build();

    const s = schedule(build([]), { velocity: 1, today: TODAY });
    assert.equal(s.byId.get('m2')!.start, 0);
    assert.equal(s.byId.get('m3')!.start, 1);

    const d = schedule(build(['m2']), { velocity: 1, today: TODAY });
    assert.equal(d.byId.get('m3')!.start, 2);
  });

  it('nicht eingeplante und archivierte Milestones bleiben draußen', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true })
      .milestone('m2', 'p1', { planned: false })
      .milestone('m3', 'p1', { planned: true, archivedAt: '2026-01-01T00:00:00Z' })
      .build();

    assert.deepEqual(
      schedule(ws, { velocity: 1, today: TODAY }).list.map((x) => x.milestone.id),
      ['m1'],
    );
  });

  it('eine Abhängigkeit verschiebt den Start nach hinten', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, qorder: 1, deps: ['m2'] })
      .milestone('m2', 'p1', { planned: true, qorder: 0 })
      .task('t1', 'p1', { milestoneId: 'm2' })
      .task('t2', 'p1', { milestoneId: 'm2' })
      .task('t3', 'p1', { milestoneId: 'm1' })
      .build();

    const s = schedule(ws, { velocity: 1, today: TODAY });
    assert.equal(s.byId.get('m2')!.end, 2);
    assert.equal(s.byId.get('m1')!.start, 2);
  });

  it('eine Aufgabe, die auf einen anderen Milestone wartet, verschiebt ihren eigenen', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('früh', 'p1', { planned: true, qorder: 0 })
      .milestone('spät', 'p1', { planned: true, qorder: 1 })
      .task('vorarbeit', 'p1', { milestoneId: 'früh' })
      .task('wurzel', 'p1', { milestoneId: 'spät' })
      .task('kind', 'p1', { parentId: 'wurzel', deps: ['vorarbeit'] })
      .build();

    const s = schedule(ws, { velocity: 1, today: TODAY });
    assert.deepEqual(s.byId.get('spät')!.deps, ['früh']);
  });

  it('wartet eine Aufgabe direkt auf einen Milestone, wartet ihr eigener mit', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('früh', 'p1', { planned: true, qorder: 0 })
      .milestone('spät', 'p1', { planned: true, qorder: 1 })
      .task('vorarbeit', 'p1', { milestoneId: 'früh' })
      .task('wurzel', 'p1', { milestoneId: 'spät', deps: ['früh'] })
      .build();

    const s = schedule(ws, { velocity: 1, today: TODAY });
    assert.deepEqual(s.byId.get('spät')!.deps, ['früh']);
  });

  it('ein Startdatum in der Vergangenheit rechnet die Restarbeit ab heute', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, startDate: day(-28) })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .task('t2', 'p1', { milestoneId: 'm1' })
      .build();

    const x = schedule(ws, { velocity: 1, today: TODAY }).list[0]!;
    assert.equal(x.start, -4);
    assert.equal(x.forecastEnd, 2); // nicht -2
  });

  it('ein Enddatum, das die Prognose nicht hält, gilt als verspätet', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, startDate: day(0), endDate: day(7) })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .task('t2', 'p1', { milestoneId: 'm1' })
      .task('t3', 'p1', { milestoneId: 'm1' })
      .build();

    const x = schedule(ws, { velocity: 1, today: TODAY }).list[0]!;
    assert.equal(x.end, 1);
    assert.equal(x.forecastEnd, 3);
    assert.equal(x.late, true);
  });

  it('ein erledigter Milestone ist nicht verspätet', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, status: 'done', startDate: day(0), endDate: day(7) })
      .task('t1', 'p1', { milestoneId: 'm1' })
      .task('t2', 'p1', { milestoneId: 'm1' })
      .task('t3', 'p1', { milestoneId: 'm1' })
      .build();

    const x = schedule(ws, { velocity: 1, today: TODAY }).list[0]!;
    assert.equal(x.open, 0);
    assert.equal(x.late, false);
  });

  it('ein Start vor der Abhängigkeit wird als zu früh markiert', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('vorher', 'p1', { planned: true, qorder: 0 })
      .milestone('m1', 'p1', { planned: true, qorder: 1, deps: ['vorher'], startDate: day(0) })
      .task('t1', 'p1', { milestoneId: 'vorher' })
      .task('t2', 'p1', { milestoneId: 'vorher' })
      .task('t3', 'p1', { milestoneId: 'm1' })
      .build();

    const x = schedule(ws, { velocity: 1, today: TODAY }).byId.get('m1')!;
    assert.equal(x.early, true);
  });

  it('bleibt bei einem Kreis zwischen Milestones stehen und plant alle ein', () => {
    const ws = new Builder()
      .project('p1')
      .milestone('m1', 'p1', { planned: true, qorder: 0, deps: ['m2'] })
      .milestone('m2', 'p1', { planned: true, qorder: 1, deps: ['m1'] })
      .build();

    const s = schedule(ws, { velocity: 1, today: TODAY });
    assert.equal(s.list.length, 2);
  });
});

describe('Geteiltes Tempo', () => {
  const close = (a: number[], b: number[]): void =>
    assert.deepEqual(a.map((x) => Math.round(x * 1000) / 1000), b);

  it('teilt gleichmäßig – wird einer fertig, geht sein Anteil an die übrigen', () => {
    close(sharedFinish([4, 12], 8), [1, 2]);
    close(sharedFinish([12, 20], 8), [3, 4]);
    close(sharedFinish([20, 12], 8), [4, 3]);
    close(sharedFinish([6, 6, 12], 8), [2.25, 2.25, 3]);
    close(sharedFinish([10], 4), [2.5]);
    close(sharedFinish([], 4), []);
  });

  const two = () =>
    new Builder()
      .project('p1')
      .project('p2')
      .milestone('stream', 'p1', { planned: true, qorder: 0, status: 'progress', startDate: day(-7) })
      .milestone('sonst', 'p1', { planned: true, qorder: 1, status: 'progress', startDate: day(0) })
      .milestone('danach', 'p1', { planned: true, qorder: 2 })
      .milestone('fremd', 'p2', { planned: true, qorder: 0, status: 'progress', startDate: day(0) });

  it('zwei aktive Milestones eines Projekts teilen sich das Tempo, der nächste beginnt danach', () => {
    const b = two();
    for (let i = 0; i < 12; i++) b.task(`s${i}`, 'p1', { milestoneId: 'stream' });
    for (let i = 0; i < 20; i++) b.task(`o${i}`, 'p1', { milestoneId: 'sonst' });
    for (let i = 0; i < 8; i++) b.task(`d${i}`, 'p1', { milestoneId: 'danach' });
    for (let i = 0; i < 8; i++) b.task(`f${i}`, 'p2', { milestoneId: 'fremd' });
    const s = schedule(b.build(), { velocity: 8, today: TODAY }).byId;

    assert.equal(s.get('stream')!.forecastEnd, 3);
    assert.equal(s.get('sonst')!.forecastEnd, 4);
    assert.equal(s.get('stream')!.sharing, 2);
    // Erst wenn beide durch sind, ist wieder Tempo frei.
    assert.equal(s.get('danach')!.start, 4);
    assert.equal(s.get('danach')!.forecastEnd, 5);
    assert.equal(s.get('danach')!.sharing, 0);
    // Das andere Projekt rechnet für sich, mit vollem Tempo.
    assert.equal(s.get('fremd')!.forecastEnd, 1);
    assert.equal(s.get('fremd')!.sharing, 1);
  });

  it('was vor einem aktiven Milestone im Plan steht, aber nicht läuft, wartet auf ihn', () => {
    const b = new Builder()
      .project('p1')
      .milestone('wartet', 'p1', { planned: true, qorder: 0 })
      .milestone('läuft', 'p1', { planned: true, qorder: 1, status: 'progress', startDate: day(0) });
    for (let i = 0; i < 4; i++) b.task(`w${i}`, 'p1', { milestoneId: 'wartet' });
    for (let i = 0; i < 8; i++) b.task(`l${i}`, 'p1', { milestoneId: 'läuft' });
    const s = schedule(b.build(), { velocity: 4, today: TODAY }).byId;
    assert.equal(s.get('läuft')!.forecastEnd, 2);
    assert.equal(s.get('wartet')!.start, 2);
    assert.equal(s.get('wartet')!.forecastEnd, 3);
  });

  it('ein erledigter oder leerer aktiver Milestone nimmt kein Tempo weg', () => {
    const b = new Builder()
      .project('p1')
      .milestone('leer', 'p1', { planned: true, qorder: 0, status: 'progress', startDate: day(0) })
      .milestone('läuft', 'p1', { planned: true, qorder: 1, status: 'progress', startDate: day(0) });
    for (let i = 0; i < 8; i++) b.task(`l${i}`, 'p1', { milestoneId: 'läuft' });
    const s = schedule(b.build(), { velocity: 4, today: TODAY }).byId;
    assert.equal(s.get('läuft')!.forecastEnd, 2);
    assert.equal(s.get('läuft')!.sharing, 1);
  });
});
