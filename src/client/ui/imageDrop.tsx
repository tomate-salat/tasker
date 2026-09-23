import { useCallback, useState } from 'react';
import { api, imageMarkdown, type ImageMeta } from '../api.js';
import { useStore } from '../store.js';
import { ImageRejected, imagesIn, prepareImage } from './imageFile.js';

/**
 * Bilder kommen auf zwei Wegen herein: eingefügt aus der Zwischenablage oder
 * ins Fenster gezogen. Einen Dateidialog gibt es bewusst nicht.
 *
 * Beide Wege enden hier: verkleinern, nach WebP umwandeln, hochladen. Was
 * danach mit dem Bild geschieht, entscheidet die Stelle, die den Haken benutzt
 * – der Editor setzt es an der Cursorposition ein, die Karte hängt es an den
 * Text an, die Galerie legt es nur ab.
 */

export type Uploader = {
  /** Lädt hoch und gibt die Angaben zurück; `null`, wenn nichts dabei war. */
  upload: (files: FileList | File[] | null | undefined) => Promise<ImageMeta[]>;
  /** Während der Umwandlung – der Vorgang kann einen Moment dauern. */
  busy: boolean;
};

export function useUpload(projectId: string | null, folderId: string | null = null): Uploader {
  const [busy, setBusy] = useState(false);

  const upload = useCallback(
    async (list: FileList | File[] | null | undefined): Promise<ImageMeta[]> => {
      const files = imagesIn(list);
      if (!files.length) return [];
      const { imageMaxKb, imageMaxEdge } = useStore.getState().settings;
      setBusy(true);
      useStore.setState({ toast: files.length > 1 ? `${files.length} Bilder werden vorbereitet …` : 'Bild wird vorbereitet …', toastUndo: false });
      const done: ImageMeta[] = [];
      try {
        for (const file of files) {
          const prepared = await prepareImage(file, { maxKb: imageMaxKb, maxEdge: imageMaxEdge });
          done.push(await api.addImage({ ...prepared, projectId, folderId }));
        }
        useStore.setState({
          toast: done.length > 1 ? `${done.length} Bilder hinzugefügt` : 'Bild hinzugefügt',
          toastUndo: false,
        });
      } catch (e) {
        useStore.setState({
          toast:
            e instanceof ImageRejected
              ? e.message
              : e instanceof Error
                ? e.message
                : 'Das Bild konnte nicht hinzugefügt werden.',
          toastUndo: false,
        });
      } finally {
        setBusy(false);
      }
      return done;
    },
    [projectId, folderId],
  );

  return { upload, busy };
}

/**
 * Die Galerie zieht mit, wenn sie geladen ist – sonst fehlt das eben
 * hinzugefügte Bild dort, bis man neu lädt: der eigene Tab bekommt seinen Hall
 * aus dem Änderungs-Strom ja nicht zurück.
 *
 * Aufgerufen wird das erst, wenn auch der Text steht. Sonst sähe die Galerie
 * das Bild, hätte die Verwendung aber noch nicht gesehen und schriebe „Ohne
 * Verwendung“ darunter.
 */
export const refreshGallery = (): void => {
  if (useStore.getState().imagesLoaded) void useStore.getState().loadImages();
};

/**
 * Eine Datei von außen über einem Feld: `dragleave` kommt auch beim Wechsel auf
 * ein Kindelement, deshalb zählt hier ein Zähler statt eines Schalters. Sonst
 * flackert die Hervorhebung, sobald der Zeiger über den Text wandert.
 */
export function useFileOver(): { over: boolean; events: Record<string, (e: React.DragEvent) => void> } {
  const [depth, setDepth] = useState(0);
  return {
    over: depth > 0,
    events: {
      onDragEnter: (e) => {
        if (hasFiles(e.dataTransfer)) setDepth((n) => n + 1);
      },
      onDragLeave: (e) => {
        if (hasFiles(e.dataTransfer)) setDepth((n) => Math.max(0, n - 1));
      },
      onDropCapture: () => setDepth(0),
      onDragEnd: () => setDepth(0),
    },
  };
}

/** Enthält das Gezogene Dateien? Daran trennt sich der Weg vom Ziehen der Zeilen. */
export const hasFiles = (t: DataTransfer | null): boolean => !!t && [...t.types].includes('Files');

/**
 * Setzt den Verweis an der Cursorposition ein und schiebt den Cursor dahinter.
 * `setRangeText` lässt dabei das Rückgängig des Browsers heil.
 */
export function insertAtCursor(area: HTMLTextAreaElement, text: string): void {
  const before = area.value.slice(0, area.selectionStart);
  // Ein Bild steht für sich – also auf eine eigene, leere Zeile.
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  area.setRangeText(lead + text + '\n', area.selectionStart, area.selectionEnd, 'end');
  area.focus();
  area.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Hängt einen Verweis ans Ende eines Textes – mit Leerzeile davor. */
export const appendMarkdown = (desc: string, m: { id: string; name: string }): string =>
  (desc.trimEnd() + '\n\n' + imageMarkdown(m)).trimStart();

/**
 * Bilder aus der Galerie an eine Beschreibung hängen und speichern – der Weg
 * des Ziehens und der des Kontextmenüs enden beide hier, damit mehrere Bilder
 * in einem `patch` landen und nicht in mehreren nacheinander.
 */
export async function appendImages(
  kind: 'task' | 'milestone',
  item: { id: string; title: string; desc: string },
  list: { id: string; name: string }[],
): Promise<void> {
  if (!list.length) return;
  const store = useStore.getState();
  let desc = item.desc;
  for (const b of list) desc = appendMarkdown(desc, b);
  await store.patch(kind, item.id, { desc });
  // Erst jetzt: die Galerie soll die neue Verwendung sehen, nicht den Stand davor.
  refreshGallery();
  const wohin = `„${item.title || 'Ohne Titel'}“`;
  store.say(
    list.length === 1
      ? `„${list[0]?.name}“ zu ${wohin} hinzugefügt`
      : `${list.length} Bilder zu ${wohin} hinzugefügt`,
  );
}
