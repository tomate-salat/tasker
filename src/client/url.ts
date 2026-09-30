import type { OutlineFilter } from '@shared/outline.js';
import { pushEntry, replaceEntry } from './back.js';
import { ambiguousView, archiveWorkspace, homeView, useStore, VIEWS, type View } from './store.js';

/**
 * Wo man gerade ist, steht in der Adresse:
 * `/<projekt|all>/<ansicht>[?label=…&kategorie=…&markierung=…]`, mit Auswahl
 * `/<projekt|all>/<id>`. Die Ansicht ergibt sich dann aus dem Task oder
 * Milestone; nur wo er in mehreren steht (vorbereiteter Milestone: Backlog
 * und „Ready“, Milestone: Plan und Zeitplan) oder im Archiv, kommt sie dazu:
 * `/<projekt|all>/<ansicht>/<id>`. Auch dann ist sie nur ein Hinweis – was
 * sich inzwischen bewegt hat, wird beim Laden dort gesucht, wo es jetzt ist.
 *
 * So landet man nach F5 wieder beim selben Projekt, Reiter, Filter und
 * Inspektor. Jeder Ortswechsel ist ein Eintrag im Verlauf – „Zurück“ im
 * Browser geht ihn wieder zurück. Der Server liefert für jeden Pfad die App
 * aus (SPA-Fallback).
 */
type Place = { scope: string; view?: View; selected: string | null; filter: OutlineFilter };
type S = ReturnType<typeof useStore.getState>;

const PARAMS = { tag: 'label', categoryId: 'kategorie', markId: 'markierung' } as const;
const FILTER_KEYS = ['tag', 'categoryId', 'markId'] as const;

const parse = (): Place | null => {
  const [scope, second, third] = location.pathname
    .split('/')
    .filter(Boolean)
    .map(decodeURIComponent);
  if (!scope) return null;
  const q = new URLSearchParams(location.search);
  const filter = {
    tag: q.get(PARAMS.tag),
    categoryId: q.get(PARAMS.categoryId),
    markId: q.get(PARAMS.markId),
  };
  if (VIEWS.includes(second as View)) {
    return { scope, view: second as View, selected: third ?? null, filter };
  }
  return { scope, selected: second ?? null, filter };
};

/**
 * Ansichten, die ein eigener Ort sind und keine Sicht auf die Liste: Archiv,
 * Papierkorb, Galerie und Tisch. Eine Auswahl sagt dort nichts darüber, wo man ist –
 * die Ansicht muss also in der Adresse stehen und darf beim Laden nicht durch
 * den Ort der Auswahl ersetzt werden.
 */
const PLACES: View[] = ['archive', 'trash', 'bilder', 'tisch'];

/** Braucht die Adresse die Ansicht, oder ergibt sie sich aus der Auswahl? */
const needsView = (s: S): boolean => {
  const { ws, selected: id, view } = s;
  if (!id || !ws || PLACES.includes(view)) return true;
  if (!ws.task(id) && !ws.milestone(id)) return true;
  return ambiguousView(ws, id) || homeView(ws, id, null) !== view;
};

const format = (s: S): string => {
  const { scope, view, selected, filter } = s;
  const path = [scope, ...(needsView(s) ? [view] : []), ...(selected ? [selected] : [])]
    .map(encodeURIComponent)
    .join('/');
  const q = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const value = filter[key];
    if (value) q.set(PARAMS[key], value);
  }
  const search = q.toString();
  return `/${path}${search ? `?${search}` : ''}`;
};

/** Was man angesteuert hat – ohne die Frage, wie die Adresse es schreibt. */
const intent = (s: S): string =>
  [s.scope, s.view, s.selected, ...FILTER_KEYS.map((k) => s.filter[k] ?? '')].join('|');

const here = (): string => location.pathname + location.search;

