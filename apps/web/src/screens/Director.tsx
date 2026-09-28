import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type Account, type Project, type Scene } from '../api';
import { director, type Asset, type CastList, type GenerationSettings, type Job, type Shot, type Timeline } from '../director-api';
import { useJobs } from '../useJobs';
import { ProblemBox } from '../components/ProblemBox';
import { CartoonHeader } from '../components/ProjectTabs';
import { CastSheet } from '../components/CastSheet';
import { DirectorScenes } from '../components/DirectorScenes';
import { DirectorPanel } from '../components/DirectorPanel';
import { SceneComposer } from '../components/SceneComposer';

const DESIGNS = [
  { id: 'film-strip', name: 'Film Strip' },
  { id: 'scene-board', name: 'Scene Board' },
] as const;

/**
 * Make clips: scenes first, in a film strip or board, then one composer for the selected scene
 * (docs/teen-ui-review.md). Layout, colour and movable panels live in View and are remembered.
 */
export function Director({ account }: { account: Account }) {
  const { projectId } = useParams<{ projectId: string }>();
  const [search, setSearch] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [shots, setShots] = useState<Map<string, Shot>>(new Map());
  const [settings, setSettings] = useState<GenerationSettings | null>(null);
  const [cast, setCast] = useState<CastList | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [media, setMedia] = useState<Asset[]>([]);
  const [sheet, setSheet] = useState<'cast' | null>(null);
  const [studioFor, setStudioFor] = useState<string | null>(null);
  const openStudio = useCallback((characterId: string) => { setStudioFor(characterId); setSheet('cast'); }, []);
  const [error, setError] = useState<unknown>(null);
  const [addingScene, setAddingScene] = useState(false);
  const [design, setDesign] = useState(() => {
    try { return localStorage.getItem('director.design') === 'scene-board' ? 'scene-board' : 'film-strip'; } catch { return 'film-strip'; }
  });
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('director.theme') === 'white' ? 'white' : 'black'; } catch { return 'black'; }
  });
  const [movable, setMovable] = useState(false);
  useEffect(() => {
    document.documentElement.dataset.directorTheme = theme;
    try { localStorage.setItem('director.theme', theme); } catch { /* Private browsing. */ }
    return () => { delete document.documentElement.dataset.directorTheme; };
  }, [theme]);
  const [layoutReset, setLayoutReset] = useState(0);

  const advanced = (project?.editor_mode ?? account.default_editor_mode) === 'advanced';

  const refreshSettings = useCallback(() => director.settings().then(setSettings).catch(setError), []);
  const refreshCast = useCallback(async () => { if (projectId) setCast(await director.cast(projectId)); }, [projectId]);
  const refreshTimeline = useCallback(async () => { if (projectId) setTimeline(await director.timeline(projectId)); }, [projectId]);
  const refreshMedia = useCallback(async () => { if (projectId) setMedia((await director.media(projectId)).data); }, [projectId]);
  const refreshShot = useCallback(async (sceneId: string) => {
    const shot = (await director.shots(sceneId)).data[0];
    if (shot) setShots((prev) => new Map(prev).set(sceneId, shot));
  }, []);

  // A finished clip lands in the story order by itself, so the shot, the strip and the
  // allowance all need a fresh read when a job settles.
  const onSettled = useCallback((job: Job) => {
    if (job.target_entity_type === 'shot') {
      const entry = [...shots.entries()].find(([, s]) => s.id === job.target_entity_id);
      if (entry) void refreshShot(entry[0]).catch(() => {});
    }
    if (job.target_entity_type === 'character') void refreshCast().catch(() => {});
    void refreshTimeline().catch(() => {});
    void refreshMedia().catch(() => {});
    void refreshSettings();
  }, [shots, refreshShot, refreshCast, refreshTimeline, refreshMedia, refreshSettings]);

  const { jobs, loaded: jobsLoaded, add: addJob } = useJobs(projectId, onSettled);

  useEffect(() => {
    if (!projectId) return;
    setError(null);
    Promise.all([api.getProject(projectId), api.listScenes(projectId)])
      .then(async ([p, s]) => {
        setProject(p);
        setScenes(s.data);
        const pairs = await Promise.all(s.data.map(async (scene) => [scene.id, (await director.shots(scene.id)).data[0]] as const));
        setShots(new Map(pairs.filter((x): x is readonly [string, Shot] => Boolean(x[1]))));
      })
      .catch(setError);
    void refreshSettings();
    refreshCast().catch(setError);
    refreshTimeline().catch(setError);
    refreshMedia().catch(() => {});
  }, [projectId, refreshSettings, refreshCast, refreshTimeline, refreshMedia]);

  const selected = scenes?.find((s) => s.id === search.get('scene')) ?? scenes?.[0] ?? null;
  const assetsById = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const a of media) map.set(a.id, a);
    for (const j of jobs) for (const a of j.results) map.set(a.id, a);
    return map;
  }, [media, jobs]);

  if (error && !project) return <ProblemBox error={error} />;
  if (!project || !scenes) return <p className="muted">Loading…</p>;

  const needLooks = (cast?.data ?? []).filter((c) => c.look_status === 'none').length;
  const castWords = !cast ? '…' : cast.data.length === 0 ? (cast.never_found ? 'Find them in your story' : 'Nobody yet') : needLooks === 0 ? 'All have a look' : `${needLooks} ${needLooks === 1 ? 'needs' : 'need'} a look`;
  const inCartoon = scenes.filter((scene) => shots.get(scene.id)?.hero_video_asset_id).length;
  const pickDesign = (id: string) => { setDesign(id); try { localStorage.setItem('director.design', id); } catch { /* Private browsing. */ } };

  return (
    <div className={`director-page design-${design}`}>
      {/* One short header row (simpler Create): progress, Characters, View and the two steps. */}
      <CartoonHeader projectId={project.id} title={project.title} step="make">
        <div className="create-controls" role="group" aria-label="Director controls">
        <div className="director-progress"><span>{inCartoon} of {scenes.length} scenes ready</span><progress aria-label="Scenes with clips" value={inCartoon} max={Math.max(1, scenes.length)} /></div>
        {settings?.test_mode && <span className="test-mode-pill" title="Pictures and clips are coloured placeholders, not AI-generated. No provider credits are used.">Test mode</span>}
        <button type="button" className="cast-button" onClick={() => setSheet('cast')}>Characters · {castWords} ›</button>
        <details className="view-menu">
          <summary>View</summary>
          <div className="view-menu-body">
            <Link className="btn secondary" to={`/projects/${project.id}`}>Manage scenes</Link>
            <div className="segmented" role="group" aria-label="Layout">
              {DESIGNS.map((item) => <button key={item.id} type="button" className={design === item.id ? 'on' : ''} aria-pressed={design === item.id} onClick={() => pickDesign(item.id)}>{item.name}</button>)}
            </div>
            <div className="segmented theme-picker" role="group" aria-label="Colour mode">
              <button type="button" className={theme === 'white' ? 'on' : ''} aria-pressed={theme === 'white'} onClick={() => setTheme('white')}>☀ White</button>
              <button type="button" className={theme === 'black' ? 'on' : ''} aria-pressed={theme === 'black'} onClick={() => setTheme('black')}>☾ Black</button>
            </div>
            <div className="desktop-only row">
              <button type="button" className="secondary movable-toggle" aria-pressed={movable} onClick={() => setMovable((value) => !value)}>Movable panels</button>
              <button type="button" className="secondary" onClick={() => setLayoutReset((n) => n + 1)}>Reset layout</button>
            </div>
          </div>
        </details>
        </div>
      </CartoonHeader>
      <ProblemBox error={error} />

      <DirectorPanel key={`scenes-${layoutReset}`} title="Scenes" className="director-overview" movable={movable}>
        <DirectorScenes layout={design} scenes={scenes} shots={shots} jobs={jobs} assets={assetsById}
          selectedId={selected?.id} projectId={project.id} timeline={timeline} onTimeline={setTimeline}
          onSelect={(sceneId) => setSearch({ scene: sceneId })} adding={addingScene}
          onAdd={async () => {
            setAddingScene(true); setError(null);
            try {
              const created = await api.createScene(project.id, { title: `Scene ${scenes.length + 1}` });
              setScenes((previous) => [...(previous ?? []), created]);
              await refreshShot(created.id);
              setSearch({ scene: created.id });
              void refreshTimeline().catch(setError);
            } catch (err) { setError(err); }
            finally { setAddingScene(false); }
          }} />
      </DirectorPanel>
      {/* While a new scene is being made the editor still shows the previous one: lock it, so
          typing can never land in (and overwrite) the scene the child has just left. */}
      <div id="director-scene-work" inert={addingScene || undefined} aria-busy={addingScene} className={addingScene ? 'is-switching' : undefined}>
        {selected ? <SceneComposer key={selected.id} scene={selected} projectId={project.id} shot={shots.get(selected.id)} settings={settings}
          jobs={jobs} jobsLoaded={jobsLoaded} assetsById={assetsById} advanced={advanced} movable={movable} layoutReset={layoutReset}
          castList={(cast?.data ?? []).map((c) => ({ id: c.id, name: c.name, lookId: c.look?.id ?? null }))}
          addJob={addJob} onShot={(shot) => setShots((prev) => new Map(prev).set(selected.id, shot))}
          onScene={(updated) => setScenes((prev) => prev?.map((s) => s.id === updated.id ? updated : s) ?? null)}
          afterHero={() => { void refreshTimeline().catch(() => {}); }} refreshSettings={refreshSettings} openStudio={openStudio} />
          : null}
      </div>

      {sheet === 'cast' && (
        <CastSheet projectId={project.id} cast={cast} models={settings?.models ?? []} jobs={jobs} onJob={addJob} refreshCast={refreshCast}
          onClose={() => { setSheet(null); setStudioFor(null); }} advanced={advanced} settingsMessage={settings?.message ?? null} testMode={settings?.test_mode}
          onLookChosen={studioFor && selected ? async (characterId) => {
            // Approval from a scene applies only to that scene; other scenes keep their pinned looks.
            const currentShot = (await director.shots(selected.id)).data[0];
            if (!currentShot) return;
            const currentCast = await director.shotCast(currentShot.id);
            if (currentCast.saved && currentCast.characters.some((c) => c.character_id === characterId)) {
              await director.saveShotCast(currentShot.id, currentCast.characters.map((c) => ({
                character_id: c.character_id, look: c.character_id === characterId ? 'current' : c.look_id ?? 'none', outfit_label: c.outfit_label,
              })), currentCast.version);
            }
            await refreshShot(selected.id);
          } : undefined}
          initialCharacterId={studioFor} returnToScene={studioFor ? selected?.title ?? 'the scene' : null} />
      )}
    </div>
  );
}
