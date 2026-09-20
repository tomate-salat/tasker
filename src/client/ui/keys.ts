import { useEffect } from 'react';
import { TASK_STATUS, isDone, type Status, type Task } from '@shared/model.js';
import { container, siblings, type OutlineRow } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { focusQuickAdd } from './QuickAdd.js';

/**
 * Die Tastaturbedienung aus dem Prototyp. Sie arbeitet auf derselben
 * Zeilenfolge, die auch angezeigt wird (`outline`), damit Pfeiltasten und
 * Bildschirm nicht auseinanderlaufen können.
 *
 * Während in einem Feld getippt wird, greift hier nichts – die Erfassungszeile
 * und die Titelbearbeitung haben ihre eigenen Tasten.
 */
export function useKeys(ws: Workspace, rows: OutlineRow[]): void {
  const store = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

      if (e.key === 'Escape') {
        if (typing) target?.blur();
        // Escape hebt zuerst die Mehrfachauswahl auf, erst danach die Anzeige.
        else if (store.multi.size) store.clearMulti();
        else if (store.selected) store.select(null);
        return;
      }

      // Strg+Z nimmt die letzte Änderung zurück.
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        void store.undo();
        return;
      }
      // Strg+A wählt alles Sichtbare aus – die einzige Strg-Taste, die uns gehört.
      if (!typing && (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        store.selectAllVisible();
        return;
      }
      // Sonst gehören Strg und Meta dem Browser; Alt-Kombinationen kommen weiter unten.
      if (typing || e.ctrlKey || e.metaKey) return;

      // Umschalt plus Pfeiltaste erweitert die Auswahl, statt zu wandern.
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        store.extendMulti(e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (store.multi.size && !e.shiftKey) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          void store.bulk(
            { type: 'trash' },
            (c) => `${c} ${c === 1 ? 'Aufgabe' : 'Aufgaben'} in den Papierkorb verschoben`,
          );
          return;
        }
        if (e.key === 'a' || e.key === 'A') {
          void store.bulk(
            { type: 'archive' },
            (c) => `${c} ${c === 1 ? 'Aufgabe' : 'Aufgaben'} archiviert`,
          );
          return;
        }
      }

      if (e.key === 'n' || e.key === 'N' || e.key === '/') {
        e.preventDefault();
        focusQuickAdd();
        return;
      }

      const index = rows.findIndex((r) => r.id === store.selected);
      const row = rows[index];

      // Mit Alt verschieben die Pfeiltasten die Zeile, sie wandern nicht.
      if (!e.altKey && (e.key === 'ArrowDown' || e.key === 'j')) {
        e.preventDefault();
        go(rows[Math.min(rows.length - 1, index + 1)] ?? rows[0]);
        return;
      }
      if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'k')) {
        e.preventDefault();
        go(rows[Math.max(0, index - 1)] ?? rows[0]);
        return;
      }
      if (!row) return;

      if (e.key === 'ArrowRight' && !e.altKey) {
        e.preventDefault();
        store.setCollapsed(row.id, false);
        return;
      }
      if (e.key === 'ArrowLeft' && !e.altKey) {
        e.preventDefault();
        const hasKids = row.type === 'task' ? ws.kids(row.id).length > 0 : true;
        if (hasKids && !store.collapsed[row.id]) store.setCollapsed(row.id, true);
        else if (row.type === 'task') {
          const up = row.task.parentId ?? row.task.milestoneId ?? row.task.groupId;
          if (up) store.select(up);
        }
        return;
      }

      if (row.type === 'milestone') {
        if (e.key === 'Enter') {
          e.preventDefault();
          void addAndEdit({ projectId: row.milestone.projectId, milestoneId: row.id });
        } else if (e.key === 'a' || e.key === 'A') {
          void store.archiveItem('milestone', row.id);
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          void store.remove('milestone', row.id);
        }
        return;
      }
      if (row.type !== 'task') return;

      const t = row.task;

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        void moveBy(t, e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.altKey) return;

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          void (e.shiftKey ? addChild(t) : addSibling(t));
          return;
        case 'Tab':
          e.preventDefault();
          void (e.shiftKey ? outdent(t) : indent(t));
          return;
        case ' ':
          e.preventDefault();
          void store.patch('task', t.id, { status: isDone(t) ? 'open' : 'done' });
          return;
        case 'e':
        case 'E':
        case 'F2':
          e.preventDefault();
          store.edit(t.id);
          return;
        case 's':
        case 'S':
          void store.patch('task', t.id, { status: nextStatus(t.status) });
          return;
        case 'a':
        case 'A':
          void store.archiveItem('task', t.id);
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          void store.remove('task', t.id);
          return;
        default:
          return;
      }
    };

    const go = (row: OutlineRow | undefined): void => {
      if (!row) return;
      store.select(row.id);
      document.querySelector(`[data-row="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
    };

    /** Neue Aufgabe anlegen und gleich den Titel bearbeiten. */
    const addAndEdit = async (input: Record<string, unknown>): Promise<void> => {
      const id = await store.addTask({ title: '', ...input });
      if (id) store.edit(id);
    };

    /** Neue Aufgabe direkt unter der aktuellen, nicht am Ende der Liste. */
    const addSibling = async (t: Task): Promise<void> => {
      const at = siblings(ws, t).indexOf(t) + 1;
      const id = await store.addTask({ title: '', projectId: t.projectId, ...container(t) });
      if (!id) return;
      await store.moveTask(id, { ...container(t), index: at });
      store.edit(id);
    };

    const addChild = async (t: Task): Promise<void> => {
      store.setCollapsed(t.id, false);
      await addAndEdit({ projectId: t.projectId, parentId: t.id });
    };

    const indent = async (t: Task): Promise<void> => {
      const list = siblings(ws, t);
      const before = list[list.indexOf(t) - 1];
      if (!before) {
        store.say('Keine Aufgabe darüber, unter die eingerückt werden könnte.');
        return;
      }
      store.setCollapsed(before.id, false);
      await store.moveTask(t.id, { parentId: before.id, index: ws.kids(before.id).length });
    };

    const outdent = async (t: Task): Promise<void> => {
      const parent = ws.task(t.parentId);
      if (!parent) {
        store.say('Liegt schon auf der obersten Ebene.');
        return;
      }
      const list = siblings(ws, parent);
      await store.moveTask(t.id, { ...container(parent), index: list.indexOf(parent) + 1 });
    };

    const moveBy = async (t: Task, delta: number): Promise<void> => {
      const list = siblings(ws, t);
      const next = list.indexOf(t) + delta;
      if (next < 0 || next >= list.length) return;
      await store.moveTask(t.id, { ...container(t), index: next });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, rows, store]);
}

const nextStatus = (s: Status): Status =>
  TASK_STATUS[(TASK_STATUS.indexOf(s) + 1) % TASK_STATUS.length] as Status;
