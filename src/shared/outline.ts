import { effectiveCategory, effectiveTags } from './inherit.js';
import { allDone } from './progress.js';
import { isArchived, type Category, type Group, type Mark, type Milestone, type Project, type Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Die sichtbare Zeilenfolge einer Ansicht – einmal berechnet, von der Anzeige
 * und von der Tastatursteuerung gemeinsam benutzt. Würden beide die Reihenfolge
 * getrennt bestimmen, liefen Pfeiltasten und Bildschirm irgendwann auseinander.
 *
 * Der Bereich kann ein Projekt sein oder alle; bei mehreren bekommt jedes eine
 * Überschrift, wie im Prototyp.
 *
 * Der Backlog zeigt die vorbereiteten Milestones und „Ideen & Tasks“
 * (Unsortiert plus die eigenen Gruppen). Abweichung vom Prototyp, auf Wunsch:
 * die smarten Gruppen stehen nicht mehr im Backlog, sondern im Reiter
 * „Ready“ – dort nach den vorbereiteten Milestones erst eine je Kategorie
 * (plus „Ohne Kategorie“), dann eine je Markierung. In „Ready“ steht, was als
 * lose Wurzel `ready` ist; die Markierung gewinnt vor der Kategorie.
 */

/** Wo eine Aufgabe hängt – dieselben Felder, die Anlegen und Verschieben erwarten. */
export type Placement = {
  milestoneId?: string | null;
  groupId?: string | null;
  /** Nur bei losen Wurzeln: Backlog („Unsortiert“) oder „Ready“. */
  ready?: boolean;
  /** Nur in „Ready“: die Markierung entscheidet über die smarte Gruppe … */
  markId?: string | null;
  /** … und ohne Markierung die Kategorie; `null` heißt „Ohne Kategorie“. */
  categoryId?: string | null;
};

/** Was die Überschrift eines Abschnitts rechts anbietet. */
export type SectionAction = 'add-draft-milestone' | 'add-group' | 'manage-marks' | 'manage-categories';

export type OutlineRow =
  | { type: 'project'; id: string; project: Project }
  | { type: 'section'; id: string; title: string; action: SectionAction; projectId: string }
  /** Hinweistext ohne eigene Funktion, etwa wenn es noch keine Entwürfe gibt. */
  | { type: 'hint'; id: string; text: string }
  | { type: 'milestone'; id: string; milestone: Milestone }
  | {
      type: 'group';
      id: string;
      title: string;
      /** Null beim Sammelbereich „Unsortiert“ und bei smarten Gruppen. */
      group: Group | null;
      /** Smarte Gruppe in „Ready“: je Markierung oder je Kategorie. */
      smart: 'mark' | 'category' | null;
      /** Gesetzt bei einer smarten Gruppe – sie gehört zu genau dieser Markierung. */
      mark: Mark | null;
      /** Gesetzt bei einer Kategorie-Gruppe; null bei „Ohne Kategorie“. */
      category: Category | null;
      projectId: string;
      place: Placement;
      /** Die Wurzelaufgaben der Gruppe – für Zähler und „+“. */
      tasks: Task[];
    }
  /** Leerer Behälter: gestrichelter Platzhalter zum Hineinziehen. */
  | { type: 'empty'; id: string; projectId: string; place: Placement }
  | { type: 'task'; id: string; task: Task; depth: number };

export type OutlineView = 'plan' | 'ready' | 'backlog' | 'docs';

/** Filter aus der Seitenleiste. Ein gesetzter Wert schränkt ein, `null` nicht. */
export type OutlineFilter = {
  tag?: string | null;
  categoryId?: string | null;
  markId?: string | null;
};

export function outline(
  ws: Workspace,
  o: {
    view: OutlineView;
    projectIds: string[];
    collapsed: Record<string, boolean>;
    filter?: OutlineFilter;
  },
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const filtering = isFiltering(o.filter);
  const show = visibility(ws, o.filter);
  // Wird gefiltert, sind zugeklappte Äste offen – sonst versteckt man das Gesuchte.
  const open = (id: string): boolean => filtering || !o.collapsed[id];
  const many = o.projectIds.length > 1;

  const walk = (task: Task, depth: number): void => {
    if (!show(task)) return;
    rows.push({ type: 'task', id: task.id, task, depth });
    if (!open(task.id)) return;
    for (const k of ws.kids(task.id)) walk(k, depth + 1);
  };

  /**
   * Der Inhalt eines Behälters. Ist er leer, steht dort der Platzhalter zum
   * Hineinziehen – aber nur, solange nicht gefiltert wird: gefiltert wäre „leer“
   * bloß eine Folge des Filters.
   */
  const contents = (tasks: Task[], key: string, projectId: string, place: Placement, collapsed: boolean): void => {
    if (collapsed) return;
    const visible = tasks.filter(show);
    if (!visible.length) {
      if (!filtering) rows.push({ type: 'empty', id: `empty:${key}`, projectId, place });
      return;
    }
    // Wie im Prototyp stehen Aufgaben im Behälter eine Stufe tiefer als dessen Zeile.
    for (const t of visible) walk(t, 1);
  };

  const milestoneBlock = (m: Milestone): void => {
    const roots = ws.msRoots(m);
    if (filtering && !roots.some(show)) return;
    rows.push({ type: 'milestone', id: m.id, milestone: m });
    contents(roots, m.id, m.projectId, { milestoneId: m.id }, !open(m.id));
  };

  for (const projectId of o.projectIds) {
    const project = ws.project(projectId);
    if (!project) continue;
    const before = rows.length;

    if (o.view === 'plan') {
      for (const m of plannedMilestones(ws, projectId)) milestoneBlock(m);
    } else if (o.view === 'docs') {
      for (const t of docRoots(ws, projectId)) walk(t, 0);
    } else if (o.view === 'ready') {
      drafts(projectId);
      ready(projectId);
    } else {
      drafts(projectId);
      backlog(projectId);
    }

    // Die Projektüberschrift kommt nur, wenn darunter auch etwas steht.
    if (many && rows.length > before) {
      rows.splice(before, 0, { type: 'project', id: projectId, project });
    }
  }

  return rows;

  /** Vorbereitete Milestones – dieselben in Backlog und „Ready“. */
  function drafts(projectId: string): void {
    rows.push({
      type: 'section',
      id: `sec:drafts:${projectId}`,
      title: 'Vorbereitete Milestones',
      action: 'add-draft-milestone',
      projectId,
    });
    const list = draftMilestones(ws, projectId);
    if (!list.length && !filtering) {
      rows.push({
        type: 'hint',
        id: `hint:drafts:${projectId}`,
        text: 'Noch keine. Hier bereitest du Milestones vor, bevor sie in den Plan kommen.',
      });
    }
    for (const m of list) milestoneBlock(m);
  }

  /** Eine Gruppe, die nicht selbst gespeichert ist: Unsortiert oder eine smarte. */
  function box(
    id: string,
    title: string,
    projectId: string,
    place: Placement,
    tasks: Task[],
    extra: { smart?: 'mark' | 'category'; mark?: Mark; category?: Category | null } = {},
  ): void {
    if (filtering && !tasks.some(show)) return;
    rows.push({
      type: 'group',
      id,
      title,
      group: null,
      smart: extra.smart ?? null,
      mark: extra.mark ?? null,
      category: extra.category ?? null,
      projectId,
      place,
      tasks,
    });
    contents(tasks, id, projectId, place, !open(id));
  }

  function ready(projectId: string): void {
    rows.push({
      type: 'section',
      id: `sec:smart-cat:${projectId}`,
      title: 'Smarte Gruppen (Kategorien)',
      action: 'manage-categories',
      projectId,
    });
    for (const c of categoriesOf(ws, projectId)) {
      const place = { ready: true, markId: null, categoryId: c.id };
      box(categoryGroupId(projectId, c.id), c.name, projectId, place, categoryTasks(ws, projectId, c.id), {
        smart: 'category',
        category: c,
      });
    }
    const none = { ready: true, markId: null, categoryId: null };
    box(categoryGroupId(projectId, null), 'Ohne Kategorie', projectId, none, categoryTasks(ws, projectId, null), {
      smart: 'category',
      category: null,
    });

    if (!ws.marks.length) return;
    rows.push({
      type: 'section',
      id: `sec:smart:${projectId}`,
      title: 'Smarte Gruppen (Markierungen)',
      action: 'manage-marks',
      projectId,
    });
    for (const k of ws.marks) {
      const place = { ready: true, markId: k.id };
      box(smartId(projectId, k.id), k.name, projectId, place, smartTasks(ws, projectId, k.id), {
        smart: 'mark',
        mark: k,
      });
    }
  }

  function backlog(projectId: string): void {
    rows.push({
      type: 'section',
      id: `sec:ideas:${projectId}`,
      title: 'Ideen & Tasks',
      action: 'add-group',
      projectId,
    });

    box(unsortedId(projectId), 'Unsortiert', projectId, { ready: false }, unsortedTasks(ws, projectId));

    for (const g of groupsOf(ws, projectId)) {
      const tasks = groupTasks(ws, g.id);
      if (filtering && !tasks.some(show)) continue;
      rows.push({
        type: 'group',
        id: g.id,
        title: g.title || 'Neue Gruppe',
        group: g,
        smart: null,
        mark: null,
        category: null,
        projectId,
        place: { groupId: g.id },
        tasks,
      });
      contents(tasks, g.id, projectId, { groupId: g.id }, !open(g.id));
    }
  }
}

const isFiltering = (f: OutlineFilter | undefined): boolean =>
  !!(f && (f.tag || f.categoryId || f.markId));

/**
 * Ein Task ist sichtbar, wenn er selbst passt oder eine seiner Unteraufgaben –
 * sonst verschwände der Ast, in dem der Treffer hängt.
 */
export function visibility(ws: Workspace, f: OutlineFilter | undefined): (t: Task) => boolean {
  if (!isFiltering(f)) return () => true;

  const matches = (t: Task): boolean => {
    if (f?.tag && !effectiveTags(ws, t).tags.includes(f.tag)) return false;
    if (f?.categoryId && effectiveCategory(ws, t)?.category.id !== f.categoryId) return false;
    if (f?.markId && t.markId !== f.markId) return false;
    return true;
  };

  const show = (t: Task): boolean => matches(t) || ws.kids(t.id).some(show);
  return show;
}

/** Der Sammelbereich im Backlog ist keine echte Gruppe, hat aber eine ID für den Klappzustand. */
export const unsortedId = (projectId: string): string => `unsorted:${projectId}`;

/** Auch smarte Gruppen brauchen eine ID, unter der ihr Klappzustand steht. */
export const smartId = (projectId: string, markId: string): string => `smart:${markId}:${projectId}`;

/** Dasselbe für die Kategorie-Gruppen in „Ready“; `null` ist „Ohne Kategorie“. */
export const categoryGroupId = (projectId: string, categoryId: string | null): string =>
  `smart-cat:${categoryId ?? '-'}:${projectId}`;

/** Die Klapp-ID der Gruppe, in der eine lose Wurzel steht. */
export const looseBoxId = (t: Task, ws: Workspace): string =>
  !t.ready
    ? unsortedId(t.projectId)
    : t.markId
      ? smartId(t.projectId, t.markId)
      : categoryGroupId(t.projectId, readyCategory(ws, t));

/** Die Kategorien eines Projekts, alphabetisch (Wunsch des Nutzers). */
export const categoriesOf = (ws: Workspace, projectId: string): Category[] =>
  ws.categories
    .filter((c) => c.projectId === projectId)
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }) || a.order - b.order);

