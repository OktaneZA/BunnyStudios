import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export type CartoonStep = 'write' | 'make' | 'together';

const STEPS: { id: CartoonStep; n: number; label: string; path: string }[] = [
  { id: 'write', n: 1, label: 'Write', path: '' },
  { id: 'make', n: 2, label: 'Make clips', path: '/director' },
  { id: 'together', n: 3, label: 'Put it together', path: '/together' },
];

/**
 * The three steps of a cartoon, in the same place on every cartoon screen (including a
 * scene's own page, which belongs to Write). Two verbs only: Write and Make clips.
 */
export function ProjectTabs({ projectId, step }: { projectId: string; step: CartoonStep }) {
  return (
    <nav className="tabs steps-nav" aria-label="Cartoon steps">
      {STEPS.map((s) => (
        <Link key={s.id} to={`/projects/${projectId}${s.path}`} className={`tab${s.id === step ? ' active' : ''}`}
          aria-current={s.id === step ? 'step' : undefined}>
          <span className="step-n" aria-hidden="true">{s.n}</span>{s.label}
        </Link>
      ))}
    </nav>
  );
}

/** The cartoon's title with the steps beside it. Every cartoon screen starts with this. */
export function CartoonHeader({ projectId, title, step, children }: {
  projectId: string; title: string; step: CartoonStep; children?: ReactNode;
}) {
  return (
    <header className="project-head cartoon-head">
      {/* Title and steps share one row, so the steps sit in exactly the same place everywhere. */}
      <div className="cartoon-head-row">
        <h2>{title}</h2>
        <ProjectTabs projectId={projectId} step={step} />
      </div>
      {children && <div className="cartoon-head-sub">{children}</div>}
    </header>
  );
}
