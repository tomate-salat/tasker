/**
 * Ein Bild aus der Zwischenablage oder vom Ziehen wird hier fertig gemacht,
 * bevor es zum Server geht: verkleinert, nach WebP umgewandelt und unter eine
 * Obergrenze gebracht.
 *
 * Die Zielgröße lässt sich nicht ausrechnen – ein Foto und ein Screenshot
 * gleicher Kantenlänge unterscheiden sich um ein Vielfaches. Also wird sie
 * gemessen: kodieren, nachsehen, nachjustieren. Erst über die Qualität, und
 * erst wenn die am Boden ist, über die Kantenlänge. Diese Reihenfolge ist
 * Absicht – ein etwas stärker komprimiertes Bild in voller Größe sieht fast
 * immer besser aus als ein scharf komprimiertes, das zusätzlich geschrumpft
 * wurde.
 */

export type Prepared = {
  blob: Blob;
  thumb: Blob;
  width: number;
  height: number;
  name: string;
};

export type Limits = { maxKb: number; maxEdge: number };

/** Lange Seite des Vorschaubildes – das ist, was die Galerie zeigt. */
const THUMB_EDGE = 400;
const THUMB_QUALITY = 0.7;

const Q_HIGH = 0.92;
const Q_LOW = 0.5;
/** Mehr Durchläufe bringen nichts mehr – der Unterschied liegt dann im Promillebereich. */
const STEPS = 6;
/** So oft darf zusätzlich die Kantenlänge fallen, bevor aufgegeben wird. */
const SHRINKS = 3;

export class ImageRejected extends Error {}

/**
 * Animierte GIFs kommen nicht durch: der Canvas sieht nur das erste Einzelbild,
 * und ein stillschweigend eingefrorenes GIF wäre schlimmer als eine Absage.
 * SVG ist aktiver Inhalt und hat in der Ablage nichts zu suchen.
 */
const REJECTED: Record<string, string> = {
  'image/gif': 'GIFs werden nicht angenommen – die Bewegung ginge dabei verloren.',
  'image/svg+xml': 'SVG wird nicht angenommen.',
};

export function checkType(file: File): void {
  const reason = REJECTED[file.type];
  if (reason) throw new ImageRejected(reason);
  if (!file.type.startsWith('image/')) throw new ImageRejected('Das ist kein Bild.');
}

/** Alle Bilder aus einer Ablage oder einem Einfügen – Reihenfolge bleibt. */
export const imagesIn = (list: FileList | File[] | null | undefined): File[] =>
  [...(list ?? [])].filter((f) => f.type.startsWith('image/'));

export async function prepareImage(file: File, limits: Limits): Promise<Prepared> {
  checkType(file);
  const bitmap = await createImageBitmap(file);
  try {
    const limit = limits.maxKb * 1024;
    let scale = Math.min(1, limits.maxEdge / Math.max(bitmap.width, bitmap.height));

    // Ein kleines WebP, das schon passt, wird nicht angefasst – jede weitere
    // Generation kostet nur Qualität.
    if (file.type === 'image/webp' && scale === 1 && file.size <= limit) {
      return {
        blob: file,
        thumb: await encode(bitmap, Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height)), THUMB_QUALITY),
        width: bitmap.width,
        height: bitmap.height,
        name: file.name || 'Bild',
      };
    }

    for (let shrink = 0; ; shrink++) {
      const found = await fit(bitmap, scale, limit);
      if (found || shrink >= SHRINKS) {
        const blob = found ?? (await encode(bitmap, scale, Q_LOW));
        return {
          blob,
          thumb: await encode(
            bitmap,
            Math.min(1, THUMB_EDGE / Math.max(bitmap.width, bitmap.height)),
            THUMB_QUALITY,
          ),
          width: Math.round(bitmap.width * scale),
          height: Math.round(bitmap.height * scale),
          name: file.name || 'Bild',
        };
      }
      scale *= 0.75;
    }
  } finally {
    bitmap.close();
  }
}

/**
 * Sucht die beste Qualität, die noch unter die Grenze passt, per
 * Intervallhalbierung. Gibt `null` zurück, wenn selbst die niedrigste Stufe zu
 * groß bleibt – dann hilft nur noch Verkleinern.
 */
async function fit(bitmap: ImageBitmap, scale: number, limit: number): Promise<Blob | null> {
  let best = await encode(bitmap, scale, Q_HIGH);
  if (best.size <= limit) return best;

  const floor = await encode(bitmap, scale, Q_LOW);
  if (floor.size > limit) return null;
  best = floor;

  let lo = Q_LOW;
  let hi = Q_HIGH;
  for (let i = 0; i < STEPS; i++) {
    const mid = (lo + hi) / 2;
    const blob = await encode(bitmap, scale, mid);
    if (blob.size <= limit) {
      best = blob;
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return best;
}

/** Zeichnet das Bild in der gewünschten Größe und kodiert es als WebP. */
async function encode(bitmap: ImageBitmap, scale: number, quality: number): Promise<Blob> {
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d');
  if (!g) throw new ImageRejected('Der Browser kann das Bild nicht verarbeiten.');
  g.drawImage(bitmap, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality),
  );
  if (!blob) throw new ImageRejected('Der Browser kann kein WebP erzeugen.');
  return blob;
}

/** „1,2 MB“ – für Galerie und Meldungen. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1000) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1).replace('.', ',')} MB`;
}
