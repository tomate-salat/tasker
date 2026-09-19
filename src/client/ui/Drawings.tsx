import { useEffect, useState } from 'react';
import { api, type Drawing } from '../api.js';
import { useStore } from '../store.js';
import { DrawingEditor } from './DrawingEditor.js';

/**
 * Die Zeichnungen einer Aufgabe im Inspektor. Das Startpaket kennt nur ihre
 * Namen; die Szenen werden erst beim Öffnen der Aufgabe geholt und der Editor
 * erst beim Zeichnen geladen.
 */
export function Drawings({ taskId }: { taskId: string }) {
  const { boot, say, load } = useStore();
  const names = (boot?.drawings ?? []).filter((d) => d.taskId === taskId);
  const [open, setOpen] = useState<Drawing | null>(null);
  const [busy, setBusy] = useState(false);

  // Wechselt die Aufgabe, gehört der offene Editor nicht mehr dazu.
  useEffect(() => setOpen(null), [taskId]);

  async function openDrawing(id: string): Promise<void> {
    setBusy(true);
    try {
      const { drawings } = await api.drawings(taskId);
      const found = drawings.find((d) => d.id === id);
      if (found) setOpen(found);
    } catch (e) {
      say(e instanceof Error ? e.message : 'Zeichnung konnte nicht geladen werden');
    } finally {
      setBusy(false);
    }
  }

  async function add(): Promise<void> {
    setBusy(true);
    try {
      const created = await api.addDrawing(taskId);
      await load();
      setOpen(created);
    } catch (e) {
      say(e instanceof Error ? e.message : 'Anlegen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await api.deleteDrawing(id);
      await load();
      say('Zeichnung gelöscht');
    } catch (e) {
      say(e instanceof Error ? e.message : 'Löschen fehlgeschlagen');
    }
  }

  return (
    <>
      <div className="draw-list">
        {names.map((d) => (
          <span key={d.id} className="draw-chip">
            <button className="linkish" disabled={busy} onClick={() => void openDrawing(d.id)}>
              ✎ {d.name}
            </button>
            <button
              className="icon-btn tiny"
              title={`„${d.name}“ löschen`}
              aria-label={`Zeichnung ${d.name} löschen`}
              onClick={() => void remove(d.id)}
            >
              ✕
            </button>
          </span>
        ))}
        <button className="linkish" disabled={busy} onClick={() => void add()}>
          + Zeichnung
        </button>
      </div>

      {open && <DrawingEditor drawing={open} onClose={() => setOpen(null)} />}
    </>
  );
}
