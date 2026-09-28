import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiProblem, type Account, type Project, type Scene } from '../api';
import {
  director, formatPence, isActiveJob, seconds,
  type Asset, type CastList, type GenerationSettings, type Job, type ModelInfo, type ModelTier, type Shot, type Timeline,
} from '../director-api';
import { useJobs } from '../useJobs';
import { uuid } from '../uuid';
import { ProblemBox } from '../components/ProblemBox';
import { CartoonHeader } from '../components/ProjectTabs';
import { sceneLink } from '../sceneState';
import { AssetVideo, TakeImage } from '../components/AssetMedia';
import { CastSheet } from '../components/CastSheet';
import { DirectorScenes } from '../components/DirectorScenes';
import { JobProgress } from '../components/JobProgress';
import { ART_STYLE } from '@storyboard/vocabularies';
import { DirectorPanel } from '../components/DirectorPanel';

const DESIGNS = [
  { id: 'film-strip', name: 'Film Strip' },
  { id: 'scene-board', name: 'Scene Board' },
] as const;
const CLIP_STYLES = [
  ['2d_flat_vector', '2D cartoon'], ['3d_pixar_style', 'Pixar-like 3D'],
  ['anime_ghibli_soft', 'Soft anime'], ['watercolour_storybook', 'Watercolour'], ['claymation_look', 'Clay animation'],
] as const;

/**
 * Director: scenes first, in a film strip or board. The selected scene's style and clip
 * settings sit below. Layout and page colour are independent of the generated art style.
 */
