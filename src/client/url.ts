import { archiveWorkspace, useStore, VIEWS, type View } from './store.js';

/**
 * Wo man gerade ist, steht in der Adresse: `/<projekt|all>/<ansicht>[/<auswahl>]`.
 * So landet man nach F5 wieder beim selben Projekt, Reiter und Inspektor.
 * Der Server liefert für jeden Pfad die App aus (SPA-Fallback).
 */
type Place = { scope: string; view: View; selected: string | null };

const parse = (path: string): Partial<Place> => {
  const [scope, view, selected] = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (!scope) return {};
  return {
    scope,
    ...(VIEWS.includes(view as View) ? { view: view as View } : {}),
    ...(selected ? { selected } : {}),
  };
};

const format = ({ scope, view, selected }: Place): string =>
  '/' + [scope, view, ...(selected ? [selected] : [])].map(encodeURIComponent).join('/');

export function syncUrl(): void {
  const fromUrl = parse(location.pathname);
  // Ein unbekanntes Projekt fängt `load` ab und fällt auf „Alle Projekte“ zurück.
  useStore.setState(fromUrl);

  // Die Auswahl aus der Adresse erst prüfen, wenn der Bestand da ist – im
  // Archiv auch dessen Seite. Was es nicht (mehr) gibt, fällt aus der Auswahl.
  let checked = !fromUrl.selected;
  const check = (): void => {
    const s = useStore.getState();
    if (checked || !s.ws || s.loading) return;
    const ws = s.view === 'archive' ? archiveWorkspace(s) : s.ws;
    if (!ws) return;
    checked = true;
    const id = s.selected;
    if (id && !ws.task(id) && !ws.milestone(id)) useStore.setState({ selected: null });
  };

  let last = location.pathname;
  const write = (): void => {
    const { scope, view, selected } = useStore.getState();
    const path = format({ scope, view, selected });
    if (path === last) return;
    last = path;
    history.replaceState(null, '', path + location.search + location.hash);
  };

  write();
  useStore.subscribe(() => {
    check();
    write();
  });
}
