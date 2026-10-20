import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { useStore } from '../store.js';

/**
 * Diktieren in den Editor (Wunsch des Nutzers) über die Spracherkennung des
 * Browsers, auf Deutsch, mit Zwischenergebnissen. Edge erkennt zuverlässig
 * (über einen Dienst von Microsoft), Brave bietet die Schnittstelle an, scheitert
 * aber beim Start mit `network`, Firefox hat sie gar nicht.
 *
 * Ohne Schnittstelle gibt es keinen Knopf. Meldet sie einen Fehler, sagt
 * Tasker das samt dem Fehler des Browsers, der Knopf bleibt aber: Edge meldet
 * Fehler auch dann, wenn es gerade noch zuverlässig erkannt hat.
 *
 * Edge hört nach einer Sprechpause von selbst auf. Tasker fängt dann gleich
 * wieder an – Schluss ist erst, wenn man den Knopf drückt oder etwas scheitert.
 *
 * Der Knopf kann beides: kurz klicken schaltet ein und aus, gedrückt halten
 * nimmt auf, bis man loslässt.
 */

/** Ab so langem Drücken gilt es als Halten statt als Klick. */
const HOLD_MS = 400;

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const Ctor = (): (new () => Recognition) | null => {
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

// Früher blendete ein Fehlschlag den Knopf auf dem Gerät für immer aus.
try {
  localStorage.removeItem('tasker.diktatAus');
} catch {
  // Privates Fenster – dort stand ohnehin nichts.
}

export function useDictation(onText: (text: string) => void): {
  supported: boolean;
  active: boolean;
  /** Was gerade gehört, aber noch nicht sicher erkannt ist. */
  interim: string;
  /** Hört auf, etwa wenn der Text abgeschickt wird. */
  stop: () => void;
  /** An den Mikrofon-Knopf: Klick schaltet um, Halten nimmt bis zum Loslassen auf. */
  press: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onPointerUp: () => void;
    onPointerCancel: () => void;
    onClick: (e: MouseEvent<HTMLElement>) => void;
  };
} {
  const [supported] = useState(() => !!Ctor());
  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef<Recognition | null>(null);
  /** Soll noch zugehört werden? Nur der Knopf und echte Fehler setzen das zurück. */
  const wanted = useRef(false);
  const deliver = useRef(onText);
  deliver.current = onText;

  const stop = useCallback(() => {
    wanted.current = false;
    rec.current?.stop();
  }, []);
  // Wer den Editor schließt, beendet auch das Zuhören.
  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  const start = useCallback(() => {
    const C = Ctor();
    if (!C) return;
    const r = new C();
    r.lang = 'de-DE';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result) continue;
        const text = result[0].transcript.trim();
        if (result.isFinal) {
          if (text) deliver.current(text);
        } else pending += `${pending ? ' ' : ''}${text}`;
      }
      setInterim(pending);
    };
    r.onerror = (e) => {
      // Stille ist kein Grund aufzuhören, alles andere schon.
      if (e.error !== 'no-speech') wanted.current = false;
      const say = useStore.getState().say;
      if (e.error === 'not-allowed') {
        say('Das Mikrofon ist für Tasker nicht freigegeben.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        say(`Spracherkennung abgebrochen (${e.error}).`);
      }
    };
    r.onend = () => {
      if (wanted.current) {
        try {
          r.start();
          return;
        } catch {
          wanted.current = false;
        }
      }
      rec.current = null;
      setActive(false);
      setInterim('');
    };
    rec.current = r;
    wanted.current = true;
    setActive(true);
    try {
      r.start();
    } catch {
      wanted.current = false;
      rec.current = null;
      setActive(false);
    }
  }, []);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);

  // Wann der laufende Druck eine Aufnahme begonnen hat – nur dann zählt Loslassen.
  const pressedAt = useRef<number | null>(null);
  const release = useCallback(() => {
    if (pressedAt.current !== null && Date.now() - pressedAt.current >= HOLD_MS) stop();
    pressedAt.current = null;
  }, [stop]);
  const press = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      // Loslassen kommt auch an, wenn der Zeiger den Knopf inzwischen verlassen hat.
      e.currentTarget.setPointerCapture(e.pointerId);
      if (rec.current) {
        stop();
        pressedAt.current = null;
      } else {
        start();
        pressedAt.current = Date.now();
      }
    },
    onPointerUp: release,
    onPointerCancel: release,
    // Mit der Maus ist beim Drücken schon alles geschehen; nur Tastatur (Enter, Leertaste) klickt.
    onClick: (e: MouseEvent<HTMLElement>) => {
      if (e.detail === 0) toggle();
    },
  };
  return { supported, active, interim, press, stop };
}
