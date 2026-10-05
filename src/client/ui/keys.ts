import { useEffect } from 'react';
import { isDone, type Milestone, type Status, type Task } from '@shared/model.js';
import { container, isCollapsed, siblings, type OutlineRow } from '@shared/outline.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { addAndEdit, addChild, addSibling, indent, moveRowBy, outdent, toBacklog } from './actions.js';
import type { Menu } from './Menu.js';
import { locationMenu, rowMenu } from './rowMenu.js';

/**
 * Die Tastaturbedienung aus dem Prototyp. Sie arbeitet auf derselben
 * Zeilenfolge, die auch angezeigt wird (`outline`), damit Pfeiltasten und
 * Bildschirm nicht auseinanderlaufen können.
 *
 * Während in einem Feld getippt wird, greift hier nichts – die
 * Titelbearbeitung hat ihre eigenen Tasten.
 *
 * `cards`: in der Kartenansicht gelten die Tasten der markierten Karte, nicht
 * der im Inspektor – dort markiert ein Klick nur. Die Pfeile wandern dann von
 * Markierung zu Markierung, → und ← öffnen und schließen die Schublade.
 */
export type CardKeys = { open: Record<string, boolean>; toggle: (id: string, value?: boolean) => void };

export function useKeys(ws: Workspace, rows: OutlineRow[], menu: Menu, cards: CardKeys | null = null): void {
  const store = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      // Über dem Abhängigkeits-Board gehört die Tastatur ganz dem Board – auch
      // wenn der Fokus nach dem Löschen eines Pfeils auf der Seite landet.
      if (target?.closest?.('.draw-modal') || useStore.getState().graphOpen) return;
      const typing = isTyping(target);
      /**
       * Wie im Prototyp (`inList`) gehören die Listentasten nur der Liste: Liegt
       * der Fokus auf einem Knopf in Seitenleiste oder Inspektor, soll `Enter`
       * den Knopf drücken und keine Aufgabe anlegen.
       */
      const inList = !target || target === document.body || !!target.closest('.list');

      // Strg+A wählt alles Sichtbare aus – die einzige Strg-Taste, die uns gehört.
      // Wie im Prototyp nicht beim Tippen: im Namensfeld markiert sie den Text.
      if (!typing && inList && (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault();
        store.selectAllVisible();
        return;
      }
      // Sonst gehören Strg und Meta dem Browser; Alt-Kombinationen kommen weiter unten.
      if (typing || e.ctrlKey || e.metaKey || !inList) return;
      // Die gehört `useGlobalKeys`.
      if (e.key === 'Escape') return;

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

      // Karten: die markierte Karte – aber nur, solange sie zu sehen ist. Sonst
      // träfe etwa `Entf` eine Aufgabe, die nirgends mehr angezeigt wird.
      const marked = cards && rows.some((r) => r.id === store.marked) ? store.marked : null;
      const current = marked ?? store.selected;
      const index = rows.findIndex((r) => r.id === current);
      // Wie im Prototyp (`item(u.sel)`) gelten die Tasten dem Ausgewählten, auch
      // wenn es gerade aus der Ansicht gefallen ist – `P` holt einen Milestone
      // sonst nicht mehr in den Plan zurück, den es eben herausgenommen hat.
      const row = rows[index] ?? hidden(ws, current);

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

      // Kontextmenü-Taste und ⇧ F10 öffnen das Menü unter der Zeile, den Fokus darin.
      if (
        (row.type === 'task' || row.type === 'milestone') &&
        (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10'))
      ) {
        e.preventDefault();
        const r = rowEl(row.id)?.getBoundingClientRect();
        if (r) menu.openAtPoint(r.left + 40, r.bottom, rowMenu(ws, row), true);
        return;
      }

      // Karten: → deckt die Unteraufgaben auf, ← räumt sie weg oder geht zur Karte darüber.
      if (cards && row.type === 'task' && !e.altKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const hasKids = ws.kids(row.id).length > 0;
        if (e.key === 'ArrowRight') {
          if (hasKids) cards.toggle(row.id, true);
        } else if (hasKids && cards.open[row.id]) cards.toggle(row.id, false);
        else if (row.task.parentId) store.mark(row.task.parentId);
        return;
      }
      if (e.key === 'ArrowRight' && !e.altKey) {
        e.preventDefault();
        store.setCollapsed(row.id, false);
        return;
      }
      if (e.key === 'ArrowLeft' && !e.altKey) {
        e.preventDefault();
        const hasKids = row.type === 'task' ? ws.kids(row.id).length > 0 : true;
        // Eine leere Gruppe steht schon zu – dann führt ← gleich eine Ebene höher.
        const shut = isCollapsed(store.collapsed, row.id, row.type === 'group' && !row.tasks.length);
        if (hasKids && !shut) store.setCollapsed(row.id, true);
        else if (row.type === 'task') {
          const up = row.task.parentId ?? row.task.milestoneId ?? row.task.groupId;
          if (up) store.select(up);
        }
        return;
      }

      if (row.type === 'milestone') {
        const m = row.milestone;
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          e.preventDefault();
          void moveRowBy(ws, m, e.key === 'ArrowDown' ? 1 : -1);
          return;
        }
        if (e.altKey) return;
        switch (e.key) {
          case 'Enter':
            e.preventDefault();
            void addAndEdit({ projectId: m.projectId, milestoneId: m.id });
            return;
          case 'e':
          case 'E':
          case 'F2':
            e.preventDefault();
            store.edit(m.id);
            return;
          case ' ':
            e.preventDefault();
            void store.setMilestoneStatus(m.id, stepMsStatus(m.status, e.shiftKey ? -1 : 1));
            return;
          case 'p':
          case 'P':
            void store.planMilestone(m.id, !m.planned);
            return;
          case 'b':
          case 'B':
            void store.planMilestone(m.id, false);
            return;
          case 'a':
          case 'A':
            void store.archiveItem('milestone', m.id);
            return;
          case 'Delete':
          case 'Backspace':
            e.preventDefault();
            void store.remove('milestone', m.id);
            return;
          default:
            return;
        }
      }
      if (row.type !== 'task') return;

      const t = row.task;
      // Dokumentationsseiten haben keinen Status – die Leertaste geht ins Leere.
      const doc = ws.isDoc(t);

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        void moveBy(t, e.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if (e.altKey) return;

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          void (e.shiftKey ? addChild(t) : addSibling(ws, t));
          return;
        case 'Tab':
          e.preventDefault();
          void (e.shiftKey ? outdent(ws, t) : indent(ws, t));
          return;
        case ' ':
          e.preventDefault();
          if (!doc) void store.patch('task', t.id, { status: stepStatus(t.status, e.shiftKey ? -1 : 1) });
          return;
        case 'm':
        case 'M': {
          const el = rowEl(t.id);
          if (el) menu.openAt(el, locationMenu(ws, t), true);
          return;
        }
        case 'e':
        case 'E':
        case 'F2':
          e.preventDefault();
          store.edit(t.id);
          return;
        case 'a':
        case 'A':
          void store.archiveItem('task', t.id);
          return;
        case 'b':
        case 'B':
          // Aus Milestone oder Gruppe heraus zurück in den losen Backlog.
          void toBacklog(t);
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
      if (cards) store.mark(row.id);
      else store.select(row.id);
      document.querySelector(`[data-row="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
    };

    const moveBy = async (t: Task, delta: number): Promise<void> => {
      const list = siblings(ws, t);
      const next = list.indexOf(t) + delta;
      if (next < 0 || next >= list.length) return;
      await store.moveTask(t.id, { ...container(t), index: next });
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ws, rows, store, menu, cards]);
}

const isTyping = (target: HTMLElement | null): boolean =>
  !!target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);

/**
 * Was in jeder Ansicht gilt, auch in Archiv, Papierkorb und Zeitplan – im
 * Prototyp steht es vor der Weiche nach Ansichten.
 */
export function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const store = useStore.getState();
      const target = e.target as HTMLElement | null;
      // Im Zeichen-Editor gehören alle Tasten Excalidraw: Esc schlösse sonst den
      // Inspektor samt Editor, Strg+Z nähme eine Änderung an den Tasks zurück.
      // Das Abhängigkeits-Board kümmert sich selbst um Esc und Strg+Z.
      if (target?.closest?.('.draw-modal') || store.graphOpen) return;
      const typing = isTyping(target);

      if (e.key === 'Escape') {
        if (typing) target?.blur();
        // Escape hebt zuerst die Mehrfachauswahl auf, erst danach die Anzeige.
        else if (store.multi.size) store.clearMulti();
        // Wie im Prototyp schließt der Inspektor nur, wenn er über der Liste liegt;
        // daneben stört er nicht, und Escape soll nichts Unsichtbares tun.
        else if (store.selected && window.matchMedia('(max-width: 1240px)').matches) store.select(null);
        return;
      }
      if (typing) return;

      // Strg+Z nimmt die letzte Änderung zurück.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        void store.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const hidden = (ws: Workspace, id: string | null): OutlineRow | undefined => {
  const m = ws.milestone(id);
  if (m) return { type: 'milestone', id: m.id, milestone: m };
  const t = ws.task(id);
  return t ? { type: 'task', id: t.id, task: t, depth: 0 } : undefined;
};

const rowEl = (id: string): HTMLElement | null => document.querySelector(`[data-row="${id}"]`);

/**
 * Die Leertaste schaltet nur durch den normalen Ablauf. Unklar und Blockiert
 * sind Sonderstatus, die ausdrücklich gesetzt werden – von dort führt sie
 * zurück auf Offen. (Abweichung vom Prototyp, auf Wunsch.)
 *
 * Auf Wunsch des Nutzers gibt es keine Taste mehr, die unmittelbar auf
 * „erledigt“ setzt; das frühere `S` ist damit entfallen.
 *
 * Die Reihe läuft nicht im Kreis: bei Erledigt ist Schluss, sonst käme man mit
 * einem Druck zu viel versehentlich wieder auf Offen. Zurück geht es mit
 * Umschalt und Leertaste.
 */
const STATUS_CYCLE: Status[] = ['open', 'progress', 'done'];

/** Einen Schritt weiter oder zurück; an den Enden bleibt es stehen. */
const stepStatus = (s: Status, dir: 1 | -1): Status => {
  const at = STATUS_CYCLE.indexOf(s);
  // Aus einem Sonderstatus heraus beginnt die Reihe wieder bei Offen.
  if (at < 0) return 'open';
  const next = Math.max(0, Math.min(STATUS_CYCLE.length - 1, at + dir));
  return STATUS_CYCLE[next] ?? s;
};

const MS_CYCLE = ['open', 'progress', 'done'] as const;
type MsStatus = (typeof MS_CYCLE)[number];

const stepMsStatus = (s: Milestone['status'], dir: 1 | -1): MsStatus => {
  const at = MS_CYCLE.indexOf(s as MsStatus);
  if (at < 0) return 'open';
  const next = Math.max(0, Math.min(MS_CYCLE.length - 1, at + dir));
  return MS_CYCLE[next] ?? 'open';
};
