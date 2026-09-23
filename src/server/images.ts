import { createHash } from 'node:crypto';
import type { DbCtx } from './db.js';

/**
 * Bilder liegen als BLOB in der Datenbank – wie die Zeichnungen, und aus
 * demselben Grund: so hängen sie an Papierkorb und Rückgängig, statt daneben
 * ein zweites Leben als Dateien zu führen, das auseinanderlaufen kann.
 *
 * Der Schlüssel ist der Hash des Inhalts. Dasselbe Bild zweimal eingefügt legt
 * also nur eine Zeile an, und die Auslieferung darf `immutable` setzen.
 *
 * Wer ein Bild verwendet, wird nicht mitgeschrieben, sondern nachgesehen
 * (siehe `usage`). Eine mitgeführte Tabelle müsste bei Rückgängig, Papierkorb,
 * Umwandeln und Import korrekt mitlaufen – und eine Galerie, die „nicht mehr
 * verlinkt“ fälschlich behauptet, löscht Bilder, die noch gebraucht werden.
 */

export type ImageMeta = {
  id: string;
  projectId: string | null;
  folderId: string | null;
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  createdAt: string;
  deletedAt: string | null;
};

type Row = {
  id: string;
  project_id: string | null;
  folder_id: string | null;
  name: string;
  mime: string;
  width: number;
  height: number;
  size: number;
  created_at: string;
  deleted_at: string | null;
};

const META_COLUMNS =
  'id, project_id, folder_id, name, mime, width, height, size, created_at, deleted_at';

const toMeta = (r: Row): ImageMeta => ({
  id: r.id,
  projectId: r.project_id,
  folderId: r.folder_id,
  name: r.name,
  mime: r.mime,
  width: r.width,
  height: r.height,
  size: r.size,
  createdAt: r.created_at,
  deletedAt: r.deleted_at,
});

/** Der Schlüssel eines Bildes: so viel Hash, dass Zufallstreffer ausgeschlossen sind. */
export const hashOf = (bytes: Buffer): string =>
  'b' + createHash('sha256').update(bytes).digest('base64url').slice(0, 24);

export type NewImage = {
  projectId: string | null;
  /** Der Ordner, in dem die Galerie gerade steht – sonst ganz oben. */
  folderId?: string | null;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: Buffer;
  thumb: Buffer;
};

/**
 * Legt ein Bild an – oder gibt das vorhandene zurück, wenn derselbe Inhalt
 * schon da ist. Lag es im Papierkorb, kommt es dabei zurück: der Nutzer fügt es
 * ja gerade wieder ein.
 */
