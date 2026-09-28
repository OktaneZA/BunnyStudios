import type { Job, JobStatus } from '../director-api';

const STEPS: { label: string; statuses: JobStatus[] }[] = [
  { label: 'Waiting', statuses: ['queued'] },
  { label: 'Making', statuses: ['submitted', 'running'] },
  { label: 'Checking', statuses: ['reviewing'] },
  { label: 'Ready', statuses: ['ready'] },
];

/** A running job as a four-step progress card: Waiting → Making → Checking → Ready (DM-20). */
function elapsed(from: string) {
  const s = Math.max(0, Math.round((Date.now() - new Date(from).getTime()) / 1000));
  return s < 60 ? `${s} s so far` : `${Math.floor(s / 60)} min ${s % 60} s so far`;
}

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
        {/* The step the server is on right now, so a slow clip never looks frozen. */}
        {job.progress && <span className="job-now">{job.progress.say} · {elapsed(job.created_at)}</span>}
        {what === 'clip' && <span className="hint">Usually 1 to 4 minutes; longer clips take longer. You can leave; it keeps going.</span>}
        {what === 'cartoon' && <span className="hint">About a minute. You can leave; it keeps going.</span>}
      </div>
    </div>
  );
}
