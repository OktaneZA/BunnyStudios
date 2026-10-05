import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiProblem, type Scene } from '../api';
import {
  director, formatPence, isActiveJob, seconds,
  type Asset, type CartoonStyle, type GenerationSettings, type Job, type NeedsChoice, type Shot, type ShotCast, type VideoBody, type VideoPlan,
} from '../director-api';
import { ART_STYLE, PROMPT_VOCABULARIES } from '@storyboard/vocabularies';
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
/** Simple mode shows a short, friendly set of moods; Advanced shows every mood in the vocabulary. */
const SIMPLE_MOODS: readonly string[] = ['whimsical', 'cosy', 'tense', 'eerie', 'triumphant', 'melancholy'];
/** Simple mode offers the camera moves that read well in a short cartoon clip; Advanced shows them all. */
const SIMPLE_MOVES: readonly string[] = ['static', 'dolly_in', 'dolly_out', 'pan_left', 'pan_right', 'tilt_up', 'crane_up'];
const styleLabel = (value: string | null | undefined) => CLIP_STYLES.find(([v]) => v === value)?.[1] ?? ART_STYLE.find((s) => s.value === value)?.friendlyLabel ?? 'Not chosen';
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
  /** The cartoon's look changed: other scenes and their instructions changed with it. */
  onCartoonChanged: () => Promise<void>;
  /** The scene went to the bin: show the next one. */
  onDeleted: () => Promise<void>;
  /** The storybook toolbar shows this page's save state (SB-04). */
  onSaveState?: (status: string) => void;
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
  const { scene, projectId, shot, settings, jobs, jobsLoaded, assetsById, advanced, movable, layoutReset, castList, addJob, onShot, onScene, afterHero, onCartoonChanged, onDeleted, refreshSettings, openStudio, onSaveState } = props;
  /** More options: make a final straight away instead of a preview first. */
  const [skipPreview, setSkipPreview] = useState(false);
  const [duration, setDuration] = useState<number>(5);
  const [audio, setAudio] = useState(false);
  const [wordsOnly, setWordsOnly] = useState(false);
  const [useStart, setUseStart] = useState(false);
  const [useEnd, setUseEnd] = useState(false);
  const [keepCast, setKeepCast] = useState(false);
  const [continuedFrom, setContinuedFrom] = useState<string | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [resolution, setResolution] = useState<string | null>(null);
  const [fresh, setFresh] = useState(false);
  const [cast, setCast] = useState<ShotCast | null>(null);
  const [editingCast, setEditingCast] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [changingStyle, setChangingStyle] = useState(false);
  /** Advanced only: the style cards change this scene alone instead of the whole cartoon. */
  const [sceneOnlyStyle, setSceneOnlyStyle] = useState(false);
  const [cartoon, setCartoon] = useState<CartoonStyle | null>(null);
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

  useEffect(() => { onSaveState?.(sceneText.status); }, [sceneText.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onSaveState?.(''), []); // eslint-disable-line react-hooks/exhaustive-deps

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
  useEffect(() => {
    let on = true;
    director.cartoonStyle(projectId).then((c) => { if (on) setCartoon(c); }).catch((err) => { if (on) setError(err); });
    return () => { on = false; };
  }, [projectId, scene.id]);

  const listed = new Set(cast?.characters.map((c) => c.character_id) ?? []);
  const extras = castList.filter((c) => chosen.includes(c.id) && !listed.has(c.id));
  const addable = castList.filter((c) => !chosen.includes(c.id) && !listed.has(c.id));
  const castChanged = Boolean(cast && chosen.join() !== cast.characters.map((c) => c.character_id).join());
  // The story's proposal is used as it is, and saved when the clip is made (§6.2): no confirm step.
  const hasCharacters = Boolean(cast && cast.characters.length > 0);
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
  // One button: "Make preview" makes a preview; with a finished preview on screen
  // it becomes "Make final clip" from that preview's recipe. "Use my current scene settings
  // instead" makes a fresh final; "Skip the preview" goes straight to a final.
  const previewOnScreen = playingJob?.intent === 'draft' && playingJob.status === 'ready' ? playingJob : null;
  // Writing stays editable after a preview. If the scene changed since the preview was made,
  // the final follows the scene as it is now rather than the preview's older recipe.
  const sceneChangedSincePreview = previewOnScreen?.source_scene_version != null && scene.version > previewOnScreen.source_scene_version;
  const fromPreview = previewOnScreen && !fresh && !skipPreview && !sceneChangedSincePreview ? previewOnScreen : null;
  const purpose: 'preview' | 'final' = skipPreview || previewOnScreen ? 'final' : 'preview';
  useEffect(() => { setFresh(false); }, [playingJob?.id]);

  const model = settings?.models.find((m) => m.id === modelId) ?? null;
  const body = useMemo((): VideoBody => fromPreview
    ? { purpose: 'final', continuity: true, from_job_id: fromPreview.id, ...(modelId ? { model_id: modelId } : {}), ...(resolution ? { resolution } : {}) }
    : {
      purpose, continuity: useLooks, duration_seconds: duration, audio, use_start_frame: useStart, use_end_frame: useEnd,
      ...(useStart && useLooks && keepCast ? { keep_cast_pictures: true } : {}),
      ...(modelId ? { model_id: modelId } : {}), ...(resolution ? { resolution } : {}),
    }, [fromPreview, purpose, useLooks, duration, audio, useStart, useEnd, keepCast, modelId, resolution]);

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
    if (!shot || sceneText.pending || (!fromPreview && (!scene.description.trim() || castChanged))) return;
    let on = true;
    ask(body).then((q) => { if (on) setQuote(q); }).catch((err) => { if (on) { setError(err); setQuoteFailed(true); } });
    return () => { on = false; };
  }, [shot?.id, shot?.version, scene.description, scene.art_style, body, castChanged, ask, quoteRevision, sceneText.pending]); // eslint-disable-line react-hooks/exhaustive-deps

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
    } catch (err) { setError(err); if (err instanceof ApiProblem && err.problem.status === 409) void refreshShot(); }
    finally { setBusy(false); }
  }

  /** One look for the whole cartoon (§7.1): every scene uses it, so the clips match. */
  async function chooseCartoonStyle(style: string) {
    if (!shot || busy || sceneText.pending) return;
    setBusy(true); setSaveNote('Saving…'); setError(null);
    try {
      setCartoon(await director.setCartoonStyle(projectId, style));
      onScene(await api.getScene(scene.id));
      await onCartoonChanged();
      setSaveNote('Look saved for the whole cartoon'); setChangingStyle(false);
      setQuoteRevision((n) => n + 1);
    } catch (err) { setSaveNote(''); setError(err); }
    finally { setBusy(false); }
  }

  /** Advanced: a look for this scene alone. Null puts the scene back on the cartoon's look. */
  async function chooseStyle(style: string | null) {
    if (!shot || busy || sceneText.pending) return;
    setBusy(true); setSaveNote('Saving…'); setError(null);
    try {
      onScene(await api.updateScene(scene.id, { art_style: style }, scene.version));
      await refreshShot();
      setSaveNote(style ? 'Look saved for this scene only' : 'This scene uses the cartoon look again'); setChangingStyle(false); setSceneOnlyStyle(false);
      setQuoteRevision((n) => n + 1);
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
    } catch (err) { setError(err); if (err instanceof ApiProblem && err.problem.status === 409) void refreshShot(); }
    finally { setBusy(false); if (startInput.current) startInput.current.value = ''; if (endInput.current) endInput.current.value = ''; }
  }

  /** §7.4: the previous page's last frame starts this one, and the character pictures stay on. */
  async function continueFromPrevious() {
    if (!shot) return;
    setBusy(true); setError(null);
    try {
      const r = await director.startFromPrevious(shot.id, shot.version);
      onShot(r.shot); setUseStart(true); setKeepCast(true); setContinuedFrom(`page ${r.from_scene.scene_number}`);
    } catch (err) { setError(err); if (err instanceof ApiProblem && err.problem.status === 409) void refreshShot(); }
    finally { setBusy(false); }
  }

  /** Spend: only what was quoted. A changed recipe or price comes back as a fresh quote (409). */
  async function make(q: Quote | null, after?: () => void) {
    if (!shot || !q?.plan || starting.current || sceneText.pending) return;
    starting.current = true;
    setBusy(true); setError(null);
    try {
      const started = await director.startVideo(shot.id, { ...q.body, expected_quote_key: q.plan.quote_key }, uuid());
      addJob(started);
      // Making the clip can save the characters, which moves the scene's version.
      if (started.shot) onShot(started.shot);
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

  /** To the bin, never gone: Manage scenes can put it back, clips and all. */
  async function binScene() {
    if (busy || activeJob) return;
    if (!confirm(`Move scene ${scene.scene_number}, "${scene.title}", to the bin? You can put it back later from Manage scenes.`)) return;
    setBusy(true); setError(null);
    try { await api.deleteScene(scene.id); await onDeleted(); }
    catch (err) { setError(err); setBusy(false); }
  }

  async function useThisClip(asset: Asset) {
    if (!shot) return;
    setBusy(true); setError(null);
    try { onShot(await director.pickHero(shot.id, asset.id)); afterHero(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  // A scene's own look (Advanced) differs from the cartoon's; otherwise the scene follows the cartoon.
  const ownStyle = scene.art_style && scene.art_style !== cartoon?.art_style ? scene.art_style : null;
  const styleValue = ownStyle ?? cartoon?.art_style ?? null;
  const pickedStyle = sceneOnlyStyle ? ownStyle : cartoon?.art_style ?? null;
  const plan = quote?.plan ?? null;
  const actionLabel = purpose === 'preview' ? 'Make preview' : 'Make final clip';
  const detailSummary = ([
    ['time_of_day', sceneText.text.time_of_day],
    ['mood_atmosphere', sceneText.text.mood_atmosphere],
    ['camera_angle', sceneText.text.camera_angle ?? 'eye_level'],
    ['camera_movement', sceneText.text.camera_movement ?? null],
  ] as const).flatMap(([vocabulary, value]) => {
    const option = PROMPT_VOCABULARIES[vocabulary].find((entry) => entry.value === value);
    return option && !('emitsNothing' in option && option.emitsNothing) ? [advanced ? option.label : option.friendlyLabel] : [];
  }).join(' · ');
  // Money in plain words: what is left, next to the price on the button (not "about 9,000 clips").
  const allowance = settings?.allowance;
  const leftWords = allowance
    ? allowance.pot_pence <= 0 ? 'Your pot is empty. Ask a grown-up to add more picture money.'
      : allowance.pot_pence < allowance.remaining_today_pence ? `${formatPence(allowance.pot_pence)} left in your pot`
        : `${formatPence(allowance.remaining_today_pence)} left today · ${formatPence(allowance.pot_pence)} in your pot`
    : '';
  const blockedReason = !enabled ? (settings?.message ?? 'Picture making isn’t switched on yet. Ask a grown-up.')
    : sceneText.pending ? 'Save the scene before making a clip.'
    : !fromPreview && !scene.description.trim() ? 'Describe what happens in this scene first.'
      : !fromPreview && castChanged ? 'Save the characters first.'
          : activeJob ? 'A clip for this scene is being made. You can work on another scene.'
            : quote && !plan ? null : !quote ? 'Checking the price…' : null;

  return (
    <div className="director-work">
      <DirectorPanel key={`settings-${layoutReset}`} title="Clip settings" className="director-main" movable={movable}>
        <section className="composer card" aria-labelledby={`composer-${scene.id}`}>
          <header className="work-head">
            <h3 id={`composer-${scene.id}`}>Scene {scene.scene_number} · {scene.title}</h3>
            {/* Who is in it, as faces (mockup C); the list opens on tap, everything else about characters is on their page. */}
            {cast && !fromPreview && (
              <span className="scene-faces" aria-label={cast.characters.length ? `In this scene: ${cast.characters.map((c) => c.name).join(', ')}` : 'Nobody is in this scene yet'}>
                {cast.characters.map((c) => c.main_picture
                  ? <AssetImage key={c.character_id} url={c.main_picture.url} alt="" className={`cast-face${c.look_status === 'none' ? ' needs-look' : ''}`} />
                  : <span key={c.character_id} className="cast-face none" title={c.name} aria-hidden="true">{c.name.slice(0, 1)}</span>)}
                <button type="button" className="link-button" aria-expanded={editingCast} onClick={() => setEditingCast((v) => !v)}>Who’s in it</button>
              </span>
            )}
            <button type="button" className="link-button bin-scene" disabled={busy || Boolean(activeJob)} onClick={() => void binScene()}>Move to the bin</button>
          </header>
          <ProblemBox error={error} />

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
            <details className="let-ai-help">
              <summary>✦ Let AI help</summary>
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
            <details className="scene-settings scene-detail-options">
              <summary><span>Scene details<span className="scene-detail-summary">{detailSummary}</span></span></summary>
              <div className="composer-rows scene-choices">
                <span className="label-text" id={`time-${scene.id}`}>Time of day</span>
                <OptionPicker vocabulary="time_of_day" value={sceneText.text.time_of_day} friendly={!advanced} compact label="Time of day" allowNone toggle
                  allowedValues={['dawn', 'morning', 'midday', 'afternoon', 'dusk', 'night']}
                  onChange={(value) => { sceneText.edit('time_of_day', value ?? 'unspecified'); void sceneText.flush(); }} />
                <span className="label-text">Mood</span>
                <OptionPicker vocabulary="mood_atmosphere" value={sceneText.text.mood_atmosphere} friendly={!advanced} compact label="Mood" allowNone toggle
                  allowedValues={advanced ? undefined : [...SIMPLE_MOODS, ...(sceneText.text.mood_atmosphere && !SIMPLE_MOODS.includes(sceneText.text.mood_atmosphere) ? [sceneText.text.mood_atmosphere] : [])]}
                  onChange={(value) => { sceneText.edit('mood_atmosphere', value); void sceneText.flush(); }} />
                <span className="label-text">Camera</span>
                <OptionPicker vocabulary="camera_angle" value={sceneText.text.camera_angle ?? 'eye_level'} friendly={!advanced} compact label="Camera"
                  allowedValues={['eye_level', 'low_angle', 'high_angle', 'birds_eye', 'profile', 'three_quarter']}
                  onChange={(value) => { if (value) { sceneText.edit('camera_angle', value); void sceneText.flush(); } }} />
                <span className="label-text">Camera moves</span>
                <OptionPicker vocabulary="camera_movement" value={sceneText.text.camera_movement ?? null} friendly={!advanced} compact label="Camera moves" allowNone toggle
                  allowedValues={advanced ? undefined : [...SIMPLE_MOVES, ...(sceneText.text.camera_movement && !SIMPLE_MOVES.includes(sceneText.text.camera_movement) ? [sceneText.text.camera_movement] : [])]}
                  onChange={(value) => { sceneText.edit('camera_movement', value); void sceneText.flush(); }} />
              </div>
            </details>
          </div>

          {fromPreview ? (
            <section className="notice" aria-label="Settings from your preview">
              <h4>Using the preview’s saved settings</h4>
              <p>The final uses the same scene, character looks and pictures as your preview. Change the scene above to make it from the scene as it is now.</p>
              {plan && <p>{plan.output.durationSeconds} seconds · {plan.output.audio ? 'Sound on' : 'Sound off'} · {plan.characters.map((c) => c.name).join(', ') || 'No saved characters'}</p>}
              <button type="button" className="secondary" onClick={() => setFresh(true)}>Use my current scene settings instead</button>
            </section>
          ) : <>
          {previewOnScreen && sceneChangedSincePreview && !skipPreview && <p className="hint">You changed this scene since the preview, so the final clip is made from the scene as it is now.</p>}
          {/* Characters: their chosen looks are used automatically (review P1). Only what needs a decision is said here. */}
          {cast && (cast.characters.some((c) => c.look_status === 'none' || c.newer_look_available) || wordsOnly || useStart) && (
            <p className="hint scene-cast-note">
              {cast.characters.filter((c) => c.look_status === 'none').map((c) => <button key={c.character_id} type="button" className="link-button" onClick={() => openStudio(c.character_id)}>Choose {c.name}’s look</button>)}
              {cast.characters.filter((c) => c.look_status !== 'none' && c.newer_look_available).map((c) => <span key={c.character_id}>{c.name} is using an earlier look · <button type="button" className="link-button" disabled={busy} onClick={() => void useNewestLook(c.character_id)}>Use the newest</button></span>)}
              {wordsOnly ? 'Character pictures are not used for this clip.' : useStart ? (keepCast ? 'The starting picture and the character pictures both guide this clip.' : 'The starting picture guides this clip instead of the character pictures.') : ''}
            </p>
          )}
          {cast && editingCast && (
            <div className="composer-field">
              <span className="label-text">Who’s in it</span>
              <div className="composer-cast">
                {cast.characters.length === 0 && extras.length === 0 && <span className="hint">Nobody from your characters is in this scene.</span>}
                {(
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
            </div>
          )}

          {/* The cover owns the cartoon's look and setting (SB-08); a page speaks up only when it has its own look (SB-09). */}
          {(ownStyle || advanced) && (
            <div className="composer-field">
              <span className="label-text">Look</span>
              <span>{ownStyle ? `${styleLabel(ownStyle)} · this page only` : `${styleLabel(styleValue)} · the cartoon look`}</span>
              <button type="button" className="secondary" aria-expanded={changingStyle} disabled={!shot || shot.prompt_locked || !cartoon} onClick={() => { setChangingStyle((v) => !v); setSceneOnlyStyle(true); }}>Change</button>
              <span className="save-state" aria-live="polite">{saveNote}</span>
            </div>
          )}
          {ownStyle && !changingStyle && (
            <p className="hint">This page has its own look, so it will not match the rest of your cartoon.{' '}
              <button type="button" className="link-button" disabled={busy || Boolean(activeJob) || sceneText.pending} onClick={() => void chooseStyle(null)}>Use the cartoon look</button></p>
          )}
          {changingStyle && (
            <div className="clip-styles" role="group" aria-label={sceneOnlyStyle ? 'Look for this scene only' : 'Look for the whole cartoon'}>
              {CLIP_STYLES.map(([value, label]) => (
                <button key={value} type="button" className={`style-card style-${value}`} aria-pressed={pickedStyle === value}
                  disabled={!shot || busy || Boolean(activeJob) || sceneText.pending} onClick={() => void (sceneOnlyStyle ? chooseStyle(value) : chooseCartoonStyle(value))}>
                  <span className="style-swatch" aria-hidden="true">●</span><span>{label}</span>
                </button>
              ))}
              <p className="hint">{sceneOnlyStyle
                ? 'Only this scene changes. It will look different from the rest of your cartoon.'
                : 'Every scene in your cartoon uses this look, so your clips match. Character pictures do not change by themselves: make new ones in Your characters if they look different.'}</p>
              {advanced && <button type="button" className="link-button" onClick={() => setSceneOnlyStyle((v) => !v)}>{sceneOnlyStyle ? 'Change the whole cartoon instead' : 'Use a different look for this scene only'}</button>}
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

          <details className="more-options scene-settings">
            <summary>More options</summary>
            <div className="stack scene-settings-body">
              <p className="hint">These settings apply to the next clip you make. Changing them updates the price on the make button below; your existing clip stays the same.</p>
              {!previewOnScreen && (
                <section className="clip-option-group" aria-label="Preview first">
                  <h4>Preview first</h4>
                  <label className="row"><input type="checkbox" checked={skipPreview} onChange={(e) => setSkipPreview(e.target.checked)} /> Skip the preview and make a final clip straight away</label>
                  <p className="hint">A preview is a cheaper try. A final is the better clip for your cartoon.</p>
                </section>
              )}
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
                <p className="hint">Optional: guide how the clip begins and ends. A starting picture becomes the visual guide instead of the separate character pictures, unless you keep them on below. Add a starting picture before an ending picture.</p>
                {advanced && (
                  <div className="row">
                    <button type="button" className="secondary" disabled={busy} onClick={() => void continueFromPrevious()}>Start where the last page ended</button>
                    <span className="hint">{continuedFrom ? `Starting from the last moment of ${continuedFrom}.` : 'Uses the last moment of the page before this one as the starting picture.'}</span>
                  </div>
                )}
                {useStart && useLooks && (
                  <label className="row"><input type="checkbox" checked={keepCast} disabled={busy} onChange={(e) => setKeepCast(e.target.checked)} /> Keep the character pictures too (only some clip makers can do both)</label>
                )}
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
              <section className="clip-option-group" aria-label="Scene sketch">
                <h4>Scene sketch</h4>
                <p className="hint">A quick drawing to plan the scene. It is never used as a character picture.</p>
                <Link className="btn secondary" to={sceneLink(projectId, scene.id, 'make')}>Open the full scene page</Link>
              </section>
              <details className="prompt-details scene-settings">
                <summary>See the clip instructions</summary>
                {/* The instructions the clip maker gets, written by the server for that maker. */}
                <p className="prompt-box">{plan?.prompt ?? (fromPreview ? 'Loading the preview’s instructions…' : shot?.compiled_prompt || 'Write what happens in this scene first.')}</p>
              </details>
            </div>
          </details>
        </section>
      </DirectorPanel>

      <DirectorPanel key={`clips-${layoutReset}`} title="Your clips" className="director-right" movable={movable}>
        <section className="clip-make" aria-label="Make your clip">
          <h4>Make your clip</h4>
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
            {fromPreview ? <p className="hint">Makes a new, better video from your preview’s recipe. It may look a little different from the preview.</p>
              : purpose === 'preview' ? <p className="hint">Makes a quick preview first. You can make the final clip after.</p>
                : previewOnScreen && fresh && <p className="hint">Makes a final clip from the scene as it is now. <button type="button" className="link-button" onClick={() => setFresh(false)}>Use the preview’s saved settings instead</button></p>}
            {quoteFailed ? <p className="hint" role="status">Could not check the price. <button type="button" className="secondary" onClick={() => setQuoteRevision((n) => n + 1)}>Check price again</button></p>
              : blockedReason && <p className="hint" role="status">{blockedReason}</p>}
            {plan?.words_only && <p className="hint words-only" role="status">Made from the words only: {plan.characters.map((c) => c.name).join(' and ')} may not look like {plan.characters.length === 1 ? 'their picture' : 'their pictures'}.</p>}
            {leftWords && <p className="hint money-left">{leftWords}</p>}
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
        <h4>Your clip</h4>
        {!playing && <p className="hint">Your clip will appear here. Start with a preview to try out your scene.</p>}
        {playing && (
          <>
            <div className="clip-stage">
              {playing.job?.source_scene_version != null && scene.version > playing.job.source_scene_version && <p className="notice">You changed this scene since making this clip. It stays in your cartoon until you choose a replacement.</p>}
              <AssetVideo url={playing.asset.url} poster={playing.asset.poster_url} className="clip-player" />
              <p className="clip-label">
                {playing.asset.id === newClip && playing.asset.id !== heroId && <b className="new-clip">New · </b>}
                {playing.asset.id === heroId ? <b>In your cartoon</b> : <b>Not in your cartoon yet</b>}
                {playing.job?.intent ? ` · ${playing.job.intent === 'draft' ? 'Preview' : 'Final'}` : ''}
                {playing.job?.words_only ? ' · Made from words only' : ''}
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
