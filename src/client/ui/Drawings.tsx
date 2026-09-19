import { useEffect, useRef, useState } from 'react';
import { api, type Drawing } from '../api.js';
import { useStore } from '../store.js';
import { DrawingEditor } from './DrawingEditor.js';

/**
 * Die Zeichnungen einer Aufgabe. Das Startpaket kennt nur ihre Namen; die
 * Szenen werden geholt, sobald die Aufgabe im Inspektor steht, denn dort
 * werden sie in der Beschreibung angezeigt.
 */
export type DrawingsApi = {
  list: Drawing[];
  busy: boolean;
  open: (d: Drawing) => void;
  /** Legt eine Zeichnung an, bindet sie in die Beschreibung ein und öffnet sie. */
  add: () => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Der Editor – gehört an eine Stelle, die nicht mitscrollt. */
  editor: React.ReactNode;
};

export function useDrawings(taskId: string | null, desc: string): DrawingsApi {
  const { boot, say, load, patch } = useStore();
  const metas = (boot?.drawings ?? []).filter((d) => d.taskId === taskId);
  // Ändert sich eine Version, ist die Szene veraltet und wird neu geholt.
  const stamp = metas.map((d) => `${d.id}:${d.version}`).join('|');

  const [list, setList] = useState<Drawing[]>([]);
  const [open, setOpen] = useState<Drawing | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOpen(null);
    if (!taskId || !stamp) {
      setList([]);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const { drawings } = await api.drawings(taskId);
        if (alive) setList(drawings);
      } catch (e) {
        if (alive) say(e instanceof Error ? e.message : 'Zeichnungen konnten nicht geladen werden');
      }
    })();
    return () => {
      alive = false;
    };
  }, [taskId, stamp, say]);

  async function add(): Promise<void> {
    if (!taskId) return;
    setBusy(true);
    try {
      const created = await api.addDrawing(taskId);
      // Wie im Prototyp: die neue Zeichnung hängt gleich in der Beschreibung.
      const token = `![[zeichnung:${created.name}]]`;
      await patch('task', taskId, {
        desc: desc.trim() ? `${desc.replace(/\s+$/, '')}\n\n${token}` : token,
      });
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

  return {
    list,
    busy,
    open: setOpen,
    add,
    remove,
    editor: open ? <DrawingEditor drawing={open} onClose={() => setOpen(null)} /> : null,
  };
}

/**
 * Eine Zeichnung im Text. Die Vorschau zeichnet Excalidraw selbst
 * (`exportToSvg`), damit sie genau so aussieht wie im Editor; das Paket kommt
 * dafür nachgeladen.
 */
export function DrawingEmbed({ drawing, onOpen }: { drawing: Drawing; onOpen: () => void }) {
  const theme = useStore((s) => s.settings.theme);
  const host = useRef<HTMLSpanElement>(null);
  const elements = (drawing.scene.elements ?? []) as unknown[];
  const empty = elements.length === 0;

  useEffect(() => {
    if (empty) return;
    let alive = true;
    void (async () => {
      const { exportToSvg } = await import('./excalidraw-lazy.js');
      const svg = await exportToSvg({
        elements: elements as never,
        appState: { exportBackground: false, exportWithDarkMode: isDark(theme) } as never,
        files: (drawing.scene.files ?? null) as never,
      });
      if (!alive || !host.current) return;
      // Die feste Größe aus dem Export würde die Spalte sprengen.
      svg.removeAttribute('width');
      svg.removeAttribute('height');
      svg.classList.add('draw-prev');
      host.current.replaceChildren(svg);
    })();
    return () => {
      alive = false;
    };
  }, [drawing.id, drawing.version, theme, empty]);

  return (
    <span
      className="drawing-embed"
      role="button"
      tabIndex={0}
      title={`Zeichnung „${drawing.name}“ bearbeiten`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      {empty ? (
        <span className="draw-empty">Leere Zeichnung – klicken zum Zeichnen</span>
      ) : (
        <span ref={host} className="draw-host" />
      )}
      <span className="draw-cap">✎ {drawing.name}</span>
    </span>
  );
}

const isDark = (theme: string): boolean =>
  theme === 'dark' ||
  (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
