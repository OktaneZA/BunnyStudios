import { useCallback, useEffect, useRef, useState } from 'react';
import { director, isActiveJob, type Job } from './director-api';

/**
 * The cartoon's generation jobs, newest first, with every active one polled every two
 * seconds (DM-20). When a job settles, `onSettled` lets the screen refresh whatever the
 * job changed (shots, cast pictures, the allowance) without re-fetching on every tick.
 */
export function useJobs(projectId: string | undefined, onSettled: (job: Job) => void) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const settled = useRef(onSettled);
  settled.current = onSettled;

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const result = await director.projectJobs(projectId);
    setJobs(result.data);
    setLoaded(true);
  }, [projectId]);

  useEffect(() => {
    setJobs([]);
    setLoaded(false);
    refresh().catch(() => setLoaded(true));
  }, [refresh]);

  const active = jobs.filter(isActiveJob).map((j) => j.id).join(',');

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const ids = active.split(',');
    const timer = setInterval(async () => {
      for (const id of ids) {
        try {
          const fresh = await director.job(id);
          if (!alive) return;
          setJobs((prev) => prev.map((j) => (j.id === id ? fresh : j)));
          if (!isActiveJob(fresh)) settled.current(fresh);
        } catch {
          /* a missed poll is retried on the next tick */
        }
      }
    }, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [active]);

  const add = useCallback((job: Job) => {
    setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev.map((j) => (j.id === job.id ? job : j)) : [job, ...prev]));
  }, []);

  return { jobs, loaded, add, refresh };
}
