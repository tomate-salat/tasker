/**
 * Der Inspektor als eigenes Fenster (Wunsch des Nutzers): eine Aufgabe oder
 * einen Milestone offen halten, während man im Hauptfenster weiterarbeitet.
 *
 * Das Fenster ist dieselbe App unter derselben Adresse wie die Auswahl, mit
 * `?fenster=inspektor` – sie zeigt dann nur den Inspektor. Anmeldung und
 * Änderungs-Strom hat sie wie jedes andere Fenster; was hier geändert wird,
 * sieht das Hauptfenster sofort, und umgekehrt. Aus der installierten App
 * heraus öffnet der Browser es als eigenes App-Fenster.
 */
const PARAM = 'fenster';
const VALUE = 'inspektor';

/** Läuft diese Seite als abgelöster Inspektor? */
export const DETACHED = new URLSearchParams(location.search).get(PARAM) === VALUE;

/** Hängt das Kennzeichen an eine Adresse der App, solange dieses Fenster eines ist. */
export const keepDetached = (q: URLSearchParams): void => {
  if (DETACHED) q.set(PARAM, VALUE);
};

/**
 * Öffnet `id` in einem eigenen Fenster. Je Eintrag eins: ein zweiter Klick
 * holt das schon offene nach vorn, statt ein weiteres zu öffnen.
 */
export function openDetached(projectId: string, id: string): boolean {
  const url = `/${encodeURIComponent(projectId)}/${encodeURIComponent(id)}?${PARAM}=${VALUE}`;
  const win = window.open(url, `tasker-${id}`, 'popup,width=560,height=900');
  win?.focus();
  return !!win;
}
