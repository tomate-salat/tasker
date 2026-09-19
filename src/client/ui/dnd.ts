import { useState } from 'react';
import { container, countIn, isLooseRoot, siblings, type Placement } from '@shared/outline.js';
import type { Task } from '@shared/model.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';

/**
 * Ziehen und Ablegen im Baum.
 *
 * Über einer Aufgabe gibt es drei Zonen: oben „davor“, unten „danach“, in der
 * Mitte „hinein“. Über einem Milestone, einer Gruppe oder einem leeren
 * Platzhalter gibt es nur „hinein“. Der Platz wird als Position unter den
 * künftigen Geschwistern geschickt, ohne die verschobene Aufgabe mitzuzählen –
 * genauso rechnet der Server.
 */
export type Zone = 'before' | 'after' | 'child' | 'into';

/** Ein Behälter als Ziel: wohin, und in welchem Projekt er liegt. */
export type Container = { id: string; projectId: string; place: Placement };

export type Dnd = {
  dragId: string | null;
  drop: { id: string; zone: Zone } | null;
  start: (id: string) => void;
  end: () => void;
  overTask: (e: React.DragEvent, id: string) => void;
  overContainer: (e: React.DragEvent, target: Container) => void;
  release: (e: React.DragEvent) => void;
};

export function useDnd(ws: Workspace): Dnd {
  const { moveTask, say } = useStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const [into, setInto] = useState<Container | null>(null);

  const end = (): void => {
    setDragId(null);
    setDrop(null);
    setInto(null);
  };

  const accepts = (e: React.DragEvent): boolean => {
    if (!dragId) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return true;
  };

  return {
    dragId,
    drop,
    start: (id) => {
      setDragId(id);
      setDrop(null);
      setInto(null);
    },
    end,

    overContainer: (e, target) => {
      if (!accepts(e)) return;
      setDrop({ id: target.id, zone: 'into' });
      setInto(target);
    },

    overTask: (e, id) => {
      if (!dragId || id === dragId) return;
      // Eine Aufgabe darf nicht in den eigenen Teilbaum wandern.
      const dragged = ws.task(dragId);
      if (dragged && ws.desc(dragged).some((x) => x.id === id)) return;
      if (!accepts(e)) return;

      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - box.top) / box.height;
      setDrop({ id, zone: y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'child' });
      setInto(null);
    },

    release: (e) => {
      e.preventDefault();
      const id = dragId;
      const target = drop;
      const dest = into;
      end();
      if (!id || !target) return;

      const dragged = ws.task(id);
      if (!dragged) return;

      if (target.zone === 'into') {
        if (!dest) return;
        void moveTask(id, {
          parentId: null,
          milestoneId: dest.place.milestoneId ?? null,
          groupId: dest.place.groupId ?? null,
          projectId: dest.projectId,
          ...markFor(dragged, dest.place),
          index: countIn(ws, dest.projectId, dest.place, id),
        });
        return;
      }

      const onto = ws.task(target.id);
      if (!onto) return;

      if (target.zone === 'child') {
        void moveTask(id, { parentId: onto.id, index: ws.kids(onto.id).length });
        return;
      }

      const list = siblings(ws, onto).filter((t) => t.id !== id);
      const at = list.indexOf(onto);
      if (at < 0) {
        say('Ziel nicht gefunden.');
        return;
      }
      void moveTask(id, {
        ...container(onto),
        projectId: onto.projectId,
        index: at + (target.zone === 'after' ? 1 : 0),
      });
    },
  };
}

/**
 * Die Regel des Prototyps für smarte Gruppen: hinein setzt die Markierung der
 * Gruppe, heraus in den Backlog nimmt sie weg, heraus in einen Milestone lässt
 * sie stehen.
 */
function markFor(dragged: Task, place: Placement): { markId?: string | null } {
  if (!place.milestoneId && !place.groupId) return { markId: place.markId ?? null };
  if (place.groupId && isLooseRoot(dragged) && dragged.markId) return { markId: null };
  return {};
}