export function syncUrl(): void {
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

  /**
   * Auswahl und Filter aus der Adresse erst auflösen, wenn der Bestand da ist –
   * im Archiv auch dessen Seite. Was es nicht (mehr) gibt, fällt weg; eine
   * Auswahl wird dort gezeigt, wo sie jetzt steht.
   */
  const check = (): void => {
    const s = useStore.getState();
    if (checked || !s.ws || s.loading) return;
    const archived = s.view === 'archive' ? archiveWorkspace(s) : null;
    if (s.view === 'archive' && !archived) return;
    checked = true;

    const ws = s.ws;
    const { categoryId, markId } = s.filter;
    let filter = s.filter;
    if (categoryId && !ws.categories.some((c) => c.id === categoryId)) {
      filter = { ...filter, categoryId: null };
    }
    if (markId && !ws.marks.some((m) => m.id === markId)) filter = { ...filter, markId: null };
    if (filter !== s.filter) quietly(() => useStore.setState({ filter }));

    const id = s.selected;
    if (!id) return;
    const known = archived ?? ws;
    if (!known.task(id) && !known.milestone(id)) {
      quietly(() => useStore.setState({ selected: null }));
      return;
    }
    // An einem eigenen Ort bleibt man stehen: die Auswahl steht dort im
    // Inspektor, ohne dass sie den Reiter bestimmt.
    if (archived || PLACES.includes(s.view)) return;
    // Die Ansicht aus der Adresse steht schon im Store und dient `reveal` als
    // Hinweis. Passt sie nicht (mehr), zählt sie wie keine – dann gilt „Ready“.
    if (homeView(ws, id, s.view) !== s.view) {
      quietly(() => useStore.setState({ view: homeView(ws, id, null) }));
    }
    quietly(() => useStore.getState().reveal(id));
  };

  let last = here();
  /** Den Ort aus der Adresse übernehmen – beim Start und bei Zurück/Vor. */
  const apply = (): void => {
    const place = parse();
    last = here();
    if (!place) return;
    checked = false;
    const s = useStore.getState();
    // Ohne Ansicht: mit Auswahl zählt, wo sie steht – beim vorbereiteten Milestone „Ready“.
    const view = place.view ?? (place.selected ? 'ready' : 'plan');
    quietly(() =>
      useStore.setState({
        ...place,
        view,
        // Ein unbekanntes Projekt fängt `load` ab und fällt auf „Alle Projekte“ zurück.
        ...(place.scope !== 'all' ? { lastProject: place.scope } : {}),
        // Das Archiv gilt je Projekt; nach einem Wechsel neu holen.
        ...(place.scope !== s.scope ? { archive: null } : {}),
        editing: null,
        sideOpen: false,
      }),
    );
    check();
  };

  /**
   * `replace`: kein eigener Schritt im Verlauf – für den Start und für das,
   * was die App selbst zurechtrückt (unbekanntes Projekt, verschwundene Auswahl).
   */
  const write = (replace: boolean): void => {
    const s = useStore.getState();
    // Vor dem Laden lässt sich nicht sagen, wo eine Auswahl steht – die Adresse bleibt.
    if (!s.ws) return;
    const url = format(s);
    if (url === last) return;
    last = url;
    if (replace) replaceEntry(url + location.hash);
    else pushEntry(url + location.hash);
  };

  /**
   * Schnelles Durchblättern (Pfeiltasten, rasche Klicks) ist ein Schritt:
   * folgt ein Auswahlwechsel binnen `BROWSE_MS` auf den vorigen, ersetzt er ihn.
   */
  const BROWSE_MS = 1000;
  let lastSelectAt = 0;

  apply();
  window.addEventListener('popstate', () => {
    lastSelectAt = 0;
    // Nur eine Überlagerung geschlossen (`back.ts`) – der Ort ist derselbe.
    if (here() === last) return;
    apply();
  });
  useStore.subscribe((s, prev) => {
    check();
    // Nur was man ansteuert, zählt – sonstige Änderungen am Store nicht. Hat
    // sich bloß die Schreibweise geändert (etwa weil der Task umgezogen ist),
    // wird die Adresse nur ersetzt.
    const moved = intent(s) !== intent(prev);
    let merge = false;
    if (moved) {
      // Von einer Auswahl zur nächsten – Öffnen und Schließen bleiben eigene Schritte.
      const browsing =
        !!s.selected && !!prev.selected && intent({ ...s, selected: null }) === intent({ ...prev, selected: null });
      const now = Date.now();
      merge = browsing && now - lastSelectAt < BROWSE_MS;
      lastSelectAt = browsing || (s.selected && !prev.selected) ? now : 0;
    }
    write(!moved || merge || quiet || prev.loading || !prev.ws);
  });
}
