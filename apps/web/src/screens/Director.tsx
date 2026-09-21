import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiProblem, type Account, type Project, type Scene } from '../api';
import {
  director, formatPence, isActiveJob, seconds,
  type AspectRatio, type Asset, type CastList, type GenerationSettings, type Job, type ModelInfo, type Shot, type Timeline,
} from '../director-api';
import { useJobs } from '../useJobs';
import { uuid } from '../uuid';
import { ProblemBox } from '../components/ProblemBox';
import { ProjectTabs } from '../components/ProjectTabs';
import { AssetImage, AssetVideo, TakeImage } from '../components/AssetMedia';
import { ModelCard, ModelPicker } from '../components/ModelPicker';
import { CastSheet } from '../components/CastSheet';
import { CartoonStrip } from '../components/CartoonStrip';
import { JobProgress } from '../components/JobProgress';

type SceneState = 'nothing' | 'sketch' | 'picture' | 'moving';
const STATE_WORDS: Record<SceneState, string> = { nothing: 'Nothing yet', sketch: 'Sketch only', picture: 'Picture', moving: 'Moving' };

function sceneState(scene: Scene, shot: Shot | undefined): SceneState {
  if (shot?.hero_video_asset_id) return 'moving';
  if (shot?.hero_asset_id) return 'picture';
  if (scene.thumbnail) return 'sketch';
  return 'nothing';
}

/**
 * Director (plan D38, §6): one screen. Scenes down the left, the current step in the
 * middle, takes on the right, the whole cartoon along the bottom. Nothing here edits the
 * story; it only reads it.
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
  const [sheet, setSheet] = useState<'cast' | 'pick-image' | 'pick-video' | null>(null);
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  const [videoModelId, setVideoModelId] = useState<string | null>(null);
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
    refreshCast().catch(setError);
    refreshTimeline().catch(setError);
    refreshMedia().catch(() => {});
  }, [projectId, refreshSettings, refreshCast, refreshTimeline, refreshMedia]);

  const models = settings?.models ?? [];
  const castHasPictures = (cast?.data ?? []).some((c) => c.main_reference);
  const imageModel = useMemo(() => pickDefault(models, 'image', imageModelId, castHasPictures), [models, imageModelId, castHasPictures]);
  const videoModel = useMemo(() => pickDefault(models, 'video', videoModelId, false), [models, videoModelId]);

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
              const state = sceneState(scene, shots.get(scene.id));
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
            imageModel={imageModel}
            videoModel={videoModel}
            advanced={advanced}
            jobs={jobs}
            assetsById={assetsById}
            addJob={addJob}
            onShot={(shot) => setShots((prev) => new Map(prev).set(selected.id, shot))}
            afterHero={() => { void refreshTimeline().catch(() => {}); }}
            openPicker={(kind) => setSheet(kind === 'image' ? 'pick-image' : 'pick-video')}
            refreshSettings={refreshSettings}
          />
        ) : (
          <div className="director-main card"><p className="muted">Add a scene in <Link to={`/projects/${project.id}`}>Story</Link> first, then come back here to make it.</p></div>
        )}
      </div>

      <CartoonStrip projectId={project.id} timeline={timeline} onTimeline={setTimeline} />

      {sheet === 'pick-image' && (
        <ModelPicker models={models} kind="image" selectedId={imageModel?.id ?? null} advanced={advanced} message={settings?.message}
          onPick={(m) => setImageModelId(m.id)} onClose={() => setSheet(null)} />
      )}
      {sheet === 'pick-video' && (
        <ModelPicker models={models} kind="video" selectedId={videoModel?.id ?? null} advanced={advanced} message={settings?.message}
          onPick={(m) => setVideoModelId(m.id)} onClose={() => setSheet(null)} />
      )}
      {sheet === 'cast' && (
        <CastSheet projectId={project.id} cast={cast} models={models} jobs={jobs} onJob={addJob} refreshCast={refreshCast}
          onClose={() => setSheet(null)} advanced={advanced} settingsMessage={settings?.message ?? null} />
      )}
    </>
  );
}

/** Default model: the cheapest enabled one of its kind, preferring one that can use cast pictures when there are any. */
function pickDefault(models: ModelInfo[], kind: 'image' | 'video', chosenId: string | null, preferReferences: boolean): ModelInfo | null {
  const ofKind = models.filter((m) => m.kind === kind);
  const chosen = ofKind.find((m) => m.id === chosenId);
  if (chosen) return chosen;
  const cheapest = [...ofKind].sort((a, b) => a.unit_cost_pence - b.unit_cost_pence);
  if (preferReferences) {
    const withRefs = cheapest.find((m) => m.capabilities.reference_images);
    if (withRefs) return withRefs;
  }
  return cheapest[0] ?? null;
}

