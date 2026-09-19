import type { Workspace } from '@shared/workspace.js';
import { useStore } from '../store.js';
import type { Account } from '../api.js';
import { NewThing } from './NewThing.js';

export function Sidebar({
  ws,
  account,
  onLogout,
}: {
  ws: Workspace;
  account: Account;
  onLogout: () => void;
}) {
  const { projectId, setProject, boot, addProject } = useStore();
  const counts = boot?.archiveCounts ?? {};

  return (
    <nav id="side">
      <div className="brand">Tasker</div>

      <div className="side-sec">Projekte</div>
      {ws.projects.map((p) => {
        const open = ws.tasks.filter((t) => t.projectId === p.id && t.status !== 'done').length;
        return (
          <button
            key={p.id}
            className={`side-item ${projectId === p.id ? 'on' : ''}`}
            onClick={() => setProject(p.id)}
          >
            <span className="dotc" style={{ background: p.color }} aria-hidden="true" />
            <span className="si-name">{p.name}</span>
            <span className="si-count" title={`${open} offen`}>
              {open}
            </span>
          </button>
        );
      })}

      <NewThing
        label="+ Projekt"
        placeholder="Name des Projekts"
        className="side-item side-new"
        onCreate={addProject}
      />

      {projectId && counts[projectId] ? (
        <p className="side-hint">
          {counts[projectId]} {counts[projectId] === 1 ? 'Eintrag' : 'Einträge'} im Archiv
        </p>
      ) : null}

      <button className="side-user" onClick={onLogout} title="Abmelden">
        <span className="avatar">{account.avatar}</span>
        <span className="su-name">{account.name}</span>
      </button>
    </nav>
  );
}