export function Director({ account }: { account: Account }) {
  const { projectId } = useParams<{ projectId: string }>();
  const [search, setSearch] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [shots, setShots] = useState<Map<string, Shot>>(new Map());
  const [settings, setSettings] = useState<GenerationSettings | null>(null);
  const [tiers, setTiers] = useState<ModelInfo[]>([]);
  const [cast, setCast] = useState<CastList | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [media, setMedia] = useState<Asset[]>([]);
  const [sheet, setSheet] = useState<'cast' | null>(null);
  const [error, setError] = useState<unknown>(null);
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
    const result = await director.shots(sceneId);
    const shot = result.data[0];
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
    director.tiers().then((r) => setTiers(r.data)).catch(() => setTiers([]));
    refreshCast().catch(setError);
    refreshTimeline().catch(setError);
    refreshMedia().catch(() => {});
  }, [projectId, refreshSettings, refreshCast, refreshTimeline, refreshMedia]);

  const models = settings?.models ?? [];

  const selected = scenes?.find((s) => s.id === search.get('scene')) ?? scenes?.[0] ?? null;
  const assetsById = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const a of media) map.set(a.id, a);
    for (const j of jobs) for (const a of j.results) map.set(a.id, a);
    return map;
  }, [media, jobs]);

  if (error && !project) return <ProblemBox error={error} />;
  if (!project || !scenes) return <p className="muted">Loading…</p>;

  const needPictures = (cast?.data ?? []).filter((c) => !c.main_reference).length;
  const castWords = !cast ? '…' : cast.never_found ? 'Find your cast' : cast.data.length === 0 ? 'Nobody yet' : needPictures === 0 ? 'All have pictures' : `${needPictures} ${needPictures === 1 ? 'needs' : 'need'} a picture`;

  return (
    <div className={`director-page design-${design}`}>
      <CartoonHeader projectId={project.id} title={project.title} step="make">
        <div className="director-progress"><span>{scenes.filter((scene) => shots.get(scene.id)?.hero_video_asset_id).length} of {scenes.length} scenes in your cartoon</span><progress aria-label="Scenes with clips" value={scenes.filter((scene) => shots.get(scene.id)?.hero_video_asset_id).length} max={Math.max(1, scenes.length)} /></div>
      </CartoonHeader>
      <ProblemBox error={error} />

      <section className="director-view-controls" aria-label="Director appearance">
        <div className="segmented" role="group" aria-label="Layout">
          {DESIGNS.map((item) => <button key={item.id} type="button" className={design === item.id ? 'on' : ''} aria-pressed={design === item.id} onClick={() => {
            setDesign(item.id);
            try { localStorage.setItem('director.design', item.id); } catch { /* Private browsing. */ }
          }}>{item.name}</button>)}
        </div>
        <div className="segmented theme-picker" role="group" aria-label="Colour mode">
          <button type="button" className={theme === 'white' ? 'on' : ''} aria-pressed={theme === 'white'} onClick={() => setTheme('white')}>☀ White</button>
          <button type="button" className={theme === 'black' ? 'on' : ''} aria-pressed={theme === 'black'} onClick={() => setTheme('black')}>☾ Black</button>
        </div>
        <button type="button" className="secondary movable-toggle" aria-pressed={movable} onClick={() => setMovable((value) => !value)}>Movable panels</button>
        {movable && <button type="button" className="secondary" onClick={() => setLayoutReset((n) => n + 1)}>Reset windows</button>}
        <button type="button" className="cast-button compact-cast" onClick={() => setSheet('cast')}>Cast · {castWords} ›</button>
      </section>

      <DirectorPanel key={`scenes-${layoutReset}`} title="Scenes" className="director-overview" movable={movable}>
        <DirectorScenes layout={design} scenes={scenes} shots={shots} jobs={jobs} assets={assetsById}
          selectedId={selected?.id} projectId={project.id} timeline={timeline} onTimeline={setTimeline}
          onSelect={(sceneId) => setSearch({ scene: sceneId })} />
      </DirectorPanel>
      <div id="director-scene-work">
        {selected ? <SceneWork key={selected.id} scene={selected} movable={movable} layoutReset={layoutReset}
          onScene={(updated) => setScenes((prev) => prev?.map((s) => s.id === updated.id ? updated : s) ?? null)}
          projectId={project.id} jobsLoaded={jobsLoaded} shot={shots.get(selected.id)} settings={settings}
          tiers={tiers} jobs={jobs} assetsById={assetsById} addJob={addJob}
          onShot={(shot) => setShots((prev) => new Map(prev).set(selected.id, shot))}
          afterHero={() => { void refreshTimeline().catch(() => {}); }} refreshSettings={refreshSettings} />
          : <p className="notice">Add a scene in <Link to={`/projects/${project.id}`}>Write</Link> first.</p>}
      </div>

      {sheet === 'cast' && (
        <CastSheet projectId={project.id} cast={cast} models={models} jobs={jobs} onJob={addJob} refreshCast={refreshCast}
          onClose={() => setSheet(null)} advanced={advanced} settingsMessage={settings?.message ?? null} />
      )}
    </div>
  );
}

// ── The middle and right columns for one scene ────────────────────────────────

interface WorkProps {
  movable: boolean;
  layoutReset: number;
  onScene: (scene: Scene) => void;
  scene: Scene;
  projectId: string;
  jobsLoaded: boolean;
  shot: Shot | undefined;
  settings: GenerationSettings | null;
  tiers: ModelInfo[];
  jobs: Job[];
  assetsById: Map<string, Asset>;
  addJob: (job: Job) => void;
  onShot: (shot: Shot) => void;
  afterHero: () => void;
  refreshSettings: () => Promise<void>;
}

const TIER_ORDER: ModelTier[] = ['low', 'medium', 'high'];
const TIER_WORDS: Record<ModelTier, string> = { low: 'Low cost', medium: 'Medium', high: 'High' };

