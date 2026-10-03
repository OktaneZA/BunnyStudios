import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type Project } from '../api';
import { director, type CastList, type GenerationSettings } from '../director-api';
import { useJobs } from '../useJobs';
import { CartoonHeader } from '../components/ProjectTabs';
import { CastBoard } from '../components/CastBoard';
import { CastSheet } from '../components/CastSheet';
import { ProblemBox } from '../components/ProblemBox';

/**
 * Characters, on their own page (mockup option B + C): the cast board says who is in which
 * scene; below it, each character's words, pictures and look. Create keeps only the faces.
 */
export function Characters() {
  const { projectId } = useParams<{ projectId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const fromScene = search.get('scene');
  const [project, setProject] = useState<Project | null>(null);
  const [cast, setCast] = useState<CastList | null>(null);
  const [settings, setSettings] = useState<GenerationSettings | null>(null);
  const [focus, setFocus] = useState<string | null>(search.get('character'));
  const [error, setError] = useState<unknown>(null);
  const { jobs, add: addJob } = useJobs(projectId, async () => { await refreshCast(); });

  const refreshCast = useCallback(async () => { if (projectId) setCast(await director.cast(projectId)); }, [projectId]);
  useEffect(() => {
    if (!projectId) return;
    api.getProject(projectId).then(setProject).catch(setError);
    refreshCast().catch(setError);
    director.settings().then(setSettings).catch(() => {});
  }, [projectId, refreshCast]);

  if (error && !project) return <ProblemBox error={error} />;
  if (!project || !projectId) return <p className="muted">Loading…</p>;

  return (
    <div className="characters-page">
      <CartoonHeader projectId={project.id} title={project.title} step="make" />
      <ProblemBox error={error} />
      <section className="stack">
        <h3 className="characters-title">Who is in which scene</h3>
        <CastBoard projectId={projectId} characters={cast?.data ?? []} onPick={(id) => { setFocus(id); document.getElementById('character-looks')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} />
      </section>
      <section className="stack" id="character-looks">
        <h3 className="characters-title">Your characters</h3>
        <CastSheet inline projectId={project.id} cast={cast} models={settings?.models ?? []} jobs={jobs} onJob={addJob} refreshCast={refreshCast}
          onClose={() => navigate(`/projects/${projectId}/director${fromScene ? `?scene=${fromScene}` : ''}`)} advanced={false} settingsMessage={settings?.message ?? null} testMode={settings?.test_mode}
          initialCharacterId={focus} focusKey={focus} returnToScene={fromScene ? 'the scene' : null} />
      </section>
    </div>
  );
}
