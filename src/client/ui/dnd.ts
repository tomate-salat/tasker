import { useState } from 'react';
import { container, siblings } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';

/**
 * Ziehen und Ablegen im Baum.
 *
 * Über einer Aufgabe gibt es drei Zonen: oben „davor“, unten „danach“, in der
 * Mitte „hinein“. Über einem Milestone oder einer Gruppe gibt es nur „hinein“.
 * Der Platz wird als Position unter den künftigen Geschwistern geschickt, ohne
 * die verschobene Aufgabe mitzuzählen – genauso rechnet der Server.
 */
export type Zone = 'before' | 'after' | 'child' | 'into';

export type Dnd = {
  dragId: string | null;
  drop: { id: string; zone: Zone } | null;
  start: (id: string) => void;
  end: () => void;
  over: (e: React.DragEvent, id: string, kind: 'task' | 'container') => void;
  release: (e: React.DragEvent) => void;
};

export function useDnd(ws: Workspace): Dnd {
  const { moveTask, say } = useStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);

  const end = (): void => {
    setDragId(null);
    setDrop(null);
  };

  return {
    dragId,
    drop,
    start: (id) => {
      setDragId(id);
      setDrop(null);
    },
    end,

    over: (e, id, kind) => {
      if (!dragId || id === dragId) return;
      // Eine Aufgabe darf nicht in den eigenen Teilbaum wandern.
      const dragged = ws.task(dragId);
      if (kind === 'task' && dragged && ws.desc(dragged).some((x) => x.id === id)) return;

      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (kind === 'container') {
        setDrop({ id, zone: 'into' });
        return;
      }
      const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = (e.clientY - box.top) / box.height;
      setDrop({ id, zone: y < 0.28 ? 'before' : y > 0.72 ? 'after' : 'child' });
    },

    release: (e) => {
      e.preventDefault();
      const id = dragId;
      const target = drop;
      end();
      if (!id || !target) return;

      const dragged = ws.task(id);
      if (!dragged) return;

      if (target.zone === 'into') {
        const ms = ws.milestone(target.id);
        void moveTask(
          id,
          ms
            ? { milestoneId: ms.id, index: ws.msRoots(ms).filter((t) => t.id !== id).length }
            : { groupId: target.id, index: groupRootCount(ws, target.id, id) },
        );
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
      void moveTask(id, { ...container(onto), index: at + (target.zone === 'after' ? 1 : 0) });
    },
  };
}

const groupRootCount = (ws: Workspace, groupId: string, exceptId: string): number =>
  ws.tasks.filter((t) => t.groupId === groupId && !t.parentId && t.id !== exceptId).length;
