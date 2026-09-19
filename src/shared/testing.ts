import type { Data, Group, Milestone, Prio, Project, Status, Task } from './model.js';
import { Workspace } from './workspace.js';

/** Kleiner Baukasten, damit die Tests lesbar bleiben. */
export class Builder {
  private data: Data = {
    projects: [],
    categories: [],
    marks: [],
    groups: [],
    milestones: [],
    tasks: [],
  };
  private n = 0;

  project(id: string, name = id): this {
    this.data.projects.push({ id, name, color: '#2A6B5A', order: this.data.projects.length });
    return this;
  }

  category(id: string, projectId: string, name = id): this {
    this.data.categories.push({ id, projectId, name, order: this.data.categories.length });
    return this;
  }

  group(id: string, projectId: string, title = id): this {
    this.data.groups.push({ id, projectId, title, order: this.data.groups.length });
    return this;
  }

  milestone(id: string, projectId: string, o: Partial<Milestone> = {}): this {
    this.data.milestones.push({
      id,
      projectId,
      title: id,
      desc: '',
      planned: false,
      status: 'open',
      order: this.data.milestones.length,
      qorder: this.data.milestones.length,
      startDate: null,
      endDate: null,
      endAuto: false,
      archivedAt: null,
      deps: [],
      ...o,
    });
    return this;
  }

  task(id: string, projectId: string, o: Partial<Task> = {}): this {
    this.data.tasks.push({
      id,
      projectId,
      parentId: null,
      milestoneId: null,
      groupId: null,
      doc: false,
      title: id,
      desc: '',
      prio: 0 as Prio,
      status: 'open' as Status,
      doneAt: null,
      order: this.n++,
      categoryId: null,
      markId: null,
      archivedAt: null,
      tags: [],
      deps: [],
      ...o,
    });
    return this;
  }

  build(): Workspace {
    return new Workspace(this.data);
  }

  raw(): Data {
    return this.data;
  }
}

export const projectOf = (p: Partial<Project>): Project => ({
  id: 'p',
  name: 'p',
  color: '#000',
  order: 0,
  ...p,
});

export const groupOf = (g: Partial<Group>): Group => ({
  id: 'g',
  projectId: 'p',
  title: 'g',
  order: 0,
  ...g,
});