/**
 * Die Stelle in der Anlage-Reihenfolge – daran hängt die Farbe. Die Anzeige
 * ist alphabetisch, die Farbe soll sich aber nicht verschieben, sobald eine
 * neue Kategorie dazwischen einsortiert wird.
 */
export const categoryColorIndex = (ws: Workspace, c: Category): number =>
  ws.categories
    .filter((x) => x.projectId === c.projectId)
    .sort((a, b) => a.order - b.order)
    .findIndex((x) => x.id === c.id);

export const plannedMilestones = (ws: Workspace, projectId: string): Milestone[] =>
  ws.milestones
    .filter((m) => m.projectId === projectId && m.planned && !isArchived(m))
    .sort((a, b) => a.qorder - b.qorder);

/** Vorbereitete Milestones: angelegt, aber noch nicht im Plan. */
export const draftMilestones = (ws: Workspace, projectId: string): Milestone[] =>
  ws.milestones
    .filter((m) => m.projectId === projectId && !m.planned && !isArchived(m))
    .sort((a, b) => a.order - b.order);

export const groupsOf = (ws: Workspace, projectId: string): Group[] =>
  ws.groups.filter((g) => g.projectId === projectId).sort((a, b) => a.order - b.order);

export const groupTasks = (ws: Workspace, groupId: string): Task[] =>
  ws.tasks.filter((t) => t.groupId === groupId && !t.parentId).sort((a, b) => a.order - b.order);