function SceneWork({ scene, projectId, jobsLoaded, shot, settings, tiers, jobs, assetsById, addJob, onShot, afterHero, refreshSettings, onScene, movable, layoutReset }: WorkProps) {
  const [tier, setTier] = useState<ModelTier>('low');
  const [duration, setDuration] = useState<number | null>(5);
  const [audio, setAudio] = useState(false);
  const [quote, setQuote] = useState<{ key: string; text: string; parts: number[] | null } | null>(null);
  const [estimateFailed, setEstimateFailed] = useState(false);
  const [quoteAttempt, setQuoteAttempt] = useState(0);
  const starting = useRef(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveNote, setSaveNote] = useState('');
  const [askingNote, setAskingNote] = useState(false);
  const [note, setNote] = useState('');
  const [pickedClip, setPickedClip] = useState<string | null>(null);


  // The clip maker for the chosen cost level. Low is the default; if it is missing, the cheapest there is.
  const available = useMemo(() => TIER_ORDER.filter((t) => tiers.some((m) => m.tier === t)), [tiers]);
  const model = useMemo(() => tiers.find((m) => m.tier === tier) ?? tiers.find((m) => m.tier === available[0]) ?? null, [tiers, tier, available]);
  const quoteKey = `${model?.id}:${duration}`;
  const estimate = quote?.key === quoteKey ? quote.text : null;
  useEffect(() => { const first = available[0]; if (first && !available.includes(tier)) setTier(first); }, [available, tier]);

  // Keep the duration inside what the chosen clip maker can do (DM-4).
  useEffect(() => {
    const d = model?.duration_seconds;
    if (!d) { setDuration(null); return; }
    setDuration((prev) => prev !== null && [5, 10, 15, 30].includes(prev) ? prev : 5);
    if (!model?.capabilities.audio) setAudio(false);
  }, [model]);

  // The estimate comes from the server so it always matches what will be reserved (DM-14).
  useEffect(() => {
    setQuote(null);
    setEstimateFailed(false);
    if (!model) return;
    let alive = true;
    director.estimate(model.id, { duration_seconds: duration ?? undefined })
      .then((r) => { if (alive) setQuote({ key: quoteKey, text: formatPence(r.pence), parts: r.parts }); })
      .catch(() => { if (alive) setEstimateFailed(true); });
    return () => { alive = false; };
  }, [model, duration, quoteKey, quoteAttempt]);

  // After a 402, keep the button off until the allowance shows money again.
  useEffect(() => {
    if (!blocked) return;
    const timer = setInterval(() => void refreshSettings(), 30_000);
    return () => clearInterval(timer);
  }, [blocked, refreshSettings]);
  useEffect(() => {
    if (blocked && settings && Math.min(settings.allowance.remaining_today_pence, settings.allowance.remaining_this_month_pence) > 0) setBlocked(null);
  }, [settings, blocked]);

  const videoJobs = shot ? jobs.filter((j) => j.target_entity_type === 'shot' && j.target_entity_id === shot.id && j.kind === 'video') : [];
  const enabled = Boolean(settings?.enabled);

  async function chooseStyle(style: string) {
    if (!shot || busy) return;
    setBusy(true);
    setSaveNote('Saving…'); setError(null);
    try {
      const updated = await api.updateScene(scene.id, { art_style: style }, scene.version);
      onScene(updated);
      const result = await director.shots(scene.id);
      if (result.data[0]) onShot(result.data[0]);
      setSaveNote('Style saved for this scene');
    } catch (err) {
      setSaveNote('');
      if (err instanceof ApiProblem && err.problem.status === 409 && err.problem.current_state) onScene(err.problem.current_state as Scene);
      setError(err);
    } finally { setBusy(false); }
  }

  async function start(withNote?: string) {
    if (!shot || !model || !canMake || starting.current) return;
    starting.current = true;
    setBusy(true); setError(null);
    try {
      const job = await director.startJob(shot.id, {
        kind: 'video', model_id: model.id, duration_seconds: duration ?? undefined, audio,
        ...(withNote?.trim() ? { note: withNote.trim() } : {}),
      }, uuid());
      addJob(job);
      setAskingNote(false); setNote('');
      void refreshSettings();
    } catch (err) {
      if (err instanceof ApiProblem && err.problem.status === 402) setBlocked(err.problem.detail);
      setError(err);
    } finally { starting.current = false; setBusy(false); }
  }

  async function useInstead(asset: Asset) {
    if (!shot) return;
    setBusy(true); setError(null);
    try {
      onShot(await director.pickHero(shot.id, asset.id));
      afterHero();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const clips = videoJobs.flatMap((j) => j.results);
  const heroId = shot?.hero_video_asset_id ?? null;
  const hero = heroId ? assetsById.get(heroId) ?? clips.find((a) => a.id === heroId) ?? null : null;
  const playing = clips.find((a) => a.id === pickedClip) ?? hero ?? clips[0] ?? null;
  const anyActive = videoJobs.some(isActiveJob);
  const notReady = !shot || !enabled || busy || Boolean(blocked) || anyActive || !jobsLoaded;
  const canMake = !notReady && Boolean(model) && Boolean(shot?.compiled_prompt) && Boolean(scene.description.trim()) && estimate !== null;

  return (
    <div className="director-work">
      <DirectorPanel key={`settings-${layoutReset}`} title="Clip settings" className="director-main" movable={movable}>
        <header className="work-head">
          <h3>Scene {scene.scene_number} · {scene.title}</h3>
        </header>

        {settings && !settings.enabled && <p className="notice">{settings.message ?? 'Clip makers are not set up yet. Ask a grown-up to add a key.'}</p>}
        <ProblemBox error={error} />

        <section className="card step-card">
          <div className="scene-story">
          <h4>Your scene</h4>
          <p className="scene-summary">{scene.description || 'Describe what happens before making a clip.'}</p>
          <Link className="btn secondary" to={sceneLink(projectId, scene.id, 'make')}>← Write this scene</Link>
          <div className="field">
            <span className="label-text">Choose a clip style</span>
            <div className="clip-styles" role="group" aria-label="Clip style">
              {CLIP_STYLES.map(([value, label]) => <button key={value} type="button"
                className={`style-card style-${value}`} aria-pressed={scene.art_style === value || (!scene.art_style && shot?.compiled_prompt.startsWith(ART_STYLE.find((s) => s.value === value)!.prompt_phrase))}
                disabled={!shot || busy || anyActive || shot.prompt_locked} onClick={() => void chooseStyle(value)}>
                <span className="style-swatch" aria-hidden="true">●</span><span>{label}</span>
              </button>)}
            </div>
            {shot?.prompt_locked && <p className="hint">Unlock this scene’s instructions before changing its style.</p>}
            <p className="save-state" aria-live="polite">{saveNote}</p>
          </div>
          <details className="prompt-details">
            <summary>See the clip instructions</summary>
            <p className="prompt-box">{shot?.compiled_prompt || 'Write what happens in this scene first.'}</p>
          </details>

          </div>
          <div className="scene-controls">
          <div className="field">
            <span className="label-text">How much to spend?</span>
            {tiers.length === 0 ? (
              <p className="hint">{settings?.message ?? 'No clip makers are set up yet. Ask a grown-up.'}</p>
            ) : (
              <>
                <div className="segmented tiers" role="group" aria-label="How much to spend?">
                  {available.map((t) => {
                    const m = tiers.find((x) => x.tier === t)!;
                    const on = model?.tier === t;
                    return (
                      <button key={t} type="button" className={on ? 'on' : ''} aria-pressed={on} onClick={() => setTier(t)}>
                        <span className="tier-name">{TIER_WORDS[t]}</span>
                        <span className="tier-price">{formatPence(m.unit_cost_pence)} a second</span>
                      </button>
                    );
                  })}
                </div>
                {model?.help && <p className="hint">{model.help}</p>}
              </>
            )}
          </div>

          {model?.duration_seconds && (
            <div className="field">
              <span className="label-text">How long?</span>
              <p className="hint">Longer clips cost more.</p>
              <div className="segmented" role="group" aria-label="How long?">
                {[5, 10, 15, 30].map((n) => (
                  <button key={n} type="button" className={duration === n ? 'on' : ''} aria-pressed={duration === n} onClick={() => setDuration(n)}>{n} seconds</button>
                ))}
              </div>
              {quote?.key === quoteKey && quote.parts && <p className="hint">
                {quote.parts.length > 1 ? `${quote.parts.length} shorter clips joined together; cuts may be visible. ` : ''}
                {quote.parts.reduce((sum, n) => sum + n, 0) !== duration ? `The price includes ${quote.parts.reduce((sum, n) => sum + n, 0)} generated seconds, trimmed to ${duration} seconds.` : ''}
              </p>}
            </div>
          )}

          {model?.capabilities.audio && (
            <div className="toggle-row">
              <div>
                <span className="label-text">Add sounds?</span>
                <p className="hint">Waves, footsteps, a bounce. Music comes later, when you put it together.</p>
              </div>
              <button type="button" role="switch" aria-checked={audio} className={`switch${audio ? ' on' : ''}`} onClick={() => setAudio((v) => !v)} aria-label="Add sounds">
                <span className="knob" aria-hidden="true" />
              </button>
            </div>
          )}

          <div className="go-row">
            <button type="button" onClick={() => void start()} disabled={!canMake}>
              {busy && <span className="ai-spinner" aria-hidden="true" />}{anyActive ? 'Making your clip…' : 'Make it move'}
            </button>
            <p className="hint go-cost">
              {blocked ? blocked : <>{estimate && duration && <>About {estimate} for {duration} seconds. </>}{settings?.allowance_words}</>}
            </p>
          </div>
          {anyActive && <p className="hint" role="status">You can work on another scene while this clip is being made.</p>}
          {enabled && model && estimate === null && <div className="hint" role="status">
            {estimateFailed ? <>We could not check the price. <button type="button" className="secondary" onClick={() => setQuoteAttempt((n) => n + 1)}>Check price again</button></> : 'Checking the price…'}
          </div>}
          </div>
        </section>
      </DirectorPanel>

      <DirectorPanel key={`clips-${layoutReset}`} title="Your clips" className="director-right" movable={movable}>
        <h4>Your clips</h4>
        {videoJobs.length === 0 && <p className="hint">No clips yet. Press Make it move.</p>}
        <div className="takes">
          {videoJobs.map((job) => (
            <div key={job.id} className="take-job">
              {isActiveJob(job) && <JobProgress job={job} what="clip" />}
              {job.status === 'failed' && <p className="problem-inline">{job.error ?? 'That did not work. Try again.'}</p>}
              {job.status === 'cancelled' && <p className="hint">Stopped.</p>}
              {job.held_back > 0 && <p className="hint">{job.held_back === 1 ? '1 clip was' : `${job.held_back} clips were`} held back by the safety checker.</p>}
              {job.results.length > 0 && (
                <div className="take-grid">
                  {job.results.map((a) => {
                    const isHero = a.id === heroId;
                    const isPlaying = playing?.id === a.id;
                    return (
                      <button key={a.id} type="button" className={`take-tile${isHero ? ' hero' : ''}${isPlaying ? ' picked' : ''}`} onClick={() => setPickedClip(a.id)} aria-pressed={isPlaying} aria-label={isHero ? 'The clip in your cartoon' : 'A clip'}>
                        <TakeImage asset={a} alt="" />
                        {isHero && <span className="take-tag">In your cartoon</span>}
                        {a.duration_ms ? <span className="take-secs">{seconds(a.duration_ms)}</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        {playing && <AssetVideo url={playing.url} poster={playing.poster_url} className="clip-player" />}
        {clips.length > 0 && (
          <div className="row take-actions">
            {playing && playing.id !== heroId && (
              <button type="button" disabled={busy || playing.review_status === 'rejected'} onClick={() => void useInstead(playing)}>Use this one instead</button>
            )}
            <button type="button" className="secondary" disabled={!canMake || anyActive} onClick={() => setAskingNote(true)}>Try again</button>
          </div>
        )}
        {askingNote && (
          <div className="try-again">
            <label htmlFor="try-note">What should be different this time?</label>
            <input id="try-note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="Example: closer to the sea" />
            <div className="row">
              <button type="button" disabled={!canMake} onClick={() => void start(note)}>Make another clip{estimate ? ` · about ${estimate}` : ''}</button>
              <button type="button" className="secondary" onClick={() => setAskingNote(false)}>Cancel</button>
            </div>
          </div>
        )}
      </DirectorPanel>
    </div>
  );
}
