import { useCallback, useEffect, useState } from 'react';
import { director, type AccountBudget, type LoggedJob } from '../director-api';
import { ProblemBox } from './ProblemBox';

const since = (from: string, to: string) => {
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  return s < 60 ? `+${s} s` : `+${Math.floor(s / 60)} min ${s % 60} s`;
};
const took = (job: LoggedJob) => since(job.created_at, job.finished_at ?? new Date().toISOString()).slice(1);

/**
 * The adult's clip log: recent jobs for one account, each with its step trail. When a clip is
 * slow or fails, the last line says where it got to, and a failure shows the server's own error.
 */
export function ClipLog({ accounts }: { accounts: AccountBudget[] }) {
  const [accountId, setAccountId] = useState(() => accounts.find((a) => a.is_minor)?.id ?? accounts[0]?.id ?? '');
  const [jobs, setJobs] = useState<LoggedJob[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stopping, setStopping] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!accountId) return;
    try { setJobs((await director.accountJobs(accountId)).data); setError(null); } catch (err) { setError(err); }
  }, [accountId]);
  useEffect(() => { setJobs(null); void load(); }, [load]);
  /** Stop a job that is stuck. Money already sent to the provider stays counted; the rest comes back. */
  async function stop(id: string) {
    setStopping(id); setError(null);
    try { await director.cancelJob(id); await load(); } catch (err) { setError(err); } finally { setStopping(null); }
  }
  // While something is still running, keep the log fresh.
  useEffect(() => {
    if (!jobs?.some((j) => ['queued', 'submitted', 'running', 'reviewing'].includes(j.status))) return;
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [jobs, load]);

  return (
    <section className="card stack" aria-labelledby="clip-log-title">
      <h3 id="clip-log-title">Clip log</h3>
      <p className="hint">Every clip, picture and cartoon, with each step it went through. Open one to see where a slow or failed job got to.</p>
      <div className="row">
        <label htmlFor="clip-log-account" className="sr-only">Whose clips</label>
        <select id="clip-log-account" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.display_name}</option>)}
        </select>
        <button type="button" className="secondary" onClick={() => void load()}>Refresh</button>
      </div>
      <ProblemBox error={error} />
      {jobs && jobs.length === 0 && <p className="muted">Nothing made yet.</p>}
      <ul className="clip-log">
        {jobs?.map((job) => {
          const last = job.events[job.events.length - 1];
          const active = ['queued', 'submitted', 'running', 'reviewing'].includes(job.status);
          return (
            <li key={job.id}>
              <details>
                <summary>
                  <span className={`log-status ${job.status}`}>{job.status}</span>
                  <span className="log-what"><b>{job.project_title}</b> · {job.kind}{job.duration_seconds ? ` · ${job.duration_seconds} s` : ''} · {job.model_id}</span>
                  <span className="muted">{new Date(job.created_at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {active ? 'running for' : 'took'} {took(job)}{job.attempt > 1 ? ` · attempt ${job.attempt}` : ''}</span>
                  {last && <span className="log-last">{last.say}{last.detail ? ` · ${last.detail}` : ''}</span>}
                </summary>
                <ol className="log-steps">
                  {job.events.map((e, i) => (
                    <li key={i} className={e.raw ? 'log-error' : undefined}>
                      <span className="log-time">{since(job.created_at, e.at)}</span>
                      <span><b>{e.say}</b>{e.detail && <span className="muted"> · {e.detail}</span>}
                        {e.raw && <code className="log-raw">{e.raw}</code>}</span>
                    </li>
                  ))}
                  {job.events.length === 0 && <li className="muted">No steps recorded (made before the clip log existed).</li>}
                </ol>
                <p className="hint">Job {job.id}</p>
                {active && <button type="button" className="secondary" disabled={stopping === job.id} onClick={() => void stop(job.id)}>Stop this job</button>}
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
