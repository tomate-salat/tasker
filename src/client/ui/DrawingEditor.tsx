import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { ApiError, api, type Drawing, type Scene } from '../api.js';
import { useStore } from '../store.js';

/**
 * Der Zeichen-Editor ist Excalidraw. Das Paket ist groß, deshalb wird es erst
 * geladen, wenn wirklich jemand zeichnet – der Rest der Anwendung soll davon
 * nichts merken.
 *
 * Gespeichert wird die Szene als Ganzes, mit derselben Versionsprüfung wie
 * überall sonst.
 */
const Excalidraw = lazy(() =>
  import('./excalidraw-lazy.js').then((m) => ({ default: m.Excalidraw })),
);

/** Wie lange nach der letzten Änderung gespeichert wird. */
const SAVE_AFTER_MS = 1500;

/** Jedes Element führt eine eigene Version – daraus wird der Vergleich billig. */
const signature = (elements: unknown[]): string =>
  elements
    .map((e) => {
      const x = e as { id?: string; version?: number; isDeleted?: boolean };
      return `${x.id}:${x.version}:${x.isDeleted ? 1 : 0}`;
    })
    .join('|');

const dark = (): boolean =>
  document.documentElement.dataset['theme'] === 'dark' ||
  (document.documentElement.dataset['theme'] !== 'light' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches);

export function DrawingEditor({ drawing, onClose }: { drawing: Drawing; onClose: () => void }) {
  const say = useStore((s) => s.say);
  const reload = useStore((s) => s.load);
  const removeDrawing = useStore((s) => s.removeDrawing);
  const [name, setName] = useState(drawing.name);
  const [saving, setSaving] = useState(false);

  // Version und letzter Stand leben in Refs: sie ändern sich beim Zeichnen
  // ständig, sollen aber kein neues Rendern auslösen.
  const version = useRef(drawing.version);
  const pending = useRef<Scene | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Excalidraw meldet auch reine Bedienschritte (Werkzeugwechsel, Auswahl).
  // Gespeichert wird nur, wenn sich an den Elementen wirklich etwas ändert.
  const savedSignature = useRef(signature(drawing.scene.elements));

  const save = async (changes: { name?: string; scene?: Scene }): Promise<void> => {
    setSaving(true);
    try {
      const updated = await api.saveDrawing(drawing.id, version.current, changes);
      version.current = updated.version;
      pending.current = null;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        say('Zeichnung wurde woanders geändert – bitte neu öffnen.');
      } else {
        say(e instanceof Error ? e.message : 'Speichern fehlgeschlagen');
      }
    } finally {
      setSaving(false);
    }
  };

  const flush = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current);
    if (pending.current) await save({ scene: pending.current });
  };

  // Beim Schließen darf nichts verloren gehen, auch nicht der letzte Strich.
  useEffect(() => () => void flush(), []);

  async function close(): Promise<void> {
    await flush();
    if (name.trim() && name !== drawing.name) await save({ name: name.trim() });
    // Die Namen stehen im Startpaket, deshalb einmal nachladen.
    await reload();
    onClose();
  }

  /**
   * Wie im Prototyp ohne Rückfrage – die Meldung bietet „Rückgängig“ an.
   * Was noch nicht gespeichert war, wird vorher gesichert, damit es beim
   * Zurückholen nicht fehlt.
   */
  async function remove(): Promise<void> {
    await flush();
    onClose();
    await removeDrawing(drawing.id, drawing.name);
  }

  return (
    <div className="draw-modal" role="dialog" aria-label="Zeichnung bearbeiten">
      <header className="draw-head">
        <input
          className="draw-name"
          value={name}
          aria-label="Name der Zeichnung"
          onChange={(e) => setName(e.target.value)}
        />
        <span className="muted small">{saving ? 'Speichert …' : 'Gespeichert'}</span>
        <button className="danger" onClick={() => void remove()}>
          Löschen
        </button>
        <button className="btn" onClick={() => void close()}>
          Fertig
        </button>
      </header>

      <div className="draw-canvas">
        <Suspense fallback={<p className="muted pad">Editor wird geladen …</p>}>
          <Excalidraw
            initialData={{
              elements: drawing.scene.elements as never,
              files: (drawing.scene.files ?? {}) as never,
              scrollToContent: true,
            }}
            langCode="de-DE"
            theme={dark() ? 'dark' : 'light'}
            onChange={(elements, _appState, files) => {
              const sig = signature(elements as unknown[]);
              if (sig === savedSignature.current) return;
              savedSignature.current = sig;
              pending.current = { elements: [...elements], files: files as Record<string, unknown> };
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => void save({ scene: pending.current ?? undefined }), SAVE_AFTER_MS);
            }}
          />
        </Suspense>
      </div>
    </div>
  );
}
