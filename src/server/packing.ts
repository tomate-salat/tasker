import { brotliCompressSync, brotliDecompressSync, constants } from 'node:zlib';

/**
 * Zeichnungen liegen gepackt in der Datenbank (Wunsch des Nutzers, um Platz zu
 * sparen): Szene und SVG sind Text, der sich auf ein Viertel bis ein Fünftel
 * packen lässt – verlustfrei, beim Lesen kommt Zeichen für Zeichen dasselbe
 * heraus.
 *
 * Der gepackte Wert bleibt Text (Base64 hinter einem Kennzeichen), damit
 * Papierkorb, Umwandeln und Wiederherstellen die Zeilen weiter unverändert
 * als JSON weiterreichen können. Ungepackte Werte – eine Szene beginnt mit
 * `{` oder `[`, ein SVG mit `<` – werden so gelesen, wie sie sind.
 *
 * Stufe 5 statt der höchsten: kaum größer, aber 2 statt 150 Millisekunden
 * für eine große Zeichnung.
 */

const MARK = 'br:';
const QUALITY = 5;

export const isPacked = (stored: string): boolean => stored.startsWith(MARK);

export function pack(text: string): string {
  if (isPacked(text)) return text;
  const raw = Buffer.from(text, 'utf8');
  const packed = brotliCompressSync(raw, {
    params: { [constants.BROTLI_PARAM_QUALITY]: QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length },
  });
  const stored = MARK + packed.toString('base64');
  // Eine leere Szene wird gepackt nur größer – dann bleibt sie, wie sie ist.
  return stored.length < text.length ? stored : text;
}

export function unpack(stored: string): string {
  if (!isPacked(stored)) return stored;
  return brotliDecompressSync(Buffer.from(stored.slice(MARK.length), 'base64')).toString('utf8');
}
