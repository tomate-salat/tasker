import { effectiveCategory, effectiveTags } from './inherit.js';
import { isArchived, type Group, type Mark, type Milestone, type Project, type Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Die sichtbare Zeilenfolge einer Ansicht – einmal berechnet, von der Anzeige
 * und von der Tastatursteuerung gemeinsam benutzt. Würden beide die Reihenfolge
 * getrennt bestimmen, liefen Pfeiltasten und Bildschirm irgendwann auseinander.
 *
 * Der Bereich kann ein Projekt sein oder alle; bei mehreren bekommt jedes eine
 * Überschrift, wie im Prototyp.
 *
 * Der Backlog ist wie im Prototyp in drei Abschnitte geteilt: vorbereitete
 * Milestones, „Ideen & Tasks“ (Unsortiert plus die eigenen Gruppen) und die
 * smarten Gruppen, eine je Markierung.
 */

/** Wo eine Aufgabe hängt – dieselben Felder, die Anlegen und Verschieben erwarten. */
export type Placement = {
  milestoneId?: string | null;
  groupId?: string | null;
  /**
   * Nur bei losen Wurzeln im Backlog: die Markierung entscheidet, in welcher
   * smarten Gruppe die Aufgabe steht. `null` heißt „Unsortiert“.
   */
  markId?: string | null;
};

/** Was die Überschrift eines Backlog-Abschnitts rechts anbietet. */
export type SectionAction = 'add-draft-milestone' | 'add-group' | 'manage-marks';

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
      /** Gesetzt bei einer smarten Gruppe – sie gehört zu genau dieser Markierung. */
      mark: Mark | null;
      projectId: string;
      place: Placement;
      /** Die Wurzelaufgaben der Gruppe – für Zähler und „+“. */
      tasks: Task[];
    }
  /** Leerer Behälter: gestrichelter Platzhalter zum Hineinziehen. */
  | { type: 'empty'; id: string; projectId: string; place: Placement }
  | { type: 'task'; id: string; task: Task; depth: number };

export type OutlineView = 'plan' | 'backlog' | 'docs';

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
    for (const t of visible) walk(t, 0);
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
    } else {
      backlog(projectId);
    }

    // Die Projektüberschrift kommt nur, wenn darunter auch etwas steht.
    if (many && rows.length > before) {
      rows.splice(before, 0, { type: 'project', id: projectId, project });
    }
  }

  return rows;

  function backlog(projectId: string): void {
    rows.push({
      type: 'section',
      id: `sec:drafts:${projectId}`,
      title: 'Vorbereitete Milestones',
      action: 'add-draft-milestone',
      projectId,
    });
    const drafts = draftMilestones(ws, projectId);
    if (!drafts.length && !filtering) {
      rows.push({
        type: 'hint',
        id: `hint:drafts:${projectId}`,
        text: 'Noch keine. Hier bereitest du Milestones vor, bevor sie in den Plan kommen.',
      });
    }
    for (const m of drafts) milestoneBlock(m);

    rows.push({
      type: 'section',
      id: `sec:ideas:${projectId}`,
      title: 'Ideen & Tasks',
      action: 'add-group',
      projectId,
    });

    const unsorted = unsortedTasks(ws, projectId);
    if (!filtering || unsorted.some(show)) {
      const id = unsortedId(projectId);
      rows.push({
        type: 'group',
        id,
        title: 'Unsortiert',
        group: null,
        mark: null,
        projectId,
        place: {},
        tasks: unsorted,
      });
      contents(unsorted, id, projectId, {}, !open(id));
    }

    for (const g of groupsOf(ws, projectId)) {
      const tasks = groupTasks(ws, g.id);
      if (filtering && !tasks.some(show)) continue;
      rows.push({
        type: 'group',
        id: g.id,
        title: g.title || 'Neue Gruppe',
        group: g,
        mark: null,
        projectId,
        place: { groupId: g.id },
        tasks,
      });
      contents(tasks, g.id, projectId, { groupId: g.id }, !open(g.id));
    }

    if (!ws.marks.length) return;
    rows.push({
      type: 'section',
      id: `sec:smart:${projectId}`,
      title: 'Smarte Gruppen',
      action: 'manage-marks',
      projectId,
    });
    for (const k of ws.marks) {
      const tasks = smartTasks(ws, projectId, k.id);
      if (filtering && !tasks.some(show)) continue;
      const id = smartId(projectId, k.id);
      rows.push({
        type: 'group',
        id,
        title: k.name,
        group: null,
        mark: k,
        projectId,
        place: { markId: k.id },
        tasks,
      });
      contents(tasks, id, projectId, { markId: k.id }, !open(id));
    }
  }
}

const isFiltering = (f: OutlineFilter | undefined): boolean =>
  !!(f && (f.tag || f.categoryId || f.markId));

/**
 * Ein Task ist sichtbar, wenn er selbst passt oder eine seiner Unteraufgaben –
 * sonst verschwände der Ast, in dem der Treffer hängt.
 */
function visibility(ws: Workspace, f: OutlineFilter | undefined): (t: Task) => boolean {
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
  return t.markId ? smartTasks(ws, t.projectId, t.markId) : unsortedTasks(ws, t.projectId);
}

/**
 * Wo eine Aufgabe hängt. Bei einer losen Wurzel gehört die Markierung dazu:
 * sie entscheidet, ob die Aufgabe unter „Unsortiert“ oder in einer smarten
 * Gruppe steht.
 */
export const container = (t: Task): Placement & { parentId: string | null } => ({
  parentId: t.parentId,
  milestoneId: t.milestoneId,
  groupId: t.groupId,
  ...(isLooseRoot(t) ? { markId: t.markId } : {}),
});

/** Lose Wurzel: hängt an nichts und ist kein Dokument – also im Backlog. */
export const isLooseRoot = (t: Task): boolean =>
  !t.parentId && !t.milestoneId && !t.groupId && !t.doc;

export const looseTasks = (ws: Workspace, projectId: string): Task[] =>
  ws.tasks.filter((t) => t.projectId === projectId && isLooseRoot(t)).sort((a, b) => a.order - b.order);

/** „Unsortiert“: lose Wurzeln ohne Markierung. */
export const unsortedTasks = (ws: Workspace, projectId: string): Task[] =>
  looseTasks(ws, projectId).filter((t) => !t.markId);

/** Eine smarte Gruppe besteht aus den losen Wurzeln mit genau dieser Markierung. */
export const smartTasks = (ws: Workspace, projectId: string, markId: string): Task[] =>
  looseTasks(ws, projectId).filter((t) => t.markId === markId);

/** Die Wurzelaufgaben eines Behälters, in Reihenfolge. */
export function containerTasks(ws: Workspace, projectId: string, place: Placement): Task[] {
  if (place.milestoneId) {
    const m = ws.milestone(place.milestoneId);
    return m ? ws.msRoots(m) : [];
  }
  if (place.groupId) return groupTasks(ws, place.groupId);
  if (place.markId) return smartTasks(ws, projectId, place.markId);
  return unsortedTasks(ws, projectId);
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
  const mark = ws.mark(root.markId);
  return mark ? `${mark.emoji} ${mark.name}` : 'Unsortiert';
}
