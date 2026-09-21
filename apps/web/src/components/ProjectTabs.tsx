import { NavLink } from 'react-router-dom';

/** The two tabs a cartoon has (plan D38): Story and Director. Nothing else. */
export function ProjectTabs({ projectId }: { projectId: string }) {
  return (
    <nav className="tabs" aria-label="Cartoon sections">
      <NavLink to={`/projects/${projectId}`} end className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
        Story
      </NavLink>
      <NavLink to={`/projects/${projectId}/director`} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
        Director
      </NavLink>
    </nav>
  );
}
