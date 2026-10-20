import { api, type DrawingMeta, type Scene } from '../api.js';

/**
 * Das Bild einer Zeichnung für Clients ohne Excalidraw (das Godot-Addon). Der
 * Server kann es nicht selbst zeichnen, deshalb schickt die Web-App es mit:
 * beim Speichern im Editor und – hier – nach, wo es fehlt. Beim Archivieren
 * fällt es weg (Platz sparen); wer den Eintrag zurückholt oder öffnet, lässt
 * es im Hintergrund neu entstehen.
 */

/**
 * Die Szene als SVG, hell und ohne eingebettete Schriften: die dunkle Fassung
 * und die Schriften bringt der Server selbst mit. Eine leere Zeichnung hat
 * keins, und scheitert das Zeichnen, gibt es eben keins.
 */
export async function imageOf(scene: Scene): Promise<string | undefined> {
  const elements = scene.elements.filter((e) => !(e as { isDeleted?: boolean }).isDeleted);
  if (!elements.length) return undefined;
  try {
    const { exportToSvg } = await import('./excalidraw-lazy.js');
    const svg = await exportToSvg({
      elements: elements as never,
      appState: { exportBackground: false, exportWithDarkMode: false } as never,
      files: (scene.files ?? null) as never,
      skipInliningFonts: true,
    });
    return svg.outerHTML;
  } catch {
    return undefined;
  }
}

/** Schon versucht in dieser Sitzung – eine leere Zeichnung etwa bleibt ohne Bild. */
const tried = new Set<string>();

/**
 * Zeichnet die fehlenden Bilder nach, eine Zeichnung nach der anderen. Was
 * dabei scheitert, bleibt ohne Bild, bis zum nächsten Öffnen nach einem
 * Neuladen – das Addon bekommt so lange keins.
 */
export async function fillPreviews(metas: DrawingMeta[]): Promise<void> {
  const missing = metas.filter((m) => !m.preview && !tried.has(m.id));
  if (!missing.length) return;
  for (const m of missing) tried.add(m.id);

  const owners = new Map<string, { kind: 'task' | 'milestone'; id: string }>();
  for (const m of missing) {
    const owner = m.taskId ? { kind: 'task' as const, id: m.taskId } : { kind: 'milestone' as const, id: m.milestoneId! };
    owners.set(`${owner.kind}:${owner.id}`, owner);
  }
  const wanted = new Set(missing.map((m) => m.id));

  for (const owner of owners.values()) {
    try {
      const { drawings } = await api.drawings(owner);
      for (const d of drawings) {
        if (!wanted.has(d.id) || d.preview) continue;
        const svg = await imageOf(d.scene);
        if (svg) await api.saveDrawing(d.id, d.version, { svg });
      }
    } catch {
      // Geändert oder gelöscht, während wir zeichneten – dann gilt der neue Stand.
    }
  }
}
