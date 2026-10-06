import { fork, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RenderReply, RenderRequest } from './drawingWorker.js';
import type { Scene } from './drawings.js';

/**
 * Eine Zeichnung als PNG, für Clients, die Excalidraw nicht selbst zeichnen
 * können (das Godot-Addon). Gespeichert wird davon nichts – das Bild entsteht
 * bei jedem Abruf aus der Szene.
 *
 * Gezeichnet wird in einem eigenen Prozess (drawingWorker.ts). Der startet erst
 * beim ersten Abruf und geht nach einer Minute ohne Arbeit wieder – er braucht
 * rund 200 MB, und nur ein beendeter Prozess gibt die auch wirklich zurück
 * (ein Thread behielt gut die Hälfte). Solange niemand eine Zeichnung als Bild
 * will, kostet das den Server nichts.
 */

const WORKER_FILE = 'dist/server/drawing-worker.mjs';
const IDLE_MS = 60_000;
const TIMEOUT_MS = 20_000;

type Waiting = {
  resolve: (png: Uint8Array) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout;
  since: number;
};

/**
 * Start, jedes Bild und das Ende stehen im Log, mit dem Speicher beider
 * Prozesse – sonst lässt sich am Speicher-Verlauf des Dienstes nicht ablesen,
 * wem ein Anstieg gehört und ob der Zeichen-Prozess wirklich gegangen ist.
 */
const mb = (bytes: number): number => Math.round(bytes / 1e6);
const serverMemory = (): string => {
  const m = process.memoryUsage();
  return `Server: ${mb(m.rss)} MB (Heap ${mb(m.heapUsed)}, extern ${mb(m.external)})`;
};

let worker: ChildProcess | null = null;
let idle: NodeJS.Timeout | null = null;
let seq = 0;
const waiting = new Map<number, Waiting>();

function stop(reason: string): void {
  const w = worker;
  worker = null;
  if (idle) clearTimeout(idle);
  idle = null;
  for (const [id, job] of waiting) {
    clearTimeout(job.timer);
    job.reject(new Error(reason));
    waiting.delete(id);
  }
  w?.kill();
}

function start(): ChildProcess {
  const file = resolve(WORKER_FILE);
  if (!existsSync(file)) {
    throw new Error(`${WORKER_FILE} fehlt – einmal \`npm run build:worker\` ausführen.`);
  }
  // `advanced`, damit das PNG als Bytes ankommt und nicht als JSON.
  const w = fork(file, { serialization: 'advanced', execArgv: [] });
  w.on('message', (reply: RenderReply) => {
    const job = waiting.get(reply.id);
    if (!job) return;
    waiting.delete(reply.id);
    clearTimeout(job.timer);
    if ('error' in reply) return job.reject(new Error(reply.error));
    console.log(
      `Zeichnung gezeichnet in ${Date.now() - job.since} ms, ${Math.round(reply.png.length / 1e3)} KB. ` +
        `Zeichen-Prozess ${w.pid}: ${mb(reply.rss)} MB. ${serverMemory()}`,
    );
    job.resolve(reply.png);
  });
  w.on('error', (e) => {
    if (worker === w) stop(e.message);
  });
  w.on('exit', (code, signal) => {
    console.log(`Zeichen-Prozess ${w.pid} beendet (${signal ?? code}). ${serverMemory()}`);
    if (worker === w) stop('Der Zeichen-Prozess ist beendet.');
  });
  console.log(`Zeichen-Prozess ${w.pid} gestartet. ${serverMemory()}`);
  // Ein wartender Prozess soll den Server nicht am Beenden hindern.
  w.unref();
  w.channel?.unref();
  return w;
}

export function renderDrawing(scene: Scene, opts: { dark: boolean; maxEdge: number }): Promise<Uint8Array> {
  worker ??= start();
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => stop('Pause'), IDLE_MS);
  idle.unref();

  const id = ++seq;
  const req: RenderRequest = { id, elements: scene.elements, files: scene.files ?? null, ...opts };
  return new Promise((res, rej) => {
    // Hängt der Prozess, geht er ganz – der nächste Abruf startet einen neuen.
    const timer = setTimeout(() => stop('Das Zeichnen hat zu lange gedauert.'), TIMEOUT_MS);
    waiting.set(id, { resolve: res, reject: rej, timer, since: Date.now() });
    worker?.send(req);
  });
}

/** Für Tests: den Prozess sofort beenden. */
export const stopDrawingWorker = (): void => stop('Beendet');
