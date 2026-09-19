import { useState } from 'react';
import { parseQuickAdd, quickAddInput, targetLabel } from '@shared/quickadd.js';
import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import { tagStyle } from './rows.js';

/** Die Zeile über der Liste: eine Zeile Text wird zu einer Aufgabe. */
export function QuickAdd({ ws, projectId }: { ws: Workspace; projectId: string }) {
  const { addTask, select, say } = useStore();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = text.trim() ? parseQuickAdd(ws, text, projectId) : null;

  async function submit() {
    if (!parsed || busy) return;
    if (!parsed.title) {
      say('Gib einen Titel ein.');
      return;
    }
    setBusy(true);
    const id = await addTask(quickAddInput(parsed));
    setBusy(false);
    if (!id) return;
    setText('');
    select(id);
    say(`Angelegt: ${targetLabel(parsed.target)}`);
  }

  return (
    <div className="qa-wrap">
      <input
        id="qa"
        className="qa"
        value={text}
        placeholder='Schnell erfassen:  Titel #label !1 >Ziel +Projekt ~status %Markierung &Kategorie @nach:Aufgabe'
        autoComplete="off"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setText('');
            e.currentTarget.blur();
          }
        }}
      />

      {parsed && (
        <div className="qa-preview">
          {parsed.title ? (
            <span className="pv">
              Titel <b>{parsed.title}</b>
            </span>
          ) : (
            <span className="pv bad">Titel fehlt</span>
          )}

          <span className="pv">
            Projekt <b>{ws.project(parsed.projectId)?.name ?? '—'}</b>
          </span>
          <span className="pv">
            Ort <b>{targetLabel(parsed.target)}</b>
          </span>

          {parsed.mark && (
            <span className="pv">
              Markierung{' '}
              <b>
                {parsed.mark.emoji} {parsed.mark.name}
              </b>
            </span>
          )}
          {parsed.category && (
            <span className="pv">
              Kategorie <b>{parsed.category.name}</b>
            </span>
          )}
          {parsed.status && (
            <span className="pv">
              Status <b>{parsed.status}</b>
            </span>
          )}
          {parsed.prio > 0 && (
            <span className="pv">
              Priorität <b>P{parsed.prio}</b>
            </span>
          )}
          {parsed.tags.map((t) => (
            <span key={t} className="tag" style={tagStyle(t)}>
              {t}
            </span>
          ))}
          {parsed.dep && (
            <span className="pv">
              Nach <b>{parsed.dep.title}</b>
            </span>
          )}

          {parsed.missing.map((m) => (
            <span key={m.field} className="pv bad">
              {m.field} „{m.query}“ nicht gefunden
            </span>
          ))}

          <span className="pv">
            <kbd>Enter</kbd> anlegen
          </span>
        </div>
      )}
    </div>
  );
}

/** Fokussiert die Erfassungszeile – benutzt von den Tastenkürzeln `N` und `/`. */
export function focusQuickAdd(): void {
  document.getElementById('qa')?.focus();
}
