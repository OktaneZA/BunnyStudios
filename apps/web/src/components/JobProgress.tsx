import type { Job, JobStatus } from '../director-api';

const STEPS: { label: string; statuses: JobStatus[] }[] = [
  { label: 'Waiting', statuses: ['queued'] },
  { label: 'Making', statuses: ['submitted', 'running'] },
  { label: 'Checking', statuses: ['reviewing'] },
  { label: 'Ready', statuses: ['ready'] },
];

/** A running job as a four-step progress card: Waiting → Making → Checking → Ready (DM-20). */
export function JobProgress({ job, what }: { job: Job; what: 'picture' | 'pictures' | 'clip' | 'cartoon' }) {
  const current = STEPS.findIndex((s) => s.statuses.includes(job.status));
  const title = job.status === 'reviewing' ? "Checking it's OK" : `Making your ${what}`;
  return (
    <div className="job-progress" role="status" aria-live="polite">
      <span className="ai-spinner" aria-hidden="true" />
      <div>
        <b>{title}</b>
        <div className="job-steps">
          {STEPS.map((s, i) => (
            <span key={s.label} className={`job-step${i < current ? ' done' : ''}${i === current ? ' now' : ''}`}>
              <span className="job-dot" aria-hidden="true" />{s.label}
            </span>
          ))}
        </div>
        {what === 'clip' && <span className="hint">2 to 4 minutes. You can leave; it keeps going.</span>}
        {what === 'cartoon' && <span className="hint">About a minute. You can leave; it keeps going.</span>}
      </div>
    </div>
  );
}
