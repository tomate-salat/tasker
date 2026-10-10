import {
  type Category,
  type Data,
  type Group,
  type Mark,
  type Milestone,
  type Project,
  type Release,
  type ReleaseHeading,
  type ReleaseStage,
  type Task,
  isArchived,
  isDone,
} from './model.js';

/**
 * Ein Index über die Daten. Der Prototyp hat für jede Frage die Task-Liste
 * durchsucht; das ist bei 20 Aufgaben egal und bei 5000 nicht mehr. Hier wird
 * einmal indexiert und danach nur noch nachgeschlagen.
 *
 * Der Index ist eine Momentaufnahme: nach einer Änderung an den Daten wird er
 * neu gebaut, nicht fortgeschrieben.
 */
export class Workspace {
  readonly projects: Project[];
  readonly categories: Category[];
  readonly marks: Mark[];
  readonly groups: Group[];
  readonly milestones: Milestone[];
  readonly releases: Release[];
  readonly stages: ReleaseStage[];
  readonly headings: ReleaseHeading[];
  readonly tasks: Task[];

  private readonly taskById = new Map<string, Task>();
  private readonly milestoneById = new Map<string, Milestone>();
  private readonly groupById = new Map<string, Group>();
  private readonly projectById = new Map<string, Project>();
  private readonly categoryById = new Map<string, Category>();
  private readonly markById = new Map<string, Mark>();
  private readonly releaseById = new Map<string, Release>();
  /** Kanäle je Release, nach order sortiert. */
  private readonly stagesOfRelease = new Map<string, ReleaseStage[]>();
  /** Aktive Milestones je Release, in der Reihenfolge der Planung. */
  private readonly milestonesOfRelease = new Map<string, Milestone[]>();
  /** Nur aktive Kinder, nach order sortiert. */
  private readonly kidsOf = new Map<string, Task[]>();
  /** Auch archivierte Kinder. */
  private readonly allKidsOf = new Map<string, Task[]>();
  /** Wurzelaufgaben je Milestone, nach order sortiert. */
  private readonly rootsOfMilestone = new Map<string, Task[]>();
  /** Auch archivierte Wurzelaufgaben. */
  private readonly allRootsOfMilestone = new Map<string, Task[]>();
  /** Wer hängt von diesem Task oder Milestone ab. */
  private readonly blocksOf = new Map<string, Task[]>();

  constructor(data: Data) {
    this.projects = data.projects;
    this.categories = data.categories;
    this.marks = data.marks;
    this.groups = data.groups;
    this.milestones = data.milestones;
    this.releases = data.releases;
    this.stages = data.stages;
    this.headings = data.headings;
    this.tasks = data.tasks;

    for (const p of data.projects) this.projectById.set(p.id, p);
    for (const c of data.categories) this.categoryById.set(c.id, c);
    for (const k of data.marks) this.markById.set(k.id, k);
    for (const g of data.groups) this.groupById.set(g.id, g);
    for (const m of data.milestones) this.milestoneById.set(m.id, m);
    for (const r of data.releases) this.releaseById.set(r.id, r);
    for (const s of data.stages) push(this.stagesOfRelease, s.releaseId, s);
    for (const m of data.milestones) {
      if (m.releaseId && !isArchived(m)) push(this.milestonesOfRelease, m.releaseId, m);
    }
    for (const list of this.stagesOfRelease.values()) list.sort(byOrder);
    for (const list of this.milestonesOfRelease.values()) list.sort((a, b) => a.qorder - b.qorder);
    for (const t of data.tasks) this.taskById.set(t.id, t);

    for (const t of data.tasks) {
      if (t.parentId) {
        push(this.allKidsOf, t.parentId, t);
        if (!isArchived(t)) push(this.kidsOf, t.parentId, t);
      } else if (t.milestoneId) {
        push(this.allRootsOfMilestone, t.milestoneId, t);
        if (!isArchived(t)) push(this.rootsOfMilestone, t.milestoneId, t);
      }
      for (const d of t.deps) push(this.blocksOf, d, t);
    }

    // Archiviertes an aktivem Ort steht nur unter seinem Ort, nicht in `tasks`.
    for (const t of data.archivedTasks ?? []) {
      if (this.taskById.has(t.id)) continue;
      if (t.parentId) push(this.allKidsOf, t.parentId, t);
      else if (t.milestoneId) push(this.allRootsOfMilestone, t.milestoneId, t);
    }

    for (const list of this.kidsOf.values()) list.sort(byOrder);
    for (const list of this.allKidsOf.values()) list.sort(byOrder);
    for (const list of this.rootsOfMilestone.values()) list.sort(byOrder);
    for (const list of this.allRootsOfMilestone.values()) list.sort(byOrder);
  }

