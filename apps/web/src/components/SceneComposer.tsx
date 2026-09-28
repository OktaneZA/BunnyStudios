import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiProblem, type Scene } from '../api';
import {
  director, isActiveJob, seconds,
  type Asset, type GenerationSettings, type Job, type NeedsChoice, type Shot, type ShotCast, type VideoBody, type VideoPlan,
} from '../director-api';
import { ART_STYLE } from '@storyboard/vocabularies';
import { uuid } from '../uuid';
import { sceneLink } from '../sceneState';
import { ProblemBox } from './ProblemBox';
import { AssetImage, AssetVideo, TakeImage } from './AssetMedia';
import { JobProgress } from './JobProgress';
import { DirectorPanel } from './DirectorPanel';
import { VideoModelPicker } from './VideoModelPicker';
import { useSceneText } from '../useSceneText';
import { OptionPicker } from './OptionPicker';
import { SceneImprover } from './SceneImprover';

const CLIP_STYLES = [
  ['2d_flat_vector', '2D cartoon'], ['3d_pixar_style', 'Pixar-like 3D'],
  ['anime_ghibli_soft', 'Soft anime'], ['watercolour_storybook', 'Watercolour'], ['claymation_look', 'Clay animation'],
] as const;
const LENGTHS = [5, 10, 15, 30] as const;
const fileUrl = (id: string) => `/api/v1/assets/${id}/file`;

interface Props {
  scene: Scene;
  projectId: string;
  shot: Shot | undefined;
  settings: GenerationSettings | null;
  jobs: Job[];
  jobsLoaded: boolean;
  assetsById: Map<string, Asset>;
  advanced: boolean;
  movable: boolean;
  layoutReset: number;
  castList: { id: string; name: string; lookId: string | null }[];
  addJob: (job: Job) => void;
  onShot: (shot: Shot) => void;
  onScene: (scene: Scene) => void;
  afterHero: () => void;
  refreshSettings: () => Promise<void>;
  openStudio: (characterId: string) => void;
}

type Quote = { plan: VideoPlan | null; needs: { detail: string; state: NeedsChoice } | null; body: VideoBody };

/**
 * One scene, one way to make its clip (docs/teen-ui-review.md P0): the scene, who is in it,
 * its style and length, Preview or Final, and one costed action. Characters' chosen looks are
 * used automatically; making it from the words only is an explicit choice under More options.
 * Every visible setting applies to that one action and its price.
 */
