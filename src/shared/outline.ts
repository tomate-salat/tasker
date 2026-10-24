import { effectiveCategory, effectiveTags } from './inherit.js';
import { allDone } from './progress.js';
import { isArchived, type Category, type Group, type Mark, type Milestone, type Project, type Status, type Task } from './model.js';
import type { Workspace } from './workspace.js';

/**
 * Die sichtbare Zeilenfolge einer Ansicht – einmal berechnet, von der Anzeige
 * und von der Tastatursteuerung gemeinsam benutzt. Würden beide die Reihenfolge
 * getrennt bestimmen, liefen Pfeiltasten und Bildschirm irgendwann auseinander.
 *
 * Der Bereich kann ein Projekt sein oder alle; bei mehreren bekommt jedes eine
 * Überschrift, wie im Prototyp.
 *
 * Der Backlog zeigt die vorbereiteten Milestones, die Nebenquests (eine
 * besondere Gruppe je Projekt, für ein Release optional) und „Ideen & Tasks“
 * (Unsortiert plus die eigenen Gruppen). Abweichung vom Prototyp, auf Wunsch:
 * smarte Gruppen gibt es nicht – Kategorie und Markierung schränkt die
 * Filterleiste ein, und ob eine Aufgabe fertig geplant ist, sagt ihr Status „Bereit“.
 */

/** Wo eine Aufgabe hängt – dieselben Felder, die Anlegen und Verschieben erwarten. */
export type Placement = {
  milestoneId?: string | null;
  groupId?: string | null;
};

/** Was die Überschrift eines Abschnitts rechts anbietet. */
export type SectionAction = 'add-draft-milestone' | 'add-group' | 'add-task';

export type OutlineRow =
  | { type: 'project'; id: string; project: Project }
  | {
      type: 'section';
      id: string;
      title: string;
      action: SectionAction;
      projectId: string;
      /** Bei 'add-task': wohin die neue Aufgabe kommt. */
      place?: Placement;
    }
  /** Hinweistext ohne eigene Funktion, etwa wenn es noch keine Entwürfe gibt. */
  | { type: 'hint'; id: string; text: string }
  | { type: 'milestone'; id: string; milestone: Milestone }
  | {
      type: 'group';
      id: string;
      title: string;
      /** Null beim Sammelbereich „Unsortiert“. */
      group: Group | null;
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
  /** Nur Aufgaben mit genau diesem eigenen Status (Wunsch des Nutzers). */
  status?: Status | null;
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
  // Gefiltert gilt ein eigener Klappzustand, der offen beginnt (siehe `collapsedOf` im Client).
  const open = (id: string, empty = false): boolean => !isCollapsed(o.collapsed, id, empty);
  const many = o.projectIds.length > 1;
  /** Ein Behälter ohne Treffer fällt beim Filtern weg. */
  const hidden = (tasks: Task[]): boolean => filtering && !tasks.some(show);

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
    if (hidden(roots)) return;
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
      drafts(projectId);
      sidequests(projectId);
      backlog(projectId);
    }

    // Die Projektüberschrift kommt nur, wenn darunter auch etwas steht.
    if (many && rows.length > before) {
      rows.splice(before, 0, { type: 'project', id: projectId, project });
    }
  }

  return rows;

  /** Vorbereitete Milestones, oben im Backlog. */
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

  /**
   * Die Nebenquests: ein eigener Bereich, aber nur eine Gruppe – deshalb ohne
   * Gruppenzeile, die Aufgaben stehen gleich unter der Überschrift.
   */
  function sidequests(projectId: string): void {
    const g = sidequestsOf(ws, projectId);
    if (!g) return;
    const tasks = groupTasks(ws, g.id);
    if (hidden(tasks)) return;
    const place = { groupId: g.id };
    rows.push({
      type: 'section',
      id: `sec:sidequests:${projectId}`,
      title: g.title || 'Nebenquests',
      action: 'add-task',
      projectId,
      place,
    });
    contents(tasks, g.id, projectId, place, false);
  }

  function backlog(projectId: string): void {
    rows.push({
      type: 'section',
      id: `sec:ideas:${projectId}`,
      title: 'Ideen & Tasks',
      action: 'add-group',
      projectId,
    });
    box(unsortedId(projectId), 'Unsortiert', null, projectId, {}, unsortedTasks(ws, projectId));
    for (const g of groupsOf(ws, projectId)) {
      box(g.id, g.title || 'Neue Gruppe', g, projectId, { groupId: g.id }, groupTasks(ws, g.id));
    }
  }

  /** Eine Gruppe im Backlog – eine eigene oder der Sammelbereich „Unsortiert“. */
  function box(id: string, title: string, group: Group | null, projectId: string, place: Placement, tasks: Task[]): void {
    if (hidden(tasks)) return;
    rows.push({ type: 'group', id, title, group, projectId, place, tasks });
    contents(tasks, id, projectId, place, !open(id, !tasks.length));
  }
}

