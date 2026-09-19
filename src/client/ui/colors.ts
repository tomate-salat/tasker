/**
 * Farbtöne, genau wie im Prototyp abgeleitet: Kategorien bekommen ihren Ton
 * über die Position im Projekt, Labels über den Namen. Beides wird nirgends
 * gespeichert – gleicher Name, gleiche Farbe, ohne Farbverwaltung.
 */
export const CAT_HUES = [150, 280, 30, 205, 340, 55, 180, 0, 240, 95, 310, 120];

export const categoryHue = (indexInProject: number): number =>
  CAT_HUES[indexInProject % CAT_HUES.length] as number;

export function tagHue(tag: string): number {
  let h = 0;
  for (const c of tag) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