export const docRoots = (ws: Workspace, projectId: string): Task[] =>
  ws.tasks
    .filter((t) => t.projectId === projectId && t.doc && !t.parentId)
    .sort((a, b) => a.order - b.order);

/** Die Aufgaben auf derselben Ebene, in Reihenfolge – Grundlage von Einrücken und Umsortieren. */
export function siblings(ws: Workspace, t: Task): Task[] {
  if (t.parentId) return ws.kids(t.parentId);
  const ms = ws.milestone(t.milestoneId);
  if (ms) return ws.msRoots(ms);
  if (t.groupId) return groupTasks(ws, t.groupId);
  if (ws.isDoc(t)) return docRoots(ws, t.projectId);
  return containerTasks(ws, t.projectId, container(t));
}

/**
 * Wo eine Aufgabe hängt. Bei einer losen Wurzel gehört dazu, ob sie ready ist,
 * und dann die Markierung – ohne Markierung die Kategorie: das entscheidet,
 * in welcher Gruppe von „Ready“ sie steht.
 */
export const container = (t: Task): Placement & { parentId: string | null } => ({
  parentId: t.parentId,
  milestoneId: t.milestoneId,
  groupId: t.groupId,
  ...(!isLooseRoot(t)
    ? {}
    : !t.ready
      ? { ready: false }
      : t.markId
        ? { ready: true, markId: t.markId }
        : { ready: true, markId: null, categoryId: t.categoryId }),
});

