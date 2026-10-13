/**
 * Verweise von außen in die installierte App: `web+tasker://<projekt>/<id>`
 * (angemeldet im Manifest unter `protocol_handlers`). So öffnet etwa das
 * Godot-Addon eine Aufgabe oder einen Milestone in der App statt in einem
 * Browserfenster.
 *
 * Die beiden Teile sind dieselben wie in der Adresse `/<projekt>/<id>`. Was
 * nicht genau so aussieht, führt nirgends hin – ein Verweis von außen darf nur
 * einen Ort in der App benennen, nichts sonst.
 */
export const DEEPLINK_SCHEME = 'web+tasker';

/** So sehen Kennungen aus (`newId`, ältere wie `t1`) – und `all` für alle Projekte. */
const PART = /^[\w-]{1,64}$/;

/** Der Pfad in der App zu einem Verweis – `null`, wenn er keiner ist. */
export function deepLinkPath(link: string): string | null {
  const found = link.match(/^web\+tasker:(?:\/\/)?([^/?#]+)\/([^/?#]+)\/?$/i);
  if (!found) return null;
  try {
    const parts = [found[1], found[2]].map((p) => decodeURIComponent(p as string));
    return parts.every((p) => PART.test(p)) ? `/${parts.join('/')}` : null;
  } catch {
    return null;
  }
}