export function putImage(ctx: DbCtx, input: NewImage): ImageMeta {
  const id = hashOf(input.bytes);
  return ctx.sqlite.transaction(() => {
    const found = ctx.sqlite.prepare(`SELECT ${META_COLUMNS} FROM image WHERE id = ?`).get(id) as
      | Row
      | undefined;
    if (found) {
      if (found.deleted_at) {
        ctx.sqlite.prepare('UPDATE image SET deleted_at = NULL WHERE id = ?').run(id);
        ctx.sqlite.prepare("DELETE FROM trash WHERE kind = 'image' AND payload LIKE ?").run(`%"${id}"%`);
        return { ...toMeta(found), deletedAt: null };
      }
      return toMeta(found);
    }

    ctx.sqlite
      .prepare(
        `INSERT INTO image (id, project_id, folder_id, name, mime, width, height, size, bytes, thumb)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.projectId,
        input.folderId ?? null,
        input.name,
        input.mime,
        input.width,
        input.height,
        input.bytes.length,
        input.bytes,
        input.thumb,
      );
    // Durch `toMeta`, wie der Fall oben: sonst ginge die rohe Zeile mit ihren
    // Spaltennamen (`project_id`, `folder_id` …) an den Browser.
    return toMeta(ctx.sqlite.prepare(`SELECT ${META_COLUMNS} FROM image WHERE id = ?`).get(id) as Row);
  })() as ImageMeta;
}

/** Die Bytes zum Ausliefern – `klein` ist die Vorschau. */
export function imageBytes(
  ctx: DbCtx,
  id: string,
  size: 'gross' | 'klein',
): { bytes: Buffer; mime: string } | null {
  const row = ctx.sqlite
    .prepare(`SELECT ${size === 'klein' ? 'thumb' : 'bytes'} AS b, mime FROM image WHERE id = ?`)
    .get(id) as { b: Buffer; mime: string } | undefined;
  return row ? { bytes: row.b, mime: row.mime } : null;
}

export const listImages = (ctx: DbCtx): ImageMeta[] =>
  (
    ctx.sqlite
      .prepare(`SELECT ${META_COLUMNS} FROM image ORDER BY created_at DESC`)
      .all() as Row[]
  ).map(toMeta);

export const getImage = (ctx: DbCtx, id: string): ImageMeta | null => {
  const row = ctx.sqlite.prepare(`SELECT ${META_COLUMNS} FROM image WHERE id = ?`).get(id) as
    | Row
    | undefined;
  return row ? toMeta(row) : null;
};

/* ----------------------------------------------------------------- Ordner */

/**
 * Ordner sind eine reine Ablage: sie gehören einem Projekt, dürfen ineinander
 * liegen, und ein Bild liegt in genau einem oder in keinem. Verwendungen und
 * Filter kümmern sich nicht um sie – ein Bild bleibt auffindbar, egal wo es
 * abgelegt ist.
 */
export type FolderMeta = {
  id: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  createdAt: string;
};

type FolderRow = {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  name: string;
  created_at: string;
};

const toFolder = (r: FolderRow): FolderMeta => ({
  id: r.id,
  projectId: r.project_id,
  parentId: r.parent_id,
  name: r.name,
  createdAt: r.created_at,
});

const FOLDER_COLUMNS = 'id, project_id, parent_id, name, created_at';

export const listFolders = (ctx: DbCtx): FolderMeta[] =>
  (
    ctx.sqlite.prepare(`SELECT ${FOLDER_COLUMNS} FROM image_folder ORDER BY name`).all() as FolderRow[]
  ).map(toFolder);

export const getFolder = (ctx: DbCtx, id: string): FolderMeta | null => {
  const row = ctx.sqlite.prepare(`SELECT ${FOLDER_COLUMNS} FROM image_folder WHERE id = ?`).get(id) as
    | FolderRow
    | undefined;
  return row ? toFolder(row) : null;
};

export function addFolder(
  ctx: DbCtx,
  input: { id: string; projectId: string | null; parentId: string | null; name: string },
): FolderMeta {
  ctx.sqlite
    .prepare('INSERT INTO image_folder (id, project_id, parent_id, name) VALUES (?, ?, ?, ?)')
    .run(input.id, input.projectId, input.parentId, input.name);
  return getFolder(ctx, input.id) as FolderMeta;
}

/** Die IDs eines Ordners samt allem, was darin liegt – für Umhängen und Löschen. */
export function folderTree(ctx: DbCtx, id: string): string[] {
  const kids = ctx.sqlite.prepare('SELECT id FROM image_folder WHERE parent_id = ?');
  const out: string[] = [];
  const walk = (at: string): void => {
    out.push(at);
    for (const r of kids.all(at) as { id: string }[]) walk(r.id);
  };
  walk(id);
  return out;
}

export function renameFolder(ctx: DbCtx, id: string, name: string): FolderMeta | null {
  const res = ctx.sqlite
    .prepare('UPDATE image_folder SET name = ?, updated_at = ?, version = version + 1 WHERE id = ?')
    .run(name, new Date().toISOString(), id);
  return res.changes ? getFolder(ctx, id) : null;
}

/**
 * Umhängen. Ein Ordner darf nicht in sich selbst wandern – sonst hinge der
 * ganze Ast danach nirgends mehr und wäre in der Galerie nicht mehr erreichbar.
 */
export function moveFolder(ctx: DbCtx, id: string, parentId: string | null): FolderMeta | null {
  return ctx.sqlite.transaction(() => {
    const self = getFolder(ctx, id);
    if (!self) return null;
    const tree = folderTree(ctx, id);
    if (parentId && tree.includes(parentId)) return null;
    const parent = parentId ? getFolder(ctx, parentId) : null;
    if (parentId && !parent) return null;

    const at = new Date().toISOString();
    ctx.sqlite
      .prepare('UPDATE image_folder SET parent_id = ?, updated_at = ?, version = version + 1 WHERE id = ?')
      .run(parentId, at, id);

    // Das Projekt des neuen Platzes gilt für den ganzen Ast, nicht nur für den
    // obersten Ordner – sonst lägen darin Bilder eines anderen Projekts.
    const project = parent ? parent.projectId : self.projectId;
    if (parent && project !== self.projectId) {
      const list = tree.map(() => '?').join(', ');
      ctx.sqlite.prepare(`UPDATE image_folder SET project_id = ? WHERE id IN (${list})`).run(project, ...tree);
      ctx.sqlite.prepare(`UPDATE image SET project_id = ? WHERE folder_id IN (${list})`).run(project, ...tree);
    }
    return getFolder(ctx, id);
  })() as FolderMeta | null;
}

/**
 * Ein Ordner ist nur eine Hülle. Standardmäßig wirft das Löschen deshalb nichts
 * weg, sondern hebt seinen Inhalt eine Ebene höher.
 *
 * Auf Wunsch geht der Inhalt mit: die Bilder des ganzen Astes wandern dann in
 * den Papierkorb – nicht endgültig, sie lassen sich von dort einzeln
 * zurückholen – und die Unterordner fallen als leere Hüllen weg.
 */
export function deleteFolder(
  ctx: DbCtx,
  id: string,
  o: { withContents?: boolean; trashId?: () => string } = {},
): { images: number } | null {
  return ctx.sqlite.transaction(() => {
    const folder = getFolder(ctx, id);
    if (!folder) return null;

    if (!o.withContents) {
      ctx.sqlite.prepare('UPDATE image SET folder_id = ? WHERE folder_id = ?').run(folder.parentId, id);
      ctx.sqlite
        .prepare('UPDATE image_folder SET parent_id = ? WHERE parent_id = ?')
        .run(folder.parentId, id);
      ctx.sqlite.prepare('DELETE FROM image_folder WHERE id = ?').run(id);
      return { images: 0 };
    }

    const tree = folderTree(ctx, id);
    const list = tree.map(() => '?').join(', ');
    const drin = ctx.sqlite
      .prepare(`SELECT id FROM image WHERE deleted_at IS NULL AND folder_id IN (${list})`)
      .all(...tree) as { id: string }[];
    for (const b of drin) trashImage(ctx, b.id, o.trashId ? o.trashId() : `x${b.id}`);
    ctx.sqlite.prepare(`DELETE FROM image_folder WHERE id IN (${list})`).run(...tree);
    return { images: drin.length };
  })() as { images: number } | null;
}

/**
 * Bilder in einen Ordner legen. Sie nehmen dabei dessen Projekt an: unter „Alle
 * Projekte“ liegen die Ordner mehrerer Projekte nebeneinander, und ein Bild,
 * das in einem fremden Ordner läge, wäre im eigenen Projekt nicht mehr zu sehen.
 */
export function moveImages(ctx: DbCtx, ids: string[], folderId: string | null): number {
  const folder = folderId ? getFolder(ctx, folderId) : null;
  if (folderId && !folder) return 0;
  const at = new Date().toISOString();
  return ctx.sqlite.transaction(() => {
    let n = 0;
    for (const id of ids) {
      const res = ctx.sqlite
        .prepare(
          folder
            ? 'UPDATE image SET folder_id = ?, project_id = ?, updated_at = ? WHERE id = ?'
            : 'UPDATE image SET folder_id = ?, updated_at = ? WHERE id = ?',
        )
        .run(...(folder ? [folderId, folder.projectId, at, id] : [null, at, id]));
      n += res.changes;
    }
    return n;
  })() as number;
}

/* ------------------------------------------------------------ Verwendungen */

/**
 * Im Text steht ein Bild als gewöhnliches Markdown: `![Name](/api/bilder/<id>)`.
 * Das rendert `marked` ohne Zutun und bleibt auch in einem Export lesbar.
 */
const REF = /\/api\/bilder\/(b[A-Za-z0-9_-]+)/g;

export const imageRefs = (text: string | null | undefined): string[] =>
  [...(text ?? '').matchAll(REF)].map((m) => m[1] as string);

/** Wo ein Bild überall steckt – und in welchem Zustand das Umgebende ist. */
export type Usage = {
  /** Lebende, nicht archivierte Aufgaben und Milestones. */
  live: { kind: 'task' | 'milestone'; id: string; title: string }[];
  /** Dasselbe für Archiviertes. */
  archived: { kind: 'task' | 'milestone'; id: string; title: string }[];
  /** Und für das, was nur noch im Papierkorb liegt. */
  trashed: { kind: 'task' | 'milestone'; id: string; title: string }[];
};

const empty = (): Usage => ({ live: [], archived: [], trashed: [] });

type DescRow = { id: string; title: string; desc: string; archived_at: string | null };

/**
 * Sucht alle Verwendungen in einem Durchgang. Beschreibungen gibt es nur an
 * zwei Stellen, dazu die Nutzlasten im Papierkorb – dort stecken die Texte
 * gelöschter Aufgaben als JSON.
 */
export function usage(ctx: DbCtx): Map<string, Usage> {
  const out = new Map<string, Usage>();
  const add = (
    imageId: string,
    where: keyof Usage,
    entry: { kind: 'task' | 'milestone'; id: string; title: string },
  ): void => {
    const u = out.get(imageId) ?? empty();
    if (!u[where].some((e) => e.id === entry.id)) u[where].push(entry);
    out.set(imageId, u);
  };

  for (const kind of ['task', 'milestone'] as const) {
    const rows = ctx.sqlite
      .prepare(`SELECT id, title, desc, archived_at FROM ${kind} WHERE desc <> ''`)
      .all() as DescRow[];
    for (const r of rows) {
      const where = r.archived_at ? 'archived' : 'live';
      for (const imageId of imageRefs(r.desc)) add(imageId, where, { kind, id: r.id, title: r.title });
    }
  }

  // Der Papierkorb: die gelöschten Zeilen liegen als JSON im Eintrag.
  const entries = ctx.sqlite
    .prepare("SELECT payload FROM trash WHERE kind != 'image'")
    .all() as { payload: string }[];
  for (const e of entries) {
    let p: {
      tasks?: DescRow[];
      milestones?: DescRow[];
      row?: DescRow;
      kind?: 'task' | 'milestone' | string;
    };
    try {
      p = JSON.parse(e.payload);
    } catch {
      continue;
    }
    const rows: { kind: 'task' | 'milestone'; row: DescRow }[] = [
      ...(p.tasks ?? []).map((row) => ({ kind: 'task' as const, row })),
      ...(p.milestones ?? []).map((row) => ({ kind: 'milestone' as const, row })),
      ...(p.row && (p.kind === 'task' || p.kind === 'milestone')
        ? [{ kind: p.kind as 'task' | 'milestone', row: p.row }]
        : []),
    ];
    for (const { kind, row } of rows) {
      for (const imageId of imageRefs(row?.desc)) {
        add(imageId, 'trashed', { kind, id: row.id, title: row.title });
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------- Papierkorb */

/**
 * Gelöscht heißt: die Bytes bleiben liegen, im Papierkorb entsteht ein Eintrag.
 * Der trägt nur die Angaben zum Bild, nicht das Bild selbst – als Base64 wäre
 * es ein Drittel größer, über `JSON.stringify` eines Buffers ein Vielfaches.
 */
export function trashImage(ctx: DbCtx, id: string, trashId: string): ImageMeta | null {
  return ctx.sqlite.transaction(() => {
    const meta = getImage(ctx, id);
    if (!meta || meta.deletedAt) return null;
    const at = new Date().toISOString();
    ctx.sqlite.prepare('UPDATE image SET deleted_at = ? WHERE id = ?').run(at, id);
    ctx.sqlite
      .prepare(
        `INSERT INTO trash (id, kind, title, project_id, payload, deleted_at)
         VALUES (?, 'image', ?, ?, ?, ?)`,
      )
      .run(trashId, meta.name, meta.projectId, JSON.stringify({ kind: 'image', row: { id } }), at);
    return { ...meta, deletedAt: at };
  })() as ImageMeta | null;
}

/** Aus dem Papierkorb zurück: nur die Markierung fällt weg. */
export function untrashImage(ctx: DbCtx, id: string): boolean {
  const res = ctx.sqlite.prepare('UPDATE image SET deleted_at = NULL WHERE id = ?').run(id);
  return res.changes > 0;
}

/** Was an der Stelle eines endgültig entfernten Bildes im Text stehen bleibt. */
export const GONE_NOTE = '[BILD WURDE GELÖSCHT]';

/**
 * Ersetzt jeden Verweis auf dieses Bild durch den Hinweis. Wird nur beim
 * endgültigen Entfernen aufgerufen: solange das Bild im Papierkorb liegt, ist es
 * noch da und wird auch noch ausgeliefert – erst danach stünde in den
 * Beschreibungen ein kaputtes Bild.
 *
 * Deshalb braucht es auch keinen Rückweg: das Entfernen selbst hat keinen.
 */
export function stripRefs(ctx: DbCtx, imageId: string): number {
  const pattern = new RegExp(String.raw`!\[[^\]]*\]\(\s*/api/bilder/${imageId}[^)]*\)`, 'g');
  let n = 0;
  for (const kind of ['task', 'milestone'] as const) {
    const rows = ctx.sqlite
      .prepare(`SELECT id, desc FROM ${kind} WHERE desc LIKE ?`)
      .all(`%/api/bilder/${imageId}%`) as { id: string; desc: string }[];
    for (const r of rows) {
      const next = r.desc.replace(pattern, GONE_NOTE);
      if (next === r.desc) continue;
      // Version mit hochzählen, sonst schreibt ein offener Tab auf altem Stand darüber.
      ctx.sqlite
        .prepare(
          `UPDATE ${kind} SET desc = ?, updated_at = ?, version = version + 1 WHERE id = ?`,
        )
        .run(next, new Date().toISOString(), r.id);
      n++;
    }
  }

  /**
   * Und dasselbe in den Papierkorb-Einträgen: dort stehen die Texte gelöschter
   * Aufgaben als JSON. Ohne das zeigte eine wiederhergestellte Aufgabe später
   * ein kaputtes Bild ohne jede Erklärung – und genau der Fall ist häufig, weil
   * man ja gerade die Bilder aufräumt, die nur noch dort hängen.
   */
  const entries = ctx.sqlite
    .prepare("SELECT id, payload FROM trash WHERE kind != 'image' AND payload LIKE ?")
    .all(`%/api/bilder/${imageId}%`) as { id: string; payload: string }[];
  for (const e of entries) {
    let p: { row?: { desc?: string }; tasks?: { desc?: string }[]; milestones?: { desc?: string }[] };
    try {
      p = JSON.parse(e.payload);
    } catch {
      continue;
    }
    let hit = false;
    for (const row of [p.row, ...(p.tasks ?? []), ...(p.milestones ?? [])]) {
      if (typeof row?.desc !== 'string') continue;
      const next = row.desc.replace(pattern, GONE_NOTE);
      if (next === row.desc) continue;
      row.desc = next;
      hit = true;
    }
    if (!hit) continue;
    ctx.sqlite.prepare('UPDATE trash SET payload = ? WHERE id = ?').run(JSON.stringify(p), e.id);
    n++;
  }

  return n;
}

/** Endgültig – hier sind die Bytes wirklich weg, und die Texte sagen es. */
export function purgeImage(ctx: DbCtx, id: string): void {
  stripRefs(ctx, id);
  ctx.sqlite.prepare('DELETE FROM image WHERE id = ?').run(id);
}

/** Die Bild-ID aus einem Papierkorb-Eintrag, oder `null` bei allem anderen. */
export function imageIdIn(entry: { kind: string; payload: string }): string | null {
  if (entry.kind !== 'image') return null;
  try {
    return (JSON.parse(entry.payload) as { row?: { id?: string } }).row?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Beim Leeren des Papierkorbs: für jeden Bild-Eintrag fällt auch die Zeile.
 * Gibt zurück, wie viele es waren – das gehört in die Meldung, denn anders als
 * beim übrigen Papierkorb bringt ein „Rückgängig“ die Bytes nicht zurück.
 */
export function purgeImagesFor(ctx: DbCtx, entries: { kind: string; payload: string }[]): number {
  let n = 0;
  for (const e of entries) {
    const id = imageIdIn(e);
    if (!id) continue;
    purgeImage(ctx, id);
    n++;
  }
  return n;
}