  task = (id: string | null): Task | null => (id ? (this.taskById.get(id) ?? null) : null);
  milestone = (id: string | null): Milestone | null =>
    id ? (this.milestoneById.get(id) ?? null) : null;
  group = (id: string | null): Group | null => (id ? (this.groupById.get(id) ?? null) : null);
  project = (id: string | null): Project | null => (id ? (this.projectById.get(id) ?? null) : null);
  category = (id: string | null): Category | null =>
    id ? (this.categoryById.get(id) ?? null) : null;
  mark = (id: string | null): Mark | null => (id ? (this.markById.get(id) ?? null) : null);
  release = (id: string | null): Release | null => (id ? (this.releaseById.get(id) ?? null) : null);

  /** Die Kanäle eines Releases in Reihenfolge. */
  releaseStages = (id: string): ReleaseStage[] => this.stagesOfRelease.get(id) ?? [];

  /** Die aktiven Milestones eines Releases, in der Reihenfolge der Planung. */
  releaseMilestones = (id: string): Milestone[] => this.milestonesOfRelease.get(id) ?? [];

  /** Aktive Unteraufgaben in Reihenfolge. */
  kids = (id: string): Task[] => this.kidsOf.get(id) ?? [];

  /** Unteraufgaben einschließlich archivierter. */
  allKids = (id: string): Task[] => this.allKidsOf.get(id) ?? [];

  /** Aktive Wurzelaufgaben eines Milestones. */
  msRoots = (m: Milestone): Task[] => this.rootsOfMilestone.get(m.id) ?? [];

  /** Wurzelaufgaben eines Milestones einschließlich archivierter. */
  msAllRoots = (m: Milestone): Task[] => this.allRootsOfMilestone.get(m.id) ?? [];

  /**
   * Was zählt und im Inspektor unter seinem Ort steht: aktive Unteraufgaben
   * und erledigt Archiviertes – Archivieren räumt nur auf, es nimmt nichts
   * weg. Offen Archiviertes gilt als verworfen und fällt heraus.
   */
  countedKids = (id: string): Task[] => this.allKids(id).filter(this.counted);

  /** Wie `countedKids`, für die Wurzelaufgaben eines Milestones. */
  msCounted = (m: Milestone): Task[] => this.msAllRoots(m).filter(this.counted);

  private readonly finishedOf = new Map<string, boolean>();
  private readonly counted = (t: Task): boolean => !isArchived(t) || this.finished(t);
  /** Erledigt oder nur noch aus erledigten (gezählten) Unteraufgaben bestehend. */
  private readonly finished = (t: Task): boolean => {
    let v = this.finishedOf.get(t.id);
    if (v === undefined) {
      const ks = isDone(t) ? [] : this.countedKids(t.id);
      v = isDone(t) || (ks.length > 0 && ks.every(this.finished));
      this.finishedOf.set(t.id, v);
    }
    return v;
  };

  /** Tasks, die von diesem Task oder Milestone abhängen. */
  blocks = (x: { id: string }): Task[] => this.blocksOf.get(x.id) ?? [];

  /** Von der Wurzel abwärts bis zum direkten Elternteil. */
  ancestors = (t: Task): Task[] => {
    const out: Task[] = [];
    const seen = new Set<string>([t.id]);
    let p = this.task(t.parentId);
    while (p && !seen.has(p.id)) {
      out.unshift(p);
      seen.add(p.id);
      p = this.task(p.parentId);
    }
    return out;
  };

  root = (t: Task): Task => this.ancestors(t)[0] ?? t;

  /** Alle Nachfahren in Baumreihenfolge, ohne archivierte. */
  desc = (t: Task): Task[] => {
    const out: Task[] = [];
    const walk = (x: Task): void => {
      for (const k of this.kids(x.id)) {
        out.push(k);
        walk(k);
      }
    };
    walk(t);
    return out;
  };

  /**
   * Sichtbar in den Arbeitsansichten: weder selbst noch über einen Elternteil
   * archiviert, und der Milestone der Wurzel ist nicht archiviert.
   */
  isActive = (t: Task): boolean => {
    if (isArchived(t)) return false;
    if (this.ancestors(t).some(isArchived)) return false;
    const root = this.root(t);
    const ms = this.milestone(root.milestoneId);
    return !(ms && isArchived(ms));
  };

  /** Der Milestone, unter dem dieser Task hängt – über die Wurzel bestimmt. */
  milestoneOf = (t: Task): Milestone | null => this.milestone(this.root(t).milestoneId);

  /** Dokumente erkennt man an der Wurzel, Unterseiten erben es. */
  isDoc = (t: Task): boolean => this.root(t).doc;

  /** Eingeplante Milestones in Planungsreihenfolge. */
  plannedMilestones = (): Milestone[] =>
    this.milestones.filter((m) => m.planned && !isArchived(m)).sort((a, b) => a.qorder - b.qorder);
}

const byOrder = (a: { order: number }, b: { order: number }): number => a.order - b.order;

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
