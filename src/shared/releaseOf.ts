/**
 * Zu welchem Release ein Milestone zählt (Wunsch des Nutzers): zu dem, dem er
 * zugeordnet ist – und sonst zu dem, das ihn über Abhängigkeiten braucht.
 * Benötigt ein Milestone des Releases einen anderen, gehört der mit dazu, und
 * ebenso alles, was der wiederum benötigt.
 *
 * Bewusst ohne `Workspace`: der Server rechnet damit auch über Archiviertes.
 */
export type ReleaseMember = {
  id: string;
  projectId: string;
  /** Die ausdrückliche Zuordnung – sie geht immer vor. */
  releaseId: string | null;
  /** Milestones, die dieser benötigt. */
  deps: string[];
};

/**
 * Je Milestone das Release, zu dem er zählt. Wer in keinem steht, fehlt.
 *
 * - Die ausdrückliche Zuordnung gilt immer; an ihr endet auch die Kette – was
 *   ein so zugeordneter Milestone benötigt, zählt zu *seinem* Release.
 * - Wird ein Milestone von mehreren Releases gebraucht, zählt er zum frühesten
 *   (nach der Reihenfolge der Releases): dort muss er fertig sein.
 * - Über die Projektgrenze zählt nichts mit.
 */
export function effectiveReleases(
  milestones: ReleaseMember[],
  releases: { id: string; projectId: string; order: number }[],
): Map<string, string> {
  const byId = new Map(milestones.map((m) => [m.id, m]));
  const out = new Map<string, string>();
  for (const m of milestones) if (m.releaseId) out.set(m.id, m.releaseId);

  for (const r of [...releases].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))) {
    const queue = milestones.filter((m) => m.releaseId === r.id);
    while (queue.length) {
      const m = queue.pop() as ReleaseMember;
      for (const id of m.deps) {
        const dep = byId.get(id);
        if (!dep || dep.projectId !== r.projectId || out.has(id)) continue;
        out.set(id, r.id);
        queue.push(dep);
      }
    }
  }
  return out;
}