// ── The middle and right columns for one scene ────────────────────────────────

interface WorkProps {
  scene: Scene;
  shot: Shot | undefined;
  settings: GenerationSettings | null;
  imageModel: ModelInfo | null;
  videoModel: ModelInfo | null;
  advanced: boolean;
  jobs: Job[];
  assetsById: Map<string, Asset>;
  addJob: (job: Job) => void;
  onShot: (shot: Shot) => void;
  afterHero: () => void;
  openPicker: (kind: 'image' | 'video') => void;
  refreshSettings: () => Promise<void>;
}

const SHAPES: { value: AspectRatio; label: string }[] = [{ value: '16:9', label: 'Wide' }, { value: '9:16', label: 'Tall' }, { value: '1:1', label: 'Square' }];

function SceneWork({ scene, shot, settings, imageModel, videoModel, advanced, jobs, assetsById, addJob, onShot, afterHero, openPicker, refreshSettings }: WorkProps) {
  const canMove = Boolean(shot?.hero_asset_id) || Boolean(videoModel?.capabilities.text_to_video);
  const [step, setStep] = useState<1 | 2>(shot?.hero_asset_id ? 2 : 1);
  const [addendum, setAddendum] = useState(shot?.user_prompt_addendum ?? '');
  const [shape, setShape] = useState<AspectRatio>('16:9');
  const [count, setCount] = useState(1);
  const [duration, setDuration] = useState<number | null>(null);
  const [audio, setAudio] = useState(false);
  const [estimate, setEstimate] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveNote, setSaveNote] = useState('');
  const [noteFor, setNoteFor] = useState<'image' | 'video' | null>(null);
  const [note, setNote] = useState('');
  const [pickedTake, setPickedTake] = useState<string | null>(null);

  useEffect(() => { setAddendum(shot?.user_prompt_addendum ?? ''); }, [shot?.id, shot?.user_prompt_addendum]);

  // Keep the shape and the duration inside what the chosen model can do (DM-4).
  useEffect(() => {
    if (imageModel && !imageModel.aspect_ratios.includes(shape)) setShape(imageModel.aspect_ratios[0] ?? '16:9');
  }, [imageModel, shape]);
  useEffect(() => {
    const d = videoModel?.duration_seconds;
    if (!d) { setDuration(null); return; }
    setDuration((prev) => (prev !== null && prev >= d.min && prev <= d.max && (prev - d.min) % d.step === 0 ? prev : Math.min(d.max, Math.max(d.min, 5 - ((5 - d.min) % d.step)))));
    if (!videoModel?.capabilities.audio) setAudio(false);
  }, [videoModel]);

  // The estimate comes from the server so it always matches what will be reserved (DM-14).
  useEffect(() => {
    const model = step === 1 ? imageModel : videoModel;
    if (!model) { setEstimate(null); return; }
    let alive = true;
    director.estimate(model.id, step === 1 ? { count } : { duration_seconds: duration ?? undefined })
      .then((r) => { if (alive) setEstimate(formatPence(r.pence)); })
      .catch(() => { if (alive) setEstimate(null); });
    return () => { alive = false; };
  }, [step, imageModel, videoModel, count, duration]);

  // After a 402, keep the button off until the allowance shows money again.
  useEffect(() => {
    if (!blocked) return;
    const timer = setInterval(() => void refreshSettings(), 30_000);
    return () => clearInterval(timer);
  }, [blocked, refreshSettings]);
  useEffect(() => {
    if (blocked && settings && Math.min(settings.allowance.remaining_today_pence, settings.allowance.remaining_this_month_pence) > 0) setBlocked(null);
  }, [settings, blocked]);

  const myJobs = shot ? jobs.filter((j) => j.target_entity_type === 'shot' && j.target_entity_id === shot.id) : [];
  const imageJobs = myJobs.filter((j) => j.kind === 'image');
  const videoJobs = myJobs.filter((j) => j.kind === 'video');
  const heroPicture = shot?.hero_asset_id ? assetsById.get(shot.hero_asset_id) ?? null : null;
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

  async function start(kind: 'image' | 'video', withNote?: string) {
    const model = kind === 'image' ? imageModel : videoModel;
    if (!shot || !model) return;
    setBusy(true); setError(null);
    try {
      const job = await director.startJob(shot.id, {
        kind, model_id: model.id,
        ...(kind === 'image' ? { aspect_ratio: shape, count } : { duration_seconds: duration ?? undefined, audio }),
        ...(withNote?.trim() ? { note: withNote.trim() } : {}),
      }, uuid());
      addJob(job);
      setNoteFor(null); setNote('');
      void refreshSettings();
    } catch (err) {
      if (err instanceof ApiProblem && err.problem.status === 402) setBlocked(err.problem.detail);
      setError(err);
    } finally { setBusy(false); }
  }

  async function useThisOne(asset: Asset) {
    if (!shot) return;
    setBusy(true); setError(null);
    try {
      const updated = await director.pickHero(shot.id, asset.id);
      onShot(updated);
      afterHero();
      if (!asset.mime_type.startsWith('video/')) setStep(2);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const takes = (list: Job[]) => list.flatMap((j) => j.results);
  const currentTakes = step === 1 ? takes(imageJobs) : takes(videoJobs);
  const heroId = step === 1 ? shot?.hero_asset_id : shot?.hero_video_asset_id;
  const picked = currentTakes.find((a) => a.id === pickedTake) ?? currentTakes.find((a) => a.id !== heroId) ?? null;
  const pickedVideo = step === 2 ? currentTakes.find((a) => a.id === (pickedTake ?? heroId)) ?? picked : null;
  const anyActive = (step === 1 ? imageJobs : videoJobs).some(isActiveJob);
  const notReady = !shot || !enabled || busy || Boolean(blocked);

  return (
    <div className="director-work">
      <div className="director-main">
        <header className="work-head">
          <h3>Scene {scene.scene_number} · {scene.title}</h3>
          <div className="steps" role="tablist" aria-label="Steps">
            <button type="button" role="tab" aria-selected={step === 1} className={`step-pill${step === 1 ? ' active' : ''}`} onClick={() => setStep(1)}><span className="step-n">1</span>Make a picture</button>
            <button type="button" role="tab" aria-selected={step === 2} className={`step-pill${step === 2 ? ' active' : ''}`} onClick={() => setStep(2)} disabled={!canMove} title={canMove ? undefined : 'Pick a picture first'}><span className="step-n">2</span>Make it move</button>
          </div>
        </header>

        {settings && !settings.enabled && <p className="notice">{settings.message ?? 'Picture makers are not set up yet. Ask a grown-up to add a key.'}</p>}
        <ProblemBox error={error} />

        {step === 1 ? (
          <section className="card step-card">
            <h4>What the picture maker will be told</h4>
            <p className="hint">Made from your scene and your cast. To change it, edit the scene in <b>Story</b>.</p>
            <p className="prompt-box">{shot?.compiled_prompt || 'Write what happens in this scene first, in Story.'}</p>
            <label htmlFor="addendum">Anything to add?</label>
            <input id="addendum" value={addendum} maxLength={400} onChange={(e) => { setAddendum(e.target.value); setSaveNote(''); }} onBlur={() => void saveAddendum()} placeholder="Example: make the ball really big" disabled={!shot} />
            <p className="save-state" aria-live="polite">{saveNote}</p>

            <ModelCard model={imageModel} advanced={advanced} onChange={() => openPicker('image')} />

            <div className="settings-row">
              <div>
                <span className="label-text">Shape</span>
                <div className="segmented" role="group" aria-label="Shape">
                  {SHAPES.filter((s) => !imageModel || imageModel.aspect_ratios.includes(s.value)).map((s) => (
                    <button key={s.value} type="button" className={shape === s.value ? 'on' : ''} aria-pressed={shape === s.value} onClick={() => setShape(s.value)}>{s.label}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="label-text">How many</span>
                <div className="segmented" role="group" aria-label="How many">
                  {[1, 2, 4].map((n) => <button key={n} type="button" className={count === n ? 'on' : ''} aria-pressed={count === n} onClick={() => setCount(n)}>{n}</button>)}
                </div>
              </div>
            </div>

            <div className="go-row">
              <button type="button" onClick={() => void start('image')} disabled={notReady || !imageModel || !shot?.compiled_prompt}>
                {busy && <span className="ai-spinner" aria-hidden="true" />}Make a picture
              </button>
              <p className="hint go-cost">
                {blocked ? blocked : <>{estimate && <>About {estimate} for {count}. </>}{settings?.allowance_words}</>}
              </p>
            </div>
          </section>
        ) : (
          <section className="card step-card">
            <div className="start-from">
              <span className="take-still small">
                {heroPicture ? <AssetImage url={heroPicture.url} alt="The picture you picked" /> : <span className="asset-placeholder">Your picture</span>}
              </span>
              <div>
                <h4>Your picture starts moving</h4>
                <p className="hint">{heroPicture
                  ? 'The clip begins with the picture you picked in step 1. The picture maker works out what happens next from your scene.'
                  : 'No picture is picked yet, so the clip is made from your scene words alone.'}</p>
              </div>
            </div>

            <ModelCard model={videoModel} advanced={advanced} onChange={() => openPicker('video')} />

            {videoModel?.duration_seconds && (
              <div className="field">
                <span className="label-text">How long should it play?</span>
                <p className="hint">5 seconds is about right for one thing happening. Longer clips cost more.</p>
                <div className="segmented" role="group" aria-label="How long">
                  {durations(videoModel.duration_seconds).map((n) => (
                    <button key={n} type="button" className={duration === n ? 'on' : ''} aria-pressed={duration === n} onClick={() => setDuration(n)}>{n} seconds</button>
                  ))}
                </div>
              </div>
            )}

            {videoModel?.capabilities.audio && (
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
              <button type="button" onClick={() => void start('video')} disabled={notReady || !videoModel}>
                {busy && <span className="ai-spinner" aria-hidden="true" />}Make it move
              </button>
              <p className="hint go-cost">
                {blocked ? blocked : <>{estimate && duration && <>About {estimate} for {duration} seconds. </>}{settings?.allowance_words}</>}
              </p>
            </div>
          </section>
        )}
      </div>

      <aside className="director-right">
        <h4>{step === 1 ? 'Your takes' : 'Your clips'}</h4>
        {(step === 1 ? imageJobs : videoJobs).length === 0 && <p className="hint">{step === 1 ? 'Nothing made yet. Press Make a picture.' : 'No clips yet. Press Make it move.'}</p>}
        <div className="takes">
          {(step === 1 ? imageJobs : videoJobs).map((job) => (
            <div key={job.id} className="take-job">
              {isActiveJob(job) && <JobProgress job={job} what={step === 1 ? 'picture' : 'clip'} />}
              {job.status === 'failed' && <p className="problem-inline">{job.error ?? 'That did not work. Try again.'}</p>}
              {job.status === 'cancelled' && <p className="hint">Stopped.</p>}
              {job.held_back > 0 && <p className="hint">{job.held_back === 1 ? '1 picture was' : `${job.held_back} pictures were`} held back by the safety checker.</p>}
              {job.results.length > 0 && (
                <div className="take-grid">
                  {job.results.map((a) => {
                    const isHero = a.id === heroId;
                    const isPicked = picked?.id === a.id || (step === 2 && pickedVideo?.id === a.id);
                    return (
                      <button key={a.id} type="button" className={`take-tile${isHero ? ' hero' : ''}${isPicked ? ' picked' : ''}`} onClick={() => setPickedTake(a.id)} aria-pressed={isPicked} aria-label={isHero ? 'Your picked take' : 'A take'}>
                        <TakeImage asset={a} alt="" />
                        {isHero && <span className="take-tag">Picked</span>}
                        {a.duration_ms ? <span className="take-secs">{seconds(a.duration_ms)}</span> : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
        {step === 2 && pickedVideo && <AssetVideo url={pickedVideo.url} poster={pickedVideo.poster_url} className="clip-player" />}
        {currentTakes.length > 0 && (
          <div className="row take-actions">
            <button type="button" disabled={busy || !picked || picked.id === heroId || picked.review_status === 'rejected'} onClick={() => picked && void useThisOne(picked)}>Use this one</button>
            <button type="button" className="secondary" disabled={notReady || anyActive} onClick={() => setNoteFor(step === 1 ? 'image' : 'video')}>Try again</button>
          </div>
        )}
        {noteFor && (
          <div className="try-again">
            <label htmlFor="try-note">What should be different this time?</label>
            <input id="try-note" value={note} maxLength={400} onChange={(e) => setNote(e.target.value)} placeholder="Example: closer to the sea" />
            <div className="row">
              <button type="button" disabled={notReady} onClick={() => void start(noteFor, note)}>Go</button>
              <button type="button" className="secondary" onClick={() => setNoteFor(null)}>Cancel</button>
            </div>
          </div>
        )}
        {step === 2 && videoJobs.length > 0 && <p className="hint">Only the clip changes. Your picture stays.</p>}
      </aside>
    </div>
  );
}

function durations(d: { min: number; max: number; step: number }) {
  const out: number[] = [];
  for (let n = d.min; n <= d.max; n += Math.max(1, d.step)) out.push(n);
  return out;
}