/** Lose Wurzel: hängt an nichts und ist kein Dokument – also im Backlog. */
export const isLooseRoot = (t: Task): boolean =>
  !t.parentId && !t.milestoneId && !t.groupId && !t.doc;

export const looseTasks = (ws: Workspace, projectId: string): Task[] =>
  ws.tasks.filter((t) => t.projectId === projectId && isLooseRoot(t)).sort((a, b) => a.order - b.order);

/** „Unsortiert“: lose Wurzeln, die nicht ready sind – mit oder ohne Markierung. */
export const unsortedTasks = (ws: Workspace, projectId: string): Task[] =>
  looseTasks(ws, projectId).filter((t) => !t.ready);

/** Eine smarte Gruppe besteht aus den ready-Wurzeln mit genau dieser Markierung. */
export const smartTasks = (ws: Workspace, projectId: string, markId: string): Task[] =>
  looseTasks(ws, projectId).filter((t) => t.ready && t.markId === markId);

/**
 * Die Kategorie, nach der eine ready-Wurzel ohne Markierung einsortiert wird.
 * Eine Kategorie aus einem anderen Projekt zählt wie keine – sonst stünde die
 * Aufgabe in keiner Gruppe.
 */
export const readyCategory = (ws: Workspace, t: Task): string | null =>
  ws.category(t.categoryId)?.projectId === t.projectId ? t.categoryId : null;

/** Eine Kategorie-Gruppe: ready-Wurzeln ohne Markierung mit dieser Kategorie. */
export const categoryTasks = (ws: Workspace, projectId: string, categoryId: string | null): Task[] =>
  looseTasks(ws, projectId).filter((t) => t.ready && !t.markId && readyCategory(ws, t) === categoryId);

