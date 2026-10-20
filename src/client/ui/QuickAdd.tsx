import { useEffect, useRef, useState } from 'react';
import type { Workspace } from '@shared/workspace.js';
import { useBackClose } from '../back.js';
import { currentProjectId, useStore } from '../store.js';
import { useDictation } from './dictation.js';
import { LangChip } from './LangChip.js';
import { TOOL_ICON } from './icons.js';

/**
 * Strg+N aus jeder Ansicht: ein Feld für den Titel, und der Task liegt im
 * Backlog des aktuellen Projekts unter „Unsortiert“ – man bleibt, wo man war.
 * Diktieren geht auch hier. Ist ein Godot zum Projekt verbunden, schickt
 * Strg+Enter den neuen Task gleich zum Verfeinern hin.
 */
export function QuickAdd({ ws, onClose }: { ws: Workspace; onClose: () => void }) {
  const projectId = useStore(currentProjectId);
  const project = projectId ? ws.project(projectId) : undefined;
  const godot = useStore((s) => s.addons.find((a) => a.projectId === projectId));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const dictation = useDictation((heard) => {
    const el = input.current;
    if (!el) return;
    const at = el.selectionStart ?? el.value.length;
    const before = el.value.slice(0, at);
    const add = (before && !/\s$/.test(before) ? ' ' : '') + heard;
    setText(before + add + el.value.slice(el.selectionEnd ?? at));
    requestAnimationFrame(() => el.setSelectionRange(at + add.length, at + add.length));
  });

  useBackClose(onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const create = async (refine: boolean): Promise<void> => {
    const title = text.trim();
    if (!title || !project || busy) return;
    setBusy(true);
    const s = useStore.getState();
    const id = await s.addTask({ title, projectId: project.id });
    setBusy(false);
    if (!id) return;
    onClose();
    if (refine && godot) {
      await s.refineInGodot(id);
      s.say(`„${title}“ liegt im Backlog › Unsortiert und ist an ${godot.name} geschickt`);
    } else {
      s.say(`„${title}“ liegt im Backlog › Unsortiert`);
    }
  };

  return (
    <div className="search" onClick={onClose}>
      <div className="search-card quick" role="dialog" aria-label="Neuer Task" onClick={(e) => e.stopPropagation()}>
        <div className="search-field">
          <input
            ref={input}
            autoFocus
            value={text}
            placeholder={project ? `Neuer Task in ${project.name}` : 'Kein Projekt vorhanden'}
            aria-label="Titel des neuen Tasks"
            autoComplete="off"
            disabled={busy || !project}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              void create(e.ctrlKey || e.metaKey);
            }}
          />
          {dictation.supported && <LangChip />}
          {dictation.supported && (
            <button
              type="button"
              className={`d-tool ${dictation.active ? 'on' : ''}`}
              title={dictation.active ? 'Diktieren beenden' : 'Diktieren – klicken oder gedrückt halten'}
              aria-label={dictation.active ? 'Diktieren beenden' : 'Diktieren'}
              aria-pressed={dictation.active}
              // Der Fokus bleibt im Feld, dorthin kommt der Text.
              onMouseDown={(e) => e.preventDefault()}
              {...dictation.press}
            >
              {TOOL_ICON.mic}
            </button>
          )}
          <kbd>Esc</kbd>
        </div>
        {dictation.active && (
          <p className="d-dictation quick-dictation">
            <span className="d-dictation-dot" aria-hidden />
            {dictation.interim || 'Hört zu …'}
          </p>
        )}
        <div className="quick-foot">
          <span className="muted">
            <kbd>Enter</kbd> in den Backlog › Unsortiert
          </span>
          {godot && (
            <button
              className="btn tiny"
              disabled={busy || !text.trim()}
              title={`Anlegen und an ${godot.name} schicken`}
              onClick={() => void create(true)}
            >
              Anlegen und in Godot verfeinern <kbd>Strg</kbd>+<kbd>Enter</kbd>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
