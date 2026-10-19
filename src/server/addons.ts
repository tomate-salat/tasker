import { randomBytes } from 'node:crypto';
import type { AddonPresence, RefineState } from '../shared/events.js';
import type { EventBus } from './events.js';

/**
 * Editor-Addons (Godot), die gerade verbunden sind, und die Aufträge
 * „In Godot verfeinern“ an sie. Alles nur im Speicher: nach einem Neustart
 * melden sich die Addons ohnehin neu, und ein laufender Auftrag verfällt.
 *
 * Ein Addon zählt als verbunden, solange es seinen Änderungs-Strom offen hat
 * (per Token, mit `?addon=godot&project=…`). Der Strom endet alle zehn
 * Minuten und wird sofort neu geöffnet; damit das nicht jedes Mal
 * „getrennt/verbunden“ meldet, gilt ein Addon erst nach `graceMs` ohne neuen
 * Strom als weg.
 *
 * Ein Auftrag geht an das Addon des Projekts, das zuletzt dazugekommen ist –
 * eindeutig, und keine doppelte Arbeit bei zwei offenen Editoren. Antwortet
 * es nicht, meldet der Server selbst „fehlgeschlagen“.
 */

type Conn = {
  id: number;
  projectId: string;
  addon: 'godot';
  name: string;
  since: string;
  send: (event: string, data: unknown) => void;
  /** Gesetzt, sobald der Strom zu ist – bis dahin zählt es noch als verbunden. */
  leaving: ReturnType<typeof setTimeout> | null;
};

type Request = {
  taskId: string;
  projectId: string;
  state: RefineState;
  timer: ReturnType<typeof setTimeout>;
  until: ReturnType<typeof setTimeout>;
};

export type HubTimes = {
  /** So lange zählt ein Addon nach dem Ende seines Stroms noch als verbunden. */
  graceMs?: number;
  /** So lange darf das Addon mit „angenommen“ warten. */
  acceptMs?: number;
  /** So lange darf ein Auftrag insgesamt dauern. */
  finishMs?: number;
};

export class AddonHub {
  private conns = new Map<number, Conn>();
  private requests = new Map<string, Request>();
  private next = 1;
  private shown = '[]';
  private readonly graceMs: number;
  private readonly acceptMs: number;
  private readonly finishMs: number;

  constructor(
    private readonly bus: EventBus,
    t: HubTimes = {},
  ) {
    this.graceMs = t.graceMs ?? 10_000;
    this.acceptMs = t.acceptMs ?? 10_000;
    this.finishMs = t.finishMs ?? 5 * 60_000;
  }

  /** Wer gerade verbunden ist, je Projekt und Name einmal. */
  list(): AddonPresence[] {
    const seen = new Map<string, AddonPresence>();
    for (const c of this.conns.values()) {
      const key = `${c.projectId}\n${c.name}`;
      const had = seen.get(key);
      if (!had || c.since < had.since) seen.set(key, { projectId: c.projectId, addon: c.addon, name: c.name, since: c.since });
    }
    return [...seen.values()].sort((a, b) => a.since.localeCompare(b.since));
  }

  /** Ein Addon-Strom ist offen. Gibt zurück, was beim Schließen aufzurufen ist. */
  connect(c: Pick<Conn, 'projectId' | 'addon' | 'name' | 'send'>): () => void {
    // Kommt dasselbe Addon zurück, bleibt sein „seit“, und der alte Strom geht still.
    let since = new Date().toISOString();
    for (const [id, old] of this.conns) {
      if (old.leaving && old.projectId === c.projectId && old.name === c.name) {
        clearTimeout(old.leaving);
        since = old.since < since ? old.since : since;
        this.conns.delete(id);
      }
    }
    const conn: Conn = { ...c, id: this.next++, since, leaving: null };
    this.conns.set(conn.id, conn);
    this.announce();
    return () => {
      if (conn.leaving || !this.conns.has(conn.id)) return;
      conn.leaving = setTimeout(() => {
        this.conns.delete(conn.id);
        this.announce();
      }, this.graceMs);
    };
  }

  /** Schickt einen Auftrag an das Addon des Projekts – `null`, wenn keins verbunden ist. */
  refine(taskId: string, projectId: string, mode: 'rewrite'): string | null {
    const target = [...this.conns.values()]
      .filter((c) => c.projectId === projectId && !c.leaving)
      .sort((a, b) => b.since.localeCompare(a.since) || b.id - a.id)[0];
    if (!target) return null;

    const requestId = randomBytes(12).toString('base64url');
    const request: Request = {
      taskId,
      projectId,
      state: 'sent',
      timer: setTimeout(() => this.fail(requestId, 'Godot hat nicht reagiert.'), this.acceptMs),
      until: setTimeout(() => this.fail(requestId, 'Zeitüberschreitung – Godot ist nicht fertig geworden.'), this.finishMs),
    };
    this.requests.set(requestId, request);
    target.send('godot-refine', { requestId, taskId, mode });
    this.report(requestId, request, null);
    return requestId;
  }

  /** Was das Addon meldet. `false`: diesen Auftrag gibt es nicht (mehr). */
  status(requestId: string, state: Exclude<RefineState, 'sent'>, message: string | null): boolean {
    const request = this.requests.get(requestId);
    if (!request) return false;
    clearTimeout(request.timer);
    request.state = state;
    if (state === 'done' || state === 'failed') this.finish(requestId, request);
    this.report(requestId, request, message);
    return true;
  }

  private fail(requestId: string, message: string): void {
    const request = this.requests.get(requestId);
    if (!request) return;
    request.state = 'failed';
    this.finish(requestId, request);
    this.report(requestId, request, message);
  }

  private finish(requestId: string, request: Request): void {
    clearTimeout(request.timer);
    clearTimeout(request.until);
    this.requests.delete(requestId);
  }

  private report(requestId: string, request: Request, message: string | null): void {
    this.bus.publish({ type: 'godot', requestId, taskId: request.taskId, state: request.state, message });
  }

  /** Meldet die Liste, wenn sie sich geändert hat. */
  private announce(): void {
    const addons = this.list();
    const now = JSON.stringify(addons.map((a) => [a.projectId, a.name, a.since]));
    if (now === this.shown) return;
    this.shown = now;
    this.bus.publish({ type: 'addons', addons });
  }
}
