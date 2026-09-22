import type { OutlineFilter } from '@shared/outline.js';
import { archiveWorkspace, useStore, VIEWS, type View } from './store.js';

/**
 * Wo man gerade ist, steht in der Adresse:
 * `/<projekt|all>/<ansicht>[/<auswahl>][?label=…&kategorie=…&markierung=…]`.
 * So landet man nach F5 wieder beim selben Projekt, Reiter, Filter und
 * Inspektor. Jeder Ortswechsel ist ein Eintrag im Verlauf – „Zurück“ im
 * Browser geht ihn wieder zurück. Der Server liefert für jeden Pfad die App
 * aus (SPA-Fallback).
 */
type Place = { scope: string; view: View; selected: string | null; filter: OutlineFilter };

const PARAMS = { tag: 'label', categoryId: 'kategorie', markId: 'markierung' } as const;

const parse = (): Partial<Place> => {
  const [scope, view, selected] = location.pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  const q = new URLSearchParams(location.search);
  const filter = {
    tag: q.get(PARAMS.tag),
    categoryId: q.get(PARAMS.categoryId),
    markId: q.get(PARAMS.markId),
  };
  if (!scope) return {};
  return {
    scope,
    view: VIEWS.includes(view as View) ? (view as View) : 'plan',
    selected: selected ?? null,
    filter,
  };
};

const format = ({ scope, view, selected, filter }: Place): string => {
  const path = [scope, view, ...(selected ? [selected] : [])].map(encodeURIComponent).join('/');
  const q = new URLSearchParams();
  for (const key of ['tag', 'categoryId', 'markId'] as const) {
    const value = filter[key];
    if (value) q.set(PARAMS[key], value);
  }
  const search = q.toString();
  return `/${path}${search ? `?${search}` : ''}`;
};

const here = (): string => location.pathname + location.search;

export function syncUrl(): void {
  // Auswahl und Filter aus der Adresse erst prüfen, wenn der Bestand da ist –
  // im Archiv auch dessen Seite. Was es nicht (mehr) gibt, fällt weg.
  let checked = true;
  /** Solange gesetzt, schreibt eine Änderung die Adresse nur um, statt einen Schritt anzulegen. */
  let quiet = false;
  const quietly = (fn: () => void): void => {
    quiet = true;
    try {
      fn();
    } finally {
      quiet = false;
    }
  };

  const check = (): void => {
    const s = useStore.getState();
    if (checked || !s.ws || s.loading) return;
    const ws = s.view === 'archive' ? archiveWorkspace(s) : s.ws;
    if (!ws) return;
    checked = true;
    const id = s.selected;
    const { categoryId, markId } = s.filter;
    const fix: { selected?: null; filter?: OutlineFilter } = {};
    if (id && !ws.task(id) && !ws.milestone(id)) fix.selected = null;
    if (categoryId && !ws.categories.some((c) => c.id === categoryId)) {
      fix.filter = { ...s.filter, categoryId: null };
    }
    if (markId && !ws.marks.some((m) => m.id === markId)) {
      fix.filter = { ...(fix.filter ?? s.filter), markId: null };
    }
    if (Object.keys(fix).length) quietly(() => useStore.setState(fix));
  };

  let last = here();
  /** Den Ort aus der Adresse übernehmen – beim Start und bei Zurück/Vor. */
  const apply = (): void => {
    const place = parse();
    last = here();
    if (!place.scope) return;
    checked = false;
    const s = useStore.getState();
    quietly(() => useStore.setState({
      ...place,
      // Ein unbekanntes Projekt fängt `load` ab und fällt auf „Alle Projekte“ zurück.
      ...(place.scope !== 'all' ? { lastProject: place.scope } : {}),
      // Das Archiv gilt je Projekt; nach einem Wechsel neu holen.
      ...(place.scope !== s.scope ? { archive: null } : {}),
      editing: null,
      sideOpen: false,
    }));
    check();
  };

  /**
   * `replace`: kein eigener Schritt im Verlauf – für den Start und für das,
   * was die App selbst zurechtrückt (unbekanntes Projekt, verschwundene Auswahl).
   */
  const write = (replace: boolean): void => {
    const { scope, view, selected, filter } = useStore.getState();
    const url = format({ scope, view, selected, filter });
    if (url === last) return;
    last = url;
    if (replace) history.replaceState(null, '', url + location.hash);
    else history.pushState(null, '', url + location.hash);
  };

  apply();
  write(true);
  window.addEventListener('popstate', apply);
  useStore.subscribe((_, prev) => {
    check();
    write(quiet || prev.loading || !prev.ws);
  });
}