/** Die Wurzelaufgaben eines Behälters, in Reihenfolge. */
export function containerTasks(ws: Workspace, projectId: string, place: Placement): Task[] {
  if (place.milestoneId) {
    const m = ws.milestone(place.milestoneId);
    return m ? ws.msRoots(m) : [];
  }
  if (place.groupId) return groupTasks(ws, place.groupId);
  if (!place.ready) return unsortedTasks(ws, projectId);
  if (place.markId) return smartTasks(ws, projectId, place.markId);
  const cat = ws.category(place.categoryId ?? null);
  return categoryTasks(ws, projectId, cat?.projectId === projectId ? cat.id : null);
}

/** Wie viele Wurzelaufgaben ein Behälter schon hat – der Platz ganz unten. */
export const countIn = (ws: Workspace, projectId: string, place: Placement, exceptId?: string): number =>
  containerTasks(ws, projectId, place).filter((t) => t.id !== exceptId).length;

/** Wie der Behälter einer Wurzelaufgabe heißt – für Krümelpfad und Menüs. */
export function placeLabel(ws: Workspace, t: Task): string {
  const root = ws.root(t);
  if (root.doc) return 'Dokumentation';
  const ms = ws.milestone(root.milestoneId);
  if (ms) return ms.title || 'Ohne Titel';
  const group = ws.group(root.groupId);
  if (group) return group.title || 'Neue Gruppe';
  if (!root.ready) return 'Unsortiert';
  const mark = ws.mark(root.markId);
  if (mark) return `${mark.emoji} ${mark.name}`;
  return ws.category(readyCategory(ws, root))?.name ?? 'Ohne Kategorie';
}

/** Der Reiter, in dem eine lose Wurzel steht: „Ready“ oder „Backlog“. */
export const areaLabel = (ws: Workspace, t: Task): 'Ready' | 'Backlog' => {
  const root = ws.root(t);
  return isLooseRoot(root) && root.ready ? 'Ready' : 'Backlog';
};

/**
 * Dasselbe für einen einzelnen Behälter: was „Erledigte archivieren“ im
 * Kontextmenü eines Milestones oder einer Gruppe mitnehmen würde.
 */
export const doneInContainer = (ws: Workspace, projectId: string, place: Placement): Task[] =>
  containerTasks(ws, projectId, place).filter((t) => !isArchived(t) && allDone(ws, t));

/**
 * Was der Knopf „Erledigte archivieren (n)“ mitnehmen würde – wie `doneCands`
 * im Prototyp, getrennt nach Ansicht.
 *
 * Ein Milestone zählt, wenn sein Status auf „Done“ steht; eine Aufgabe, wenn
 * sie selbst erledigt ist oder nur noch aus Erledigtem besteht. Aufgaben eines
 * mitgenommenen Milestones bleiben draußen – sie gehen ohnehin mit ihm.
 * Dokumentationsseiten werden nie archiviert.
 */
export function doneCandidates(
  ws: Workspace,
  o: { view: 'plan' | 'ready' | 'backlog'; projectIds: string[] },
): { milestones: Milestone[]; tasks: Task[] } {
  const inScope = new Set(o.projectIds);
  const planned = o.view === 'plan';

  const milestones = ws.milestones.filter(
    (m) => inScope.has(m.projectId) && !isArchived(m) && m.planned === planned && m.status === 'done',
  );
  const taken = new Set(milestones.map((m) => m.id));

  const tasks = ws.tasks.filter((t) => {
    if (t.parentId || t.doc || isArchived(t) || !inScope.has(t.projectId)) return false;
    if (!allDone(ws, t)) return false;
    const ms = ws.milestone(t.milestoneId);
    if (ms && taken.has(ms.id)) return false;
    // Im Plan zählt nur, was in einem eingeplanten Milestone liegt. Vorbereitete
    // Milestones stehen in Backlog und „Ready“; lose ready-Wurzeln nur in „Ready“,
    // alles übrige nur im Backlog.
    if (planned) return !!ms?.planned;
    if (ms) return !ms.planned;
    return o.view === 'ready' ? isLooseRoot(t) && t.ready : !(isLooseRoot(t) && t.ready);
  });

  return { milestones, tasks };
}
