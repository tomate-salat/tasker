/**
 * Zeichnet eine Zeichnung als PNG – in einem eigenen Prozess, siehe
 * drawingImage.ts. Gebaut wird diese Datei für sich (`npm run build:worker`),
 * mit Excalidraw im Bündel: Node kann das Paket nicht selbst laden.
 *
 * Excalidraw ist für den Browser geschrieben. Hier bekommt es mit jsdom ein
 * Dokument vorgesetzt und statt der Zeichenfläche eine Attrappe – für den
 * SVG-Export reicht das, gemessen oder gemalt wird dabei nichts. Aus dem SVG
 * macht resvg das PNG.
 *
 * Das alles hängt an Excalidraws Innenleben und braucht rund 200 MB. Deshalb
 * der eigene Prozess: die Browser-Globalen bleiben hier, der Server lebt
 * weiter, wenn es klemmt, und mit dem Prozess geht auch sein Speicher wieder.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { JSDOM } from 'jsdom';
import wawoff2 from 'wawoff2';

export type RenderRequest = {
  id: number;
  elements: unknown[];
  files: Record<string, unknown> | null;
  dark: boolean;
  /** Obergrenze für die längere Kante in Pixeln. */
  maxEdge: number;
};

export type RenderReply = { id: number; png: Uint8Array } | { id: number; error: string };

/** Über diese Schärfe hinaus wird eine kleine Zeichnung nicht vergrößert. */
const MAX_SCALE = 2;

/* ---------------------------------------------------------------- Browser */

function fakeBrowser(): void {
  const { window: w } = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });
  const g = globalThis as Record<string, unknown>;
  const win = w as unknown as Record<string, unknown>;

  for (const k of Object.getOwnPropertyNames(w)) {
    if (k in globalThis) continue;
    try {
      Object.defineProperty(globalThis, k, { value: win[k], configurable: true, writable: true });
    } catch {
      // Was sich nicht setzen lässt, hat Node schon selbst.
    }
  }
  for (const k of ['window', 'self', 'top', 'parent']) g[k] = w;
  for (const k of ['navigator', 'document']) {
    Object.defineProperty(globalThis, k, { value: win[k], configurable: true });
  }

  const noMedia = () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  });
  win['matchMedia'] ??= noMedia;
  g['matchMedia'] = win['matchMedia'];

  // Schriften meldet Excalidraw beim Dokument an. Hier gibt es nichts
  // anzumelden – die Schriften bekommt resvg weiter unten als Dateien.
  class FontFace {
    status = 'loaded';
    constructor(
      readonly family: string,
      readonly source: unknown,
      descriptors?: Record<string, unknown>,
    ) {
      Object.assign(this, descriptors);
    }
    load() {
      return Promise.resolve(this);
    }
  }
  g['FontFace'] = win['FontFace'] ??= FontFace;
  if (!('fonts' in w.document)) {
    Object.defineProperty(w.document, 'fonts', {
      value: {
        ready: Promise.resolve(),
        add() {},
        has: () => true,
        check: () => true,
        load: () => Promise.resolve([]),
        forEach() {},
        addEventListener() {},
        removeEventListener() {},
        *[Symbol.iterator]() {},
      },
    });
  }

  // Excalidraw fragt beim Laden nach der Zeichenfläche. Gebraucht wird sie für
  // den SVG-Export nicht – jede Methode tut nichts.
  const context = () =>
    new Proxy({ filter: 'none', font: '' } as Record<string | symbol, unknown>, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return (text: string) => ({ width: String(text).length * 10 });
        if (key === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    });
  w.HTMLCanvasElement.prototype.getContext = context as never;
}

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

type ExportToSvg = (opts: Record<string, unknown>) => Promise<SVGSVGElement>;

/** Einmal je Prozess: das Laden von Excalidraw ist der teure Teil. */
const ready: Promise<{ exportToSvg: ExportToSvg; fontFiles: string[] }> = (async () => {
  fakeBrowser();
  // Erst jetzt – beim Laden greift Excalidraw schon auf `window` zu.
  const { exportToSvg } = await import('@excalidraw/excalidraw');
  return { exportToSvg: exportToSvg as unknown as ExportToSvg, fontFiles: await unpackFonts() };
})();

async function render(req: RenderRequest): Promise<Uint8Array> {
  const { exportToSvg, fontFiles } = await ready;
  // Wie die Vorschau in der App (Drawings.tsx), nur ohne eingebettete
  // Schriften: die holte Excalidraw aus dem Netz, und resvg hat sie als Datei.
  const svg = await exportToSvg({
    elements: req.elements,
    appState: { exportBackground: false, exportWithDarkMode: req.dark },
    files: req.files,
    skipInliningFonts: true,
  });
  const longer = Math.max(Number(svg.getAttribute('width')), Number(svg.getAttribute('height'))) || 1;
  const image = new Resvg(svg.outerHTML, {
    fitTo: { mode: 'zoom', value: Math.min(req.maxEdge / longer, MAX_SCALE) },
    font: { fontFiles, loadSystemFonts: false, defaultFontFamily: 'Excalifont' },
  });
  return image.render().asPng();
}

const reply = (r: RenderReply): void => void process.send?.(r);

process.on('message', (req: RenderRequest) => {
  void render(req).then(
    (png) => reply({ id: req.id, png }),
    (e: unknown) => reply({ id: req.id, error: e instanceof Error ? e.message : String(e) }),
  );
});
