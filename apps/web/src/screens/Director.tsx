import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiProblem, type Account, type Project, type Scene } from '../api';
import {
  director, formatPence, isActiveJob, seconds,
  type Asset, type CastList, type GenerationSettings, type Job, type ModelInfo, type ModelTier, type Shot, type Timeline,
} from '../director-api';
import { useJobs } from '../useJobs';
import { uuid } from '../uuid';
import { ProblemBox } from '../components/ProblemBox';
import { ProjectTabs } from '../components/ProjectTabs';
import { AssetImage, AssetVideo, TakeImage } from '../components/AssetMedia';
import { CastSheet } from '../components/CastSheet';
import { CartoonStrip } from '../components/CartoonStrip';
import { JobProgress } from '../components/JobProgress';

type SceneState = 'nothing' | 'making' | 'done';
const STATE_WORDS: Record<SceneState, string> = { nothing: 'Nothing yet', making: 'Making…', done: 'In the cartoon' };

function sceneState(shot: Shot | undefined, jobs: Job[]): SceneState {
  if (shot && jobs.some((j) => j.target_entity_type === 'shot' && j.target_entity_id === shot.id && isActiveJob(j))) return 'making';
  if (shot?.hero_video_asset_id) return 'done';
  return 'nothing';
}

/**
 * Director (plan D38, §6): one screen. Scenes down the left, the clip settings in the
 * middle, clips on the right, the whole cartoon along the bottom. A scene goes straight
 * from its words to a clip. Nothing here edits the story; it only reads it.
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

  const { jobs, add: addJob } = useJobs(projectId, onSettled);

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
    <>
      <header className="project-head director-head">
        <div>
          <h2>{project.title}</h2>
          <p className="hint">Makes your storyboard into a cartoon, one scene at a time.</p>
        </div>
        <ProjectTabs projectId={project.id} />
      </header>
      <ProblemBox error={error} />

      <div className="director">
        <aside className="director-left">
          <button type="button" className="cast-button" onClick={() => setSheet('cast')}>
            <span className="cast-pile" aria-hidden="true">
              {(cast?.data ?? []).slice(0, 3).map((c) => c.main_reference
                ? <AssetImage key={c.id} url={c.main_reference.url} alt="" className="cast-face" />
                : <span key={c.id} className="cast-face none">?</span>)}
              {(cast?.data.length ?? 0) === 0 && <span className="cast-face none">?</span>}
            </span>
            <span className="cast-label">Cast</span>
            <span className="hint">{castWords}</span>
          </button>
          <p className="eyebrow">Scenes</p>
          {scenes.length === 0 && <p className="hint">No scenes yet. Add some in Story.</p>}
          <ul className="scene-buttons">
            {scenes.map((scene) => {
              const state = sceneState(shots.get(scene.id), jobs);
              const active = selected?.id === scene.id;
              return (
                <li key={scene.id}>
                  <button type="button" className={`scene-button${active ? ' active' : ''}`} onClick={() => setSearch({ scene: scene.id })} aria-current={active ? 'true' : undefined}>
                    <span className="scene-number">{scene.scene_number}</span>
                    <span className="scene-button-text">
                      <span className="scene-button-title">{scene.title}</span>
                      <span className={`scene-state ${state}`}><span className="state-dot" aria-hidden="true" />{STATE_WORDS[state]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {selected ? (
          <SceneWork
            key={selected.id}
            scene={selected}
            shot={shots.get(selected.id)}
            settings={settings}
            tiers={tiers}
            jobs={jobs}
            assetsById={assetsById}
            addJob={addJob}
            onShot={(shot) => setShots((prev) => new Map(prev).set(selected.id, shot))}
            afterHero={() => { void refreshTimeline().catch(() => {}); }}
            refreshSettings={refreshSettings}
          />
        ) : (
          <div className="director-main card"><p className="muted">Add a scene in <Link to={`/projects/${project.id}`}>Story</Link> first, then come back here to make it.</p></div>
        )}
      </div>

      <CartoonStrip projectId={project.id} timeline={timeline} onTimeline={setTimeline} />

      {sheet === 'cast' && (
        <CastSheet projectId={project.id} cast={cast} models={models} jobs={jobs} onJob={addJob} refreshCast={refreshCast}
          onClose={() => setSheet(null)} advanced={advanced} settingsMessage={settings?.message ?? null} />
      )}
    </>
  );
}

// ── The middle and right columns for one scene ────────────────────────────────

interface WorkProps {
  scene: Scene;
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

function SceneWork({ scene, shot, settings, tiers, jobs, assetsById, addJob, onShot, afterHero, refreshSettings }: WorkProps) {
  const [tier, setTier] = useState<ModelTier>('low');
  const [addendum, setAddendum] = useState(shot?.user_prompt_addendum ?? '');
  const [duration, setDuration] = useState<number | null>(null);
  const [audio, setAudio] = useState(false);
  const [estimate, setEstimate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveNote, setSaveNote] = useState('');
  const [askingNote, setAskingNote] = useState(false);
  const [note, setNote] = useState('');
  const [pickedClip, setPickedClip] = useState<string | null>(null);

  useEffect(() => { setAddendum(shot?.user_prompt_addendum ?? ''); }, [shot?.id, shot?.user_prompt_addendum]);

  // The clip maker for the chosen cost level. Low is the default; if it is missing, the cheapest there is.
  const available = useMemo(() => TIER_ORDER.filter((t) => tiers.some((m) => m.tier === t)), [tiers]);
  const model = useMemo(() => tiers.find((m) => m.tier === tier) ?? tiers.find((m) => m.tier === available[0]) ?? null, [tiers, tier, available]);
  useEffect(() => { const first = available[0]; if (first && !available.includes(tier)) setTier(first); }, [available, tier]);

  // Keep the duration inside what the chosen clip maker can do (DM-4).
  useEffect(() => {
    const d = model?.duration_seconds;
    if (!d) { setDuration(null); return; }
    setDuration((prev) => (prev !== null && prev >= d.min && prev <= d.max && (prev - d.min) % d.step === 0 ? prev : Math.min(d.max, Math.max(d.min, 5 - ((5 - d.min) % d.step)))));
    if (!model?.capabilities.audio) setAudio(false);
  }, [model]);

  // The estimate comes from the server so it always matches what will be reserved (DM-14).
  useEffect(() => {
    if (!model) { setEstimate(null); return; }
    let alive = true;
    director.estimate(model.id, { duration_seconds: duration ?? undefined })
      .then((r) => { if (alive) setEstimate(formatPence(r.pence)); })
      .catch(() => { if (alive) setEstimate(null); });
    return () => { alive = false; };
  }, [model, duration]);

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

  async function saveAddendum() {
    if (!shot || addendum === shot.user_prompt_addendum) return;
    setSaveNote('Saving…'); setError(null);
    try {
      onShot(await director.updateShot(shot.id, { user_prompt_addendum: addendum }, shot.version));
      setSaveNote('Saved');
    } catch (err) {
      setSaveNote('');
      if (err instanceof ApiProblem && err.problem.status === 409 && err.problem.current_state) {
        onShot(err.problem.current_state as Shot);
      }
      setError(err);
    }
  }

  async function start(withNote?: string) {
    if (!shot || !model) return;
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
    } finally { setBusy(false); }
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
  const notReady = !shot || !enabled || busy || Boolean(blocked);
  const canMake = !notReady && Boolean(model) && Boolean(shot?.compiled_prompt);

  return (
    <div className="director-work">
      <div className="director-main">
        <header className="work-head">
          <h3>Scene {scene.scene_number} · {scene.title}</h3>
        </header>

        {settings && !settings.enabled && <p className="notice">{settings.message ?? 'Clip makers are not set up yet. Ask a grown-up to add a key.'}</p>}
        <ProblemBox error={error} />

        <section className="card step-card">
          <h4>What the clip maker will be told</h4>
          <p className="hint">Made from your scene and your cast. To change it, edit the scene in <b>Story</b>.</p>
          <p className="prompt-box">{shot?.compiled_prompt || 'Write what happens in this scene first, in Story.'}</p>
          <label htmlFor="addendum">Anything to add?</label>
          <input id="addendum" value={addendum} maxLength={400} onChange={(e) => { setAddendum(e.target.value); setSaveNote(''); }} onBlur={() => void saveAddendum()} placeholder="Example: make the ball really big" disabled={!shot} />
          <p className="save-state" aria-live="polite">{saveNote}</p>

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
                {durations(model.duration_seconds).map((n) => (
                  <button key={n} type="button" className={duration === n ? 'on' : ''} aria-pressed={duration === n} onClick={() => setDuration(n)}>{n} seconds</button>
                ))}
              </div>
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
              {busy && <span className="ai-spinner" aria-hidden="true" />}Make it move
            </button>
            <p className="hint go-cost">
              {blocked ? blocked : <>{estimate && duration && <>About {estimate} for {duration} seconds. </>}{settings?.allowance_words}</>}
            </p>
          </div>
        </section>
      </div>

      <aside className="director-right">
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
              <button type="button" disabled={!canMake} onClick={() => void start(note)}>Go</button>
              <button type="button" className="secondary" onClick={() => setAskingNote(false)}>Cancel</button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function durations(d: { min: number; max: number; step: number }) {
  const out: number[] = [];
  for (let n = d.min; n <= d.max; n += Math.max(1, d.step)) out.push(n);
  return out;
}