export const isFiltering = (f: OutlineFilter | undefined): boolean =>
  !!(f && (f.tag || f.categoryId || f.markId || f.status));

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
    if (f?.status && t.status !== f.status) return false;
    return true;
  };

  const show = (t: Task): boolean => matches(t) || ws.kids(t.id).some(show);
  return show;
}

/**
 * Ob ein Behälter zugeklappt ist. Wer ihn angefasst hat, bestimmt es selbst;
 * ohne gespeicherten Zustand gilt die Vorgabe. Für Gruppen – auch
 * „Unsortiert“ – ist das `leer`: eine Gruppe ohne Aufgaben steht zu, damit
 * die Ansicht nicht aus lauter leeren Behältern besteht (Wunsch des Nutzers).
 * Sobald eine Aufgabe darin liegt, ist sie wieder offen.
 */
export const isCollapsed = (collapsed: Record<string, boolean>, id: string, leer = false): boolean =>
  collapsed[id] ?? leer;

/** Der Sammelbereich im Backlog ist keine echte Gruppe, hat aber eine ID für den Klappzustand. */
export const unsortedId = (projectId: string): string => `unsorted:${projectId}`;

/** Die Markierungen eines Projekts – jedes Projekt hat seine eigenen. */
export const marksOf = (ws: Workspace, projectId: string): Mark[] =>
  ws.marks.filter((k) => k.projectId === projectId).sort((a, b) => a.order - b.order);

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

/** Die eigenen Gruppen eines Projekts – die Nebenquests zählen nicht dazu. */
export const groupsOf = (ws: Workspace, projectId: string): Group[] =>
  ws.groups.filter((g) => g.projectId === projectId && !g.kind).sort((a, b) => a.order - b.order);

/** Die Nebenquests eines Projekts – der Server legt sie für jedes Projekt an. */
export const sidequestsOf = (ws: Workspace, projectId: string): Group | null =>
  ws.groups.find((g) => g.projectId === projectId && g.kind === 'sidequest') ?? null;

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

/** Wo eine Aufgabe hängt. */
export const container = (t: Task): Placement & { parentId: string | null } => ({
  parentId: t.parentId,
  milestoneId: t.milestoneId,
  groupId: t.groupId,
});

/** Lose Wurzel: hängt an nichts und ist kein Dokument – also im Backlog. */
export const isLooseRoot = (t: Task): boolean =>
  !t.parentId && !t.milestoneId && !t.groupId && !t.doc;

export const looseTasks = (ws: Workspace, projectId: string): Task[] =>
  ws.tasks.filter((t) => t.projectId === projectId && isLooseRoot(t)).sort((a, b) => a.order - b.order);

/** „Unsortiert“: alle losen Wurzeln des Projekts. */
export const unsortedTasks = looseTasks;

/** Die Wurzelaufgaben eines Behälters, in Reihenfolge. */
export function containerTasks(ws: Workspace, projectId: string, place: Placement): Task[] {
  if (place.milestoneId) {
    const m = ws.milestone(place.milestoneId);
    return m ? ws.msRoots(m) : [];
  }
  if (place.groupId) return groupTasks(ws, place.groupId);
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
  return 'Unsortiert';
}

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
  o: { view: 'plan' | 'backlog'; projectIds: string[] },
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
    // Im Plan zählt nur, was in einem eingeplanten Milestone liegt, im Backlog der Rest.
    if (planned) return !!ms?.planned;
    return !ms?.planned;
  });

  return { milestones, tasks };
}
