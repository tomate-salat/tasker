import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store.js';

/**
 * Diktieren in den Editor (Wunsch des Nutzers) über die Spracherkennung des
 * Browsers, auf Deutsch, mit Zwischenergebnissen. Edge erkennt zuverlässig
 * (über einen Dienst von Microsoft), Brave bietet die Schnittstelle an, scheitert
 * aber beim Start mit `network`, Firefox hat sie gar nicht.
 *
 * Ohne Schnittstelle gibt es keinen Knopf. Scheitert sie beim Start, sagt
 * Tasker das und blendet den Knopf auf diesem Gerät aus, statt still nichts
 * zu tun.
 */

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

/** Auf diesem Gerät schon einmal gescheitert – dann kein Knopf mehr. */
const OFF_KEY = 'tasker.diktatAus';
const off = (): boolean => {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
};

/** Fehler, nach denen es hier nie klappen wird – anders als ein verweigertes Mikrofon. */
const UNAVAILABLE = new Set(['network', 'service-not-allowed', 'language-not-supported']);

export function useDictation(onText: (text: string) => void): {
  supported: boolean;
  active: boolean;
  /** Was gerade gehört, aber noch nicht sicher erkannt ist. */
  interim: string;
  toggle: () => void;
} {
  const [supported, setSupported] = useState(() => !!Ctor() && !off());
  const [active, setActive] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef<Recognition | null>(null);
  const deliver = useRef(onText);
  deliver.current = onText;

  const stop = useCallback(() => rec.current?.stop(), []);
  // Wer den Editor schließt, beendet auch das Zuhören.
  useEffect(() => () => rec.current?.abort(), []);

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
      const say = useStore.getState().say;
      if (UNAVAILABLE.has(e.error)) {
        try {
          localStorage.setItem(OFF_KEY, '1');
        } catch {
          // Privates Fenster – dann eben nur jetzt.
        }
        setSupported(false);
        say('Spracherkennung ist in diesem Browser nicht verfügbar – in Edge funktioniert sie.');
      } else if (e.error === 'not-allowed') {
        say('Das Mikrofon ist für Tasker nicht freigegeben.');
      } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
        say(`Spracherkennung abgebrochen (${e.error}).`);
      }
    };
    r.onend = () => {
      rec.current = null;
      setActive(false);
      setInterim('');
    };
    rec.current = r;
    setActive(true);
    try {
      r.start();
    } catch {
      rec.current = null;
      setActive(false);
    }
  }, []);

  const toggle = useCallback(() => (rec.current ? stop() : start()), [start, stop]);
  return { supported, active, interim, toggle };
}
