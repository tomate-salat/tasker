import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Eine Zeichnung als PNG, für Clients, die Excalidraw nicht selbst zeichnen
 * können (das Godot-Addon).
 *
 * Gezeichnet hat die Web-App: beim Speichern legt sie das SVG neben die Szene
 * (siehe drawings.ts). Hier wird daraus nur noch ein PNG, mit resvg – der
 * Server braucht dafür weder Excalidraw noch einen Browser. Das PNG selbst wird
 * nicht gespeichert.
 */

/** Über diese Schärfe hinaus wird eine kleine Zeichnung nicht vergrößert. */
const MAX_SCALE = 2;

/**
 * So macht Excalidraw aus dem hellen Export den dunklen: ein Filter über
 * allem, und einer auf eingebetteten Bildern, der ihn dort wieder aufhebt.
 * Gespeichert ist deshalb nur die helle Fassung.
 */
const DARK_FILTER = 'invert(93%) hue-rotate(180deg)';
const DARK_IMAGE_FILTER = 'invert(100%) hue-rotate(180deg) saturate(1.25)';

const darkened = (svg: string): string =>
  svg
    .replace('<svg ', `<svg filter="${DARK_FILTER}" `)
    .replaceAll('<use href="#image-', `<use filter="${DARK_IMAGE_FILTER}" href="#image-`);

/**
 * Ein SVG, das der Server zeichnen mag. Bilder darin müssen eingebettet sein:
 * resvg läse sonst auch Dateien des Servers ein.
 */
export const drawable = (svg: string): boolean =>
  svg.startsWith('<svg ') && !/<(image|feImage)\b[^>]*\bhref\s*=\s*["'](?!data:)/i.test(svg);

/* ---------------------------------------------------------------- Schriften */

/**
 * resvg liest keine WOFF2. Excalidraws Schriften werden deshalb einmal
 * entpackt und im Temp-Ordner abgelegt – immer am selben Ort, damit sich dort
 * nichts ansammelt. Xiaolai (Chinesisch, 13 MB) bleibt draußen.
 */
const FONT_SOURCE = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
const FONT_FAMILIES = ['Excalifont', 'Virgil', 'Nunito', 'ComicShanns', 'Cascadia', 'Lilita', 'Liberation', 'Assistant'];

async function unpackFonts(): Promise<string[]> {
  const target = join(tmpdir(), 'tasker-zeichnung-schriften');
  mkdirSync(target, { recursive: true });
  const files: string[] = [];
  const { default: wawoff2 } = await import('wawoff2');
  for (const family of FONT_FAMILIES) {
    const dir = join(FONT_SOURCE, family);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.woff2')) continue;
      const out = join(target, name.replace(/\.woff2$/, '.ttf'));
      if (!existsSync(out)) writeFileSync(out, await wawoff2.decompress(readFileSync(join(dir, name))));
      files.push(out);
    }
  }
  return files;
}

/* ------------------------------------------------------------------ Zeichnen */

/** Erst beim ersten Bild geladen: wer keine Zeichnung abruft, zahlt dafür nichts. */
let ready: Promise<{ Resvg: typeof import('@resvg/resvg-js').Resvg; fontFiles: string[] }> | null = null;

export async function renderDrawing(svg: string, opts: { dark: boolean; maxEdge: number }): Promise<Uint8Array> {
  ready ??= (async () => ({
    Resvg: (await import('@resvg/resvg-js')).Resvg,
    fontFiles: await unpackFonts(),
  }))();
  const { Resvg, fontFiles } = await ready;

  const root = svg.slice(0, svg.indexOf('>'));
  const edge = (name: string): number => Number(root.match(new RegExp(`\\s${name}="([\\d.]+)"`))?.[1]);
  const longer = Math.max(edge('width'), edge('height')) || 1;

  const image = new Resvg(opts.dark ? darkened(svg) : svg, {
    fitTo: { mode: 'zoom', value: Math.min(opts.maxEdge / longer, MAX_SCALE) },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Excalifont' },
  });
  return image.render().asPng();
}
