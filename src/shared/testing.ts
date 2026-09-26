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
  private ref = 1;

  project(id: string, name = id): this {
    this.data.projects.push({ id,
      version: 1, name, color: '#2A6B5A', order: this.data.projects.length, coverImageId: null });
    return this;
  }

  category(id: string, projectId: string, name = id): this {
    this.data.categories.push({ id,
      version: 1, projectId, name, order: this.data.categories.length, coverImageId: null });
    return this;
  }

  mark(id: string, emoji = '⭐', name = id, projectId = this.data.projects[0]?.id ?? 'p1'): this {
    this.data.marks.push({ id, version: 1, projectId, emoji, name, order: this.data.marks.length, coverImageId: null });
    return this;
  }

  group(id: string, projectId: string, title = id): this {
    this.data.groups.push({ id,
      version: 1, projectId, title, order: this.data.groups.length });
    return this;
  }

  milestone(id: string, projectId: string, o: Partial<Milestone> = {}): this {
    this.data.milestones.push({
      id,
      ref: this.ref++,
      version: 1,
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
      ref: this.ref++,
      version: 1,
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
      ready: false,
      coverImageId: null,
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
  version: 1,
  name: 'p',
  color: '#000',
  order: 0,
  coverImageId: null,
  ...p,
});

export const groupOf = (g: Partial<Group>): Group => ({
  id: 'g',
  version: 1,
  projectId: 'p',
  title: 'g',
  order: 0,
  ...g,
});