export function SceneComposer(props: Props) {
  const { scene, projectId, shot, settings, jobs, jobsLoaded, assetsById, advanced, movable, layoutReset, castList, addJob, onShot, onScene, afterHero, refreshSettings, openStudio } = props;
  const [purpose, setPurpose] = useState<'preview' | 'final'>('preview');
  const [duration, setDuration] = useState<number>(5);
  const [audio, setAudio] = useState(false);
  const [wordsOnly, setWordsOnly] = useState(false);
  const [useStart, setUseStart] = useState(false);
  const [useEnd, setUseEnd] = useState(false);
  const [modelId, setModelId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [cast, setCast] = useState<ShotCast | null>(null);
  const [editingCast, setEditingCast] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [changingStyle, setChangingStyle] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [retryQuote, setRetryQuote] = useState<Quote | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryNote, setRetryNote] = useState('');
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const [pickedClip, setPickedClip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saveNote, setSaveNote] = useState('');
  const starting = useRef(false);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);
  const sceneText = useSceneText(scene, async (updated) => {
    onScene(updated);
    const next = (await director.shots(updated.id)).data[0];
    if (next) onShot(next);
    setQuoteRevision((n) => n + 1);
  });

  // ── Who is in the scene ──────────────────────────────────────────────────
  const loadCast = useCallback(async () => {
    if (!shot) return;
    const c = await director.shotCast(shot.id);
    if (c.shot_id !== shot.id) return;
    setCast(c);
    setChosen(c.characters.map((x) => x.character_id));
  }, [shot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const castStamp = castList.map((c) => `${c.id}:${c.lookId ?? ''}`).join();
  useEffect(() => { void loadCast().catch(setError); }, [loadCast, shot?.version, castStamp]);

  const listed = new Set(cast?.characters.map((c) => c.character_id) ?? []);
  const extras = castList.filter((c) => chosen.includes(c.id) && !listed.has(c.id));
  const addable = castList.filter((c) => !chosen.includes(c.id) && !listed.has(c.id));
  const castChanged = Boolean(cast && chosen.join() !== cast.characters.map((c) => c.character_id).join());
  const needsConfirm = Boolean(cast && !cast.saved && cast.characters.length > 0);
  const hasCharacters = Boolean(cast?.saved && cast.characters.length > 0);
  const useLooks = hasCharacters && !wordsOnly;

  // ── Clips of this scene ──────────────────────────────────────────────────
  const videoJobs = useMemo(() => shot ? jobs.filter((j) => j.target_entity_type === 'shot' && j.target_entity_id === shot.id && j.kind === 'video') : [], [jobs, shot]);
  const activeJob = videoJobs.find(isActiveJob) ?? null;
  const clips = videoJobs.flatMap((j) => j.results.map((a) => ({ asset: a, job: j })));
  const heroId = shot?.hero_video_asset_id ?? null;
  const heroAsset = heroId ? assetsById.get(heroId) ?? clips.find((c) => c.asset.id === heroId)?.asset ?? null : null;
  // A clip that finishes while this scene is open is shown straight away, marked new, so the
  // child sees the result (and does not pay again thinking nothing happened). Which clip is in
  // the cartoon only changes when they press "Use this clip".
  const seenReady = useRef<Set<string> | null>(null);
  const [newClip, setNewClip] = useState<string | null>(null);
  useEffect(() => {
    const ready = videoJobs.filter((j) => j.status === 'ready' && j.results.length > 0);
    if (!seenReady.current) { if (jobsLoaded) seenReady.current = new Set(ready.map((j) => j.id)); return; }
    const fresh = ready.find((j) => !seenReady.current!.has(j.id));
    for (const j of ready) seenReady.current.add(j.id);
    if (fresh) { setPickedClip(fresh.results[0]!.id); setNewClip(fresh.results[0]!.id); }
  }, [videoJobs, jobsLoaded]);
  const playing = clips.find((c) => c.asset.id === pickedClip) ?? clips.find((c) => c.asset.id === heroId) ?? (heroAsset ? { asset: heroAsset, job: null } : clips[0] ?? null);
  const playingJob = playing?.job ?? null;
  // After a preview, the next step is its final (review P0), unless the child starts fresh.
  const fromPreview = purpose === 'final' && !fresh && playingJob?.intent === 'draft' && playingJob.status === 'ready' ? playingJob : null;

  const model = settings?.models.find((m) => m.id === modelId) ?? null;
  const body = useMemo((): VideoBody => fromPreview
    ? { purpose: 'final', continuity: true, from_job_id: fromPreview.id, ...(modelId ? { model_id: modelId } : {}), ...(resolution ? { resolution } : {}) }
    : {
      purpose, continuity: useLooks, duration_seconds: duration, audio, use_start_frame: useStart, use_end_frame: useEnd,
      ...(modelId ? { model_id: modelId } : {}), ...(resolution ? { resolution } : {}),
    }, [fromPreview, purpose, useLooks, duration, audio, useStart, useEnd, modelId, resolution]);

  const ask = useCallback(async (b: VideoBody): Promise<Quote> => {
    if (!shot) throw new Error('no shot');
    try { return { plan: await director.quoteVideo(shot.id, b), needs: null, body: b }; }
    catch (err) {
      if (err instanceof ApiProblem && err.problem.status === 422) return { plan: null, needs: { detail: err.problem.detail, state: (err.problem.current_state ?? {}) as NeedsChoice }, body: b };
      throw err;
    }
  }, [shot]);

  // The price for exactly what the button will do (review P1: lead with the quoted total).
  useEffect(() => {
    setQuote(null);
    setQuoteFailed(false);
    if (!shot || sceneText.pending || (!fromPreview && (!scene.description.trim() || needsConfirm || castChanged))) return;
    let on = true;
    ask(body).then((q) => { if (on) setQuote(q); }).catch((err) => { if (on) { setError(err); setQuoteFailed(true); } });
    return () => { on = false; };
  }, [shot?.id, shot?.version, scene.description, body, needsConfirm, castChanged, ask, quoteRevision, sceneText.pending]); // eslint-disable-line react-hooks/exhaustive-deps

  const enabled = Boolean(settings?.enabled);
  const off = !shot || !enabled || !jobsLoaded || busy || Boolean(activeJob) || sceneText.pending;

  // ── Actions ──────────────────────────────────────────────────────────────
  async function refreshShot() {
    const next = (await director.shots(scene.id)).data[0];
    if (next) onShot(next);
  }

  async function saveCast() {
    if (!cast || !shot) return;
    setBusy(true); setError(null);
    try {
      const known = new Map(cast.characters.map((c) => [c.character_id, c]));
      const saved = await director.saveShotCast(shot.id, chosen.map((id) => ({
        character_id: id, look: cast.saved && known.get(id)?.look_id ? known.get(id)!.look_id! : 'current', outfit_label: known.get(id)?.outfit_label ?? null,
      })), shot.version);
      setCast(saved); setEditingCast(false);
      await refreshShot();
    } catch (err) { setError(err); if (err instanceof ApiProblem && err.problem.status === 409) void refreshShot(); }
    finally { setBusy(false); }
  }

  async function useNewestLook(characterId: string) {
    if (!cast || !shot) return;
    setBusy(true); setError(null);
    try {
      setCast(await director.saveShotCast(shot.id, cast.characters.map((c) => ({ character_id: c.character_id, look: c.character_id === characterId ? 'current' : c.look_id ?? 'none', outfit_label: c.outfit_label })), shot.version));
      await refreshShot();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function chooseStyle(style: string) {
    if (!shot || busy || sceneText.pending) return;
    setBusy(true); setSaveNote('Saving…'); setError(null);
    try {
      onScene(await api.updateScene(scene.id, { art_style: style }, scene.version));
      await refreshShot();
      setSaveNote('Style saved for this scene'); setChangingStyle(false);
    } catch (err) {
      setSaveNote('');
      if (err instanceof ApiProblem && err.problem.status === 409 && err.problem.current_state) onScene(err.problem.current_state as Scene);
      setError(err);
    } finally { setBusy(false); }
  }

  async function setFrame(which: 'start' | 'end', file: File | undefined, assetId?: string | null) {
    if (!shot) return;
    setBusy(true); setError(null);
    try {
      const id = file ? (await director.uploadFrame(shot.id, file)).id : assetId ?? null;
      onShot(await director.setFrames(shot.id, which === 'start' ? { start_asset_id: id } : { end_asset_id: id }, shot.version));
      if (which === 'start') setUseStart(Boolean(id)); else setUseEnd(Boolean(id));
    } catch (err) { setError(err); }
    finally { setBusy(false); if (startInput.current) startInput.current.value = ''; if (endInput.current) endInput.current.value = ''; }
  }

  /** Spend: only what was quoted. A changed recipe or price comes back as a fresh quote (409). */
  async function make(q: Quote | null, after?: () => void) {
    if (!shot || !q?.plan || starting.current || sceneText.pending) return;
    starting.current = true;
    setBusy(true); setError(null);
    try {
      addJob(await director.startVideo(shot.id, { ...q.body, expected_quote_key: q.plan.quote_key }, uuid()));
      after?.();
      void refreshSettings();
    } catch (err) {
      setError(err);
      if (err instanceof ApiProblem && err.problem.status === 409) { setQuote(null); setRetryQuote(null); setQuoteRevision((n) => n + 1); }
    } finally { starting.current = false; setBusy(false); }
  }

  /** "Make another version" of the clip on screen: its recorded recipe, plus a short change. */
  const retryBody = useCallback((note: string): VideoBody | null => {
    if (!playingJob) return null;
    return { purpose: playingJob.intent === 'draft' ? 'preview' : 'final', continuity: true, from_job_id: playingJob.id, ...(note.trim() ? { note: note.trim() } : {}) };
  }, [playingJob]);
  useEffect(() => {
    setRetryQuote(null);
    const b = retrying ? retryBody(retryNote) : null;
    if (!b) return;
    let on = true;
    const timer = setTimeout(() => {
      ask(b).then(async (q) => {
        // A clip made before recipes were kept is remade from the scene as it is now, and says so.
        if (!q.plan && q.needs?.state.can_use_latest) q = await ask({ ...b, use_latest: true });
        if (on) setRetryQuote(q);
      }).catch((err) => { if (on) setError(err); });
    }, 350);
    return () => { on = false; clearTimeout(timer); };
  }, [retrying, retryNote, retryBody, ask, quoteRevision]);

  async function useThisClip(asset: Asset) {
    if (!shot) return;
    setBusy(true); setError(null);
    try { onShot(await director.pickHero(shot.id, asset.id)); afterHero(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  const styleValue = scene.art_style ?? CLIP_STYLES.find(([v]) => shot?.compiled_prompt.startsWith(ART_STYLE.find((s) => s.value === v)!.prompt_phrase))?.[0] ?? null;
  const styleLabel = CLIP_STYLES.find(([v]) => v === styleValue)?.[1] ?? 'Not chosen';
  const plan = quote?.plan ?? null;
  const actionLabel = fromPreview ? 'Make final clip' : purpose === 'preview' ? 'Make preview' : 'Make final clip';
  const blockedReason = !enabled ? (settings?.message ?? 'Generation isn’t connected yet. Ask the account owner to set it up.')
    : sceneText.pending ? 'Save the scene before making a clip.'
    : !fromPreview && !scene.description.trim() ? 'Describe what happens in this scene first.'
      : !fromPreview && needsConfirm ? 'Check who is in this scene first.'
        : !fromPreview && castChanged ? 'Save the characters first.'
          : activeJob ? 'A clip for this scene is being made. You can work on another scene.'
            : quote && !plan ? null : !quote ? 'Checking the price…' : null;

  return (
    <div className="director-work">
      <DirectorPanel key={`settings-${layoutReset}`} title="Clip settings" className="director-main" movable={movable}>
        <section className="composer card" aria-labelledby={`composer-${scene.id}`}>
          <header className="work-head">
            <h3 id={`composer-${scene.id}`}>Scene {scene.scene_number} · {scene.title}</h3>
          </header>
          <ProblemBox error={error} />

          {fromPreview ? (
            <section className="notice" aria-label="Settings from your preview">
              <h4>Using the preview’s saved settings</h4>
              <p>The scene, character looks and pictures are taken from this preview. Later scene edits are not included.</p>
              {plan && <p>{plan.output.durationSeconds} seconds · {plan.output.audio ? 'Sound on' : 'Sound off'} · {plan.characters.map((c) => c.name).join(', ') || 'No saved characters'}</p>}
              <button type="button" className="secondary" onClick={() => setFresh(true)}>Use my current scene settings instead</button>
            </section>
          ) : <>
          <div className="scene-writing stack">
            <label htmlFor={`scene-name-${scene.id}`}>Scene name</label>
            <input id={`scene-name-${scene.id}`} maxLength={200} value={sceneText.text.title} onChange={(e) => sceneText.edit('title', e.target.value)} onBlur={() => void sceneText.flush()} />
            <label htmlFor={`scene-action-${scene.id}`}>What happens?</label>
            <textarea id={`scene-action-${scene.id}`} rows={5} maxLength={12000} value={sceneText.text.description} placeholder="Describe what your characters do in this scene." onChange={(e) => sceneText.edit('description', e.target.value)} onBlur={() => void sceneText.flush()} />
            <p className="hint" role="status">{sceneText.status}</p>
            <ProblemBox error={sceneText.error} />
            {Boolean(sceneText.error) && <div className="row">
              <button type="button" className="secondary" onClick={() => void sceneText.retry()}>{sceneText.conflict ? 'Save my changes' : 'Retry save'}</button>
              {sceneText.conflict && <button type="button" className="secondary" onClick={() => void sceneText.retry(false)}>Use saved version</button>}
            </div>}
            <details className="scene-settings let-ai-help">
              <summary>Let AI help</summary>
              <div className="scene-settings-body">
                {/* The words are saved first, and a suggestion only replaces them when chosen. */}
                <SceneImprover scene={{ ...scene, description: sceneText.text.description }} beforeGenerate={sceneText.settle}
                  mutate={async (action) => {
                    await sceneText.settle();
                    await action(scene);
                    const fresh = await api.getScene(scene.id);
                    onScene(fresh);
                    const next = (await director.shots(fresh.id)).data[0];
                    if (next) onShot(next);
                    setQuoteRevision((n) => n + 1);
                  }} />
              </div>
            </details>
            <details className="scene-settings">
              <summary>Camera, time and mood</summary>
              <div className="stack scene-settings-body">
                <div className="field">
                  <span className="label-text">Camera angle</span>
                  <OptionPicker vocabulary="camera_angle" value={sceneText.text.camera_angle ?? 'eye_level'} friendly={!advanced}
                    allowedValues={['eye_level', 'low_angle', 'high_angle', 'birds_eye', 'profile', 'three_quarter']}
                    onChange={(value) => { sceneText.edit('camera_angle', value); void sceneText.flush(); }} />
                </div>
                <div className="field">
                  <span className="label-text">What time of day is it?</span>
                  <OptionPicker vocabulary="time_of_day" value={sceneText.text.time_of_day} friendly={!advanced}
                    onChange={(value) => { sceneText.edit('time_of_day', value ?? 'unspecified'); void sceneText.flush(); }} />
                </div>
                <div className="field">
                  <span className="label-text">What's the mood?</span>
                  <OptionPicker vocabulary="mood_atmosphere" value={sceneText.text.mood_atmosphere} friendly={!advanced} allowNone
                    onChange={(value) => { sceneText.edit('mood_atmosphere', value); void sceneText.flush(); }} />
                </div>
              </div>
            </details>
            <details className="scene-settings"><summary>More writing tools</summary><div className="scene-settings-body"><p className="hint">Open the full scene editor for scene sketches.</p><Link className="btn secondary" to={sceneLink(projectId, scene.id, 'make')}>Edit scene</Link></div></details>
          </div>

          {/* Characters: their chosen looks are used automatically (review P1). */}
          <div className="composer-field">
            <span className="label-text">Characters</span>
            {!cast ? <span className="muted">Loading…</span> : (
              <div className="composer-cast">
                {cast.characters.length === 0 && extras.length === 0 && !editingCast && <span className="hint">Nobody from your characters is in this scene.</span>}
                {!editingCast && cast.characters.map((c) => (
                  <div key={c.character_id} className="portrait">
                    {c.main_picture ? <AssetImage url={c.main_picture.url} alt="" className="portrait-face" /> : <span className="portrait-face none" aria-hidden="true">?</span>}
                    <span className="portrait-name">{c.name}</span>
                    <span className="portrait-status">
                      {c.look_status === 'none'
                        ? <button type="button" className="link-button" onClick={() => openStudio(c.character_id)}>Choose {c.name}’s look</button>
                        : c.newer_look_available ? <>Using an earlier look · <button type="button" className="link-button" disabled={busy} onClick={() => void useNewestLook(c.character_id)}>Use the newest</button></>
                          : wordsOnly ? 'Picture not used for this clip' : useStart ? 'Using the starting picture for this clip' : 'Using your chosen look'}
                    </span>
                  </div>
                ))}
                {needsConfirm && !editingCast && (
                  <div className="confirm-cast">
                    <span>Are these the characters in this scene?</span>
                    <button type="button" disabled={busy} onClick={() => void saveCast()}>Yes</button>
                    <button type="button" className="secondary" onClick={() => setEditingCast(true)}>Change</button>
                  </div>
                )}
                {!needsConfirm && !editingCast && <button type="button" className="secondary" onClick={() => setEditingCast(true)}>Edit characters</button>}
                {editingCast && (
                  <div className="cast-editor">
                    <ul className="shot-cast">
                      {[...cast.characters.map((c) => ({ id: c.character_id, name: c.name })), ...extras].map((c) => (
                        <li key={c.id}>
                          <label className="row">
                            <input type="checkbox" checked={chosen.includes(c.id)} disabled={busy}
                              onChange={(e) => setChosen((prev) => e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id))} />
                            {c.name}
                          </label>
                        </li>
                      ))}
                    </ul>
                    {addable.length > 0 && (
                      <label className="row add-to-scene">
                        <span>Add someone:</span>
                        <select value="" disabled={busy} aria-label="Add a character to this scene" onChange={(e) => { const id = e.target.value; if (id) setChosen((prev) => [...prev, id]); }}>
                          <option value="">Choose…</option>
                          {addable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="row">
                      <button type="button" disabled={busy} onClick={() => void saveCast()}>Save characters</button>
                      <button type="button" className="secondary" onClick={() => { setEditingCast(false); setChosen(cast.characters.map((c) => c.character_id)); }}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="composer-field">
            <span className="label-text">Style</span>
            <span>{styleLabel}</span>
            <button type="button" className="secondary" aria-expanded={changingStyle} disabled={!shot || shot.prompt_locked} onClick={() => setChangingStyle((v) => !v)}>Change</button>
            <span className="save-state" aria-live="polite">{saveNote}</span>
          </div>
          {changingStyle && (
            <div className="clip-styles" role="group" aria-label="Clip style">
              {CLIP_STYLES.map(([value, label]) => (
                <button key={value} type="button" className={`style-card style-${value}`} aria-pressed={styleValue === value}
                  disabled={!shot || busy || Boolean(activeJob) || sceneText.pending} onClick={() => void chooseStyle(value)}>
                  <span className="style-swatch" aria-hidden="true">●</span><span>{label}</span>
                </button>
              ))}
              <p className="hint">A new style can make characters look different from their chosen pictures. Their looks do not change by themselves.</p>
            </div>
          )}

          </>}
          {!fromPreview && (
            <div className="composer-field">
              <span className="label-text" id={`length-${scene.id}`}>Length</span>
              <div className="segmented" role="group" aria-labelledby={`length-${scene.id}`}>
                {LENGTHS.map((n) => <button key={n} type="button" className={duration === n ? 'on' : ''} aria-pressed={duration === n} onClick={() => setDuration(n)}>{n} seconds</button>)}
              </div>
            </div>
          )}

          <div className="composer-field">
            <span className="label-text" id={`kind-${scene.id}`}>Make a</span>
            <div className="segmented" role="group" aria-labelledby={`kind-${scene.id}`}>
              <button type="button" className={purpose === 'preview' ? 'on' : ''} aria-pressed={purpose === 'preview'} onClick={() => { setPurpose('preview'); setFresh(false); }}>Preview</button>
              <button type="button" className={purpose === 'final' ? 'on' : ''} aria-pressed={purpose === 'final'} onClick={() => setPurpose('final')}>Final</button>
            </div>
          </div>

          <details className="more-options scene-settings">
            <summary>More options</summary>
            <div className="stack scene-settings-body">
              <p className="hint">These settings apply to the next clip you make. Changing them updates the price on the make button below; your existing clip stays the same.</p>
              {!fromPreview && (
                <section className="clip-option-group" aria-label="Sound">
                  <h4>Sound</h4>
                  <label className="row"><input type="checkbox" checked={audio} onChange={(e) => setAudio(e.target.checked)} /> Add sounds (waves, footsteps, a bounce)</label>
                  <p className="hint">Leave this off for a silent clip. Sound may change the price or which clip maker is available.</p>
                </section>
              )}
              {hasCharacters && !fromPreview && (
                <section className="clip-option-group" aria-label="Character pictures">
                <h4>Character pictures</h4>
                <p className="hint">Your chosen looks help keep characters recognisable. Use words only if you want to try a clip without those pictures.</p>
                <label className="row"><input type="checkbox" checked={wordsOnly} onChange={(e) => setWordsOnly(e.target.checked)} /> Make it from the words only (no character pictures, so they may look different)</label>
                </section>
              )}
              {!fromPreview && shot && (
                <section className="clip-option-group" aria-label="Starting and ending pictures">
                <h4>Starting and ending pictures</h4>
                <p className="hint">Optional: guide how the clip begins and ends. A starting picture becomes the visual guide instead of the separate character pictures. Add a starting picture before an ending picture.</p>
                <div className="frame-row">
                  <FrameSlot label="Starting picture" assetId={shot.start_frame_asset_id ?? null} on={useStart} disabled={busy} onToggle={setUseStart}
                    onUpload={() => startInput.current?.click()} onClear={() => void setFrame('start', undefined, null)} />
                  <FrameSlot label="Ending picture" assetId={shot.end_frame_asset_id ?? null} on={useEnd} disabled={busy || !shot.start_frame_asset_id} onToggle={setUseEnd}
                    onUpload={() => endInput.current?.click()} onClear={() => void setFrame('end', undefined, null)} />
                  <input ref={startInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void setFrame('start', e.target.files?.[0])} />
                  <input ref={endInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void setFrame('end', e.target.files?.[0])} />
                </div>
                </section>
              )}
              {fromPreview && <button type="button" className="link-button" onClick={() => setFresh(true)}>Start a new final instead of using the preview</button>}
              {advanced && (
                <section className="clip-option-group" aria-label="Clip maker">
                  <h4>Clip maker</h4>
                  <p className="hint">Let the app choose, or pick a maker and picture size. Available lengths, sound and picture support vary by maker.</p>
                  <VideoModelPicker models={settings?.models ?? []} value={modelId ?? undefined} onChange={(id) => { setModelId(id); setResolution(null); }} />
                  {model && (
                    <div className="row">
                      <span className="hint">Using {model.label ?? model.friendly_label}.</span>
                      <label>Picture size <select value={resolution ?? model.resolutions[0]} onChange={(e) => setResolution(e.target.value)}>
                        {model.resolutions.map((size) => <option key={size} value={size}>{size}</option>)}
                      </select></label>
                      <button type="button" className="link-button" onClick={() => { setModelId(null); setResolution(null); }}>Let the app choose</button>
                    </div>
                  )}
                </section>
              )}
              <details className="prompt-details scene-settings">
                <summary>See the clip instructions</summary>
                <p className="prompt-box">{fromPreview ? plan?.prompt ?? 'Loading the preview’s instructions…' : shot?.compiled_prompt || 'Write what happens in this scene first.'}</p>
              </details>
            </div>
          </details>

          {quote?.needs && (
            <div className="notice needs" role="status">
              <p>{quote.needs.detail}</p>
              <div className="row">
                {quote.needs.state.characters?.map((c) => <button key={c.character_id} type="button" className="secondary" onClick={() => openStudio(c.character_id)}>Choose {c.name}’s look</button>)}
                {quote.needs.state.quick_draft_available && !wordsOnly && <button type="button" className="secondary" onClick={() => setWordsOnly(true)}>Make it from the words only</button>}
              </div>
            </div>
          )}

          <div className="go-row">
            <button type="button" className="main-action" disabled={off || !plan} onClick={() => void make(quote)}>
              {busy && <span className="ai-spinner" aria-hidden="true" />}{actionLabel}{plan ? ` · ${plan.words}` : ''}
            </button>
            {fromPreview && <p className="hint">Makes a new video from your preview’s recipe. It may look a little different from the preview.</p>}
            {quoteFailed ? <p className="hint" role="status">Could not check the price. <button type="button" className="secondary" onClick={() => setQuoteRevision((n) => n + 1)}>Check price again</button></p>
              : blockedReason && <p className="hint" role="status">{blockedReason}</p>}
            <p className="hint">{settings?.allowance_words}</p>
            {plan && (
              <details className="price-details scene-settings">
                <summary>Price details</summary>
                <p className="hint">
                  {plan.generated_seconds} seconds of video{plan.parts && plan.parts.length > 1 ? `, made as ${plan.parts.length} shorter clips joined together (cuts may be visible)` : ''}.
                  {plan.task === 'image-to-video' ? ' Uses your starting picture and any selected ending picture.' : plan.reference_count > 0 ? ` Uses ${plan.reference_count} chosen ${plan.reference_count === 1 ? 'picture' : 'pictures'}.` : ' Made from the words only.'}
                  {' '}This is an estimate, not a bill.
                </p>
              </details>
            )}
          </div>
          {activeJob && <JobProgress job={activeJob} what="clip" />}
        </section>
      </DirectorPanel>

      <DirectorPanel key={`clips-${layoutReset}`} title="Your clips" className="director-right" movable={movable}>
        <h4>Your clip</h4>
        {!playing && <p className="hint">No clips yet. Choose Preview or Final and press the button.</p>}
        {playing && (
          <>
            <div className="clip-stage">
              {playing.job?.source_scene_version != null && scene.version > playing.job.source_scene_version && <p className="notice">You changed this scene since making this clip. It stays in your cartoon until you choose a replacement.</p>}
              <AssetVideo url={playing.asset.url} poster={playing.asset.poster_url} className="clip-player" />
              <p className="clip-label">
                {playing.asset.id === newClip && playing.asset.id !== heroId && <b className="new-clip">New · </b>}
                {playing.asset.id === heroId ? <b>In your cartoon</b> : <b>Not in your cartoon yet</b>}
                {playing.job?.intent ? ` · ${playing.job.intent === 'draft' ? 'Preview' : 'Final'}` : ''}
                {playing.asset.duration_ms ? ` · ${seconds(playing.asset.duration_ms)}` : ''}
              </p>
            </div>
            <div className="row take-actions">
              {playing.asset.id !== heroId && <button type="button" disabled={busy || playing.asset.review_status === 'rejected'} onClick={() => void useThisClip(playing.asset)}>Use this clip</button>}
              {playing.job && <button type="button" className="secondary" disabled={off} onClick={() => setRetrying((v) => !v)} aria-expanded={retrying}>Make another version</button>}
            </div>
            {retrying && playing.job && (
              <div className="try-again">
                <label htmlFor={`retry-${scene.id}`}>What should be different? (optional)</label>
                <input id={`retry-${scene.id}`} value={retryNote} maxLength={300} placeholder="Example: closer to the sea" onChange={(e) => setRetryNote(e.target.value)} />
                <p className="hint">Uses the same characters, looks, pictures and length as this clip. Your chosen clip stays until you pick a new one.</p>
                {retryQuote?.body.use_latest && <p className="hint">This clip is older, so the new one is made from the scene as it is now.</p>}
                {retryQuote?.needs && <p className="hint">{retryQuote.needs.detail}</p>}
                <div className="row">
                  <button type="button" disabled={off || !retryQuote?.plan} onClick={() => void make(retryQuote, () => { setRetrying(false); setRetryNote(''); })}>
                    Make another version{retryQuote?.plan ? ` · ${retryQuote.plan.words}` : ''}
                  </button>
                  <button type="button" className="secondary" onClick={() => setRetrying(false)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}
        {videoJobs.some((j) => j.status === 'failed' || j.held_back > 0) && (
          <div className="stack">
            {videoJobs.filter((j) => j.status === 'failed').slice(0, 1).map((j) => <p key={j.id} className="problem-inline">{j.error ?? 'That did not work. Try again.'}</p>)}
            {videoJobs.filter((j) => j.held_back > 0).slice(0, 1).map((j) => <p key={j.id} className="hint">{j.held_back === 1 ? '1 clip was' : `${j.held_back} clips were`} held back by the safety checker.</p>)}
          </div>
        )}
        {clips.length > 1 && (
          <details className="other-versions scene-settings">
            <summary>Other versions ({clips.length - 1})</summary>
            <div className="take-grid">
              {clips.filter((c) => c.asset.id !== playing?.asset.id).map(({ asset, job }) => (
                <button key={asset.id} type="button" className={`take-tile${asset.id === heroId ? ' hero' : ''}`} onClick={() => { setPickedClip(asset.id); setRetrying(false); }}
                  aria-label={`${asset.id === heroId ? 'The clip in your cartoon' : 'Another version'}${job.intent ? `, ${job.intent === 'draft' ? 'preview' : 'final'}` : ''}`}>
                  <TakeImage asset={asset} alt="" />
                  {asset.id === heroId && <span className="take-tag">In your cartoon</span>}
                  {job.intent && <span className="take-kind">{job.intent === 'draft' ? 'Preview' : 'Final'}</span>}
                  {asset.duration_ms ? <span className="take-secs">{seconds(asset.duration_ms)}</span> : null}
                </button>
              ))}
            </div>
          </details>
        )}
      </DirectorPanel>
    </div>
  );
}

function FrameSlot({ label, assetId, on, disabled, onToggle, onUpload, onClear }: {
  label: string; assetId: string | null; on: boolean; disabled: boolean; onToggle: (v: boolean) => void; onUpload: () => void; onClear: () => void;
}) {
  return (
    <div className="frame-slot">
      <span className="label-text">{label} (optional)</span>
      {assetId ? <AssetImage url={fileUrl(assetId)} alt={label} className="frame-thumb" /> : <span className="frame-thumb none">None</span>}
      <div className="row">
        <button type="button" className="secondary" disabled={disabled} onClick={onUpload}>Upload</button>
        {assetId && <button type="button" className="link-button" disabled={disabled} onClick={onClear}>Remove</button>}
      </div>
      {assetId && <label className="row"><input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} /> Use it for this clip</label>}
    </div>
  );
}
