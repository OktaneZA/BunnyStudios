import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiProblem } from '../api';
import {
  director, isActiveJob, type Job, type NeedsChoice, type Shot, type ShotCast, type VideoBody, type VideoPlan,
} from '../director-api';
import { uuid } from '../uuid';
import { ProblemBox } from './ProblemBox';
import { AssetImage } from './AssetMedia';

interface Props {
  shot: Shot;
  sceneId: string;
  jobs: Job[];
  duration: number;
  audio: boolean;
  disabled: boolean;
  addJob: (job: Job) => void;
  onShot: (shot: Shot) => void;
  openStudio: (characterId: string) => void;
  refreshSettings: () => Promise<void>;
  /** Everyone in the cast, so a character the story does not name can still be added. */
  allCharacters: { id: string; name: string; lookId?: string | null }[];
}

type Quote = { plan: VideoPlan | null; needs: { detail: string; state: NeedsChoice } | null };
const fileUrl = (id: string) => `/api/v1/assets/${id}/file`;

/**
 * The scene's clip with its characters (Character Studio CR-01–CR-06, DF-01–DF-05): who is in
 * the scene and which look each uses, an optional starting and ending picture, then two
 * purposes with their prices: a quick preview and the final video. No model names here.
 */
export function SceneProduction({ shot, sceneId, jobs, duration, audio, disabled, addJob, onShot, openStudio, refreshSettings, allCharacters }: Props) {
  const [cast, setCast] = useState<ShotCast | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [continuity, setContinuity] = useState(true);
  const [useStart, setUseStart] = useState(false);
  const [useEnd, setUseEnd] = useState(false);
  const [quotes, setQuotes] = useState<{ preview?: Quote; final?: Quote; fromDraft?: Quote }>({});
  const [quoteRevision, setQuoteRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const starting = useRef(false);
  const startInput = useRef<HTMLInputElement>(null);
  const endInput = useRef<HTMLInputElement>(null);

  const loadCast = useCallback(async () => {
    const c = await director.shotCast(shot.id);
    if (c.shot_id !== shot.id) return;
    setCast(c);
    setChosen(c.characters.map((x) => x.character_id));
  }, [shot.id]);
  // Reload when the shot changes, or when a look was approved in Studio.
  const castStamp = allCharacters.map((c) => `${c.id}:${c.lookId ?? ''}`).join();
  useEffect(() => { void loadCast().catch(setError); }, [loadCast, shot.version, castStamp]);

  const unsaved = Boolean(cast && (!cast.saved || chosen.join() !== cast.characters.map((c) => c.character_id).join()));
  const hasCharacters = Boolean(cast?.characters.length);
  const listed = new Set(cast?.characters.map((c) => c.character_id) ?? []);
  const extras = allCharacters.filter((c) => chosen.includes(c.id) && !listed.has(c.id));
  const addable = allCharacters.filter((c) => !chosen.includes(c.id) && !listed.has(c.id));
  const useLooks = continuity && hasCharacters;

  // Only offer frames the shot actually has.
  const startId = shot.start_frame_asset_id ?? null;
  const endId = shot.end_frame_asset_id ?? null;
  useEffect(() => { if (!startId) { setUseStart(false); setUseEnd(false); } if (!endId) setUseEnd(false); }, [startId, endId]);

  const draft = useMemo(() => jobs.find((j) => j.target_entity_type === 'shot' && j.target_entity_id === shot.id && j.intent === 'draft' && j.status === 'ready') ?? null, [jobs, shot.id]);
  const active = jobs.some((j) => j.target_entity_type === 'shot' && j.target_entity_id === shot.id && isActiveJob(j));

  const body = useCallback((purpose: 'preview' | 'final'): VideoBody => ({
    purpose, continuity: useLooks, duration_seconds: duration, use_start_frame: useStart, use_end_frame: useEnd, audio,
  }), [useLooks, duration, useStart, useEnd, audio]);

  // Prices for both purposes, refreshed whenever a choice changes (DF-05: no price, no button).
  useEffect(() => {
    if (unsaved && useLooks) { setQuotes({}); return; }
    let on = true;
    const ask = async (b: VideoBody): Promise<Quote> => {
      try { return { plan: await director.quoteVideo(shot.id, b), needs: null }; }
      catch (err) {
        if (err instanceof ApiProblem && err.problem.status === 422) return { plan: null, needs: { detail: err.problem.detail, state: (err.problem.current_state ?? {}) as NeedsChoice } };
        throw err;
      }
    };
    Promise.all([ask(body('preview')), ask(body('final')), draft ? ask({ purpose: 'final', continuity: true, from_job_id: draft.id }) : Promise.resolve(undefined)])
      .then(([preview, final, fromDraft]) => { if (on) setQuotes({ preview, final, ...(fromDraft ? { fromDraft } : {}) }); })
      .catch((err) => { if (on) setError(err); });
    return () => { on = false; };
  }, [shot.id, shot.version, body, unsaved, useLooks, draft, quoteRevision]);

  async function refreshShot() {
    const fresh = (await director.shots(sceneId)).data[0];
    if (fresh) onShot(fresh);
  }

  async function saveCast() {
    if (!cast) return;
    setBusy(true); setError(null);
    try {
      const keep = new Map(cast.characters.map((c) => [c.character_id, c]));
      const saved = await director.saveShotCast(shot.id, chosen.map((id) => ({ character_id: id, look: keep.get(id)?.look_id && cast.saved ? keep.get(id)!.look_id! : 'current', outfit_label: keep.get(id)?.outfit_label ?? null })), shot.version);
      setCast(saved);
      await refreshShot();
    } catch (err) { setError(err); if (err instanceof ApiProblem && err.problem.status === 409) void refreshShot(); }
    finally { setBusy(false); }
  }

  async function useNewestLook(characterId: string) {
    if (!cast) return;
    setBusy(true); setError(null);
    try {
      const saved = await director.saveShotCast(shot.id, cast.characters.map((c) => ({ character_id: c.character_id, look: c.character_id === characterId ? 'current' : c.look_id ?? 'none', outfit_label: c.outfit_label })), shot.version);
      setCast(saved);
      await refreshShot();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function setFrame(which: 'start' | 'end', file: File | undefined, assetId?: string | null) {
    setBusy(true); setError(null);
    try {
      const id = file ? (await director.uploadFrame(shot.id, file)).id : assetId ?? null;
      onShot(await director.setFrames(shot.id, which === 'start' ? { start_asset_id: id } : { end_asset_id: id }, shot.version));
      if (which === 'start') setUseStart(Boolean(id));
      else setUseEnd(Boolean(id));
    } catch (err) { setError(err); }
    finally { setBusy(false); if (startInput.current) startInput.current.value = ''; if (endInput.current) endInput.current.value = ''; }
  }

  async function start(b: VideoBody) {
    if (starting.current) return;
    starting.current = true;
    setBusy(true); setError(null);
    try {
      const shown = b.from_job_id ? quotes.fromDraft?.plan : quotes[b.purpose]?.plan;
      if (!shown) return;
      addJob(await director.startVideo(shot.id, { ...b, expected_quote_key: shown.quote_key }, uuid()));
      void refreshSettings();
    } catch (err) {
      setError(err);
      if (err instanceof ApiProblem && err.problem.status === 409) {
        setQuotes({});
        setQuoteRevision((value) => value + 1);
      }
    }
    finally { starting.current = false; setBusy(false); }
  }

  const needs = quotes.final?.needs ?? quotes.preview?.needs ?? null;
  const off = disabled || busy || active;

  return (
    <section className="card production" aria-labelledby={`production-${shot.id}`}>
      <h4 id={`production-${shot.id}`}>Clip with your characters</h4>
      <ProblemBox error={error} />

      <div className="field">
        <span className="label-text">Characters in this scene</span>
        {!cast ? <p className="muted">Loading…</p> : cast.characters.length === 0 && extras.length === 0 ? (
          <p className="hint">Nobody from your cast is in this scene yet. Add someone below, or make a clip from the words.</p>
        ) : (
          <ul className="shot-cast">
            {cast.characters.map((c) => (
              <li key={c.character_id}>
                <label className="row">
                  <input type="checkbox" checked={chosen.includes(c.character_id)} disabled={off}
                    onChange={(e) => setChosen((prev) => e.target.checked ? [...prev, c.character_id] : prev.filter((x) => x !== c.character_id))} />
                  {c.main_picture ? <AssetImage url={c.main_picture.url} alt="" className="cast-face" /> : <span className="cast-face none" aria-hidden="true" />}
                  <span>{c.name}{c.look_version ? <span className="muted"> · look {c.look_version}</span> : null}</span>
                </label>
                {c.look_status === 'none' && <button type="button" className="link-button" onClick={() => openStudio(c.character_id)}>Choose how {c.name} looks</button>}
                {c.newer_look_available && <button type="button" className="link-button" disabled={off} onClick={() => void useNewestLook(c.character_id)}>Use {c.name}’s newest look</button>}
              </li>
            ))}
            {extras.map((c) => (
              <li key={c.id}>
                <label className="row">
                  <input type="checkbox" checked disabled={off} onChange={() => setChosen((prev) => prev.filter((x) => x !== c.id))} />
                  <span className="cast-face none" aria-hidden="true" />
                  <span>{c.name} <span className="muted">· added, save to keep</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {addable.length > 0 && (
          <label className="row add-to-scene">
            <span>Add someone:</span>
            <select value="" disabled={off} aria-label="Add a character to this scene" onChange={(e) => { const id = e.target.value; if (id) setChosen((prev) => [...prev, id]); }}>
              <option value="">Choose…</option>
              {addable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        )}
        {cast && unsaved && (
          <div className="row">
            <button type="button" className="secondary" disabled={off} onClick={() => void saveCast()}>{cast.saved ? 'Save who is in this scene' : 'Yes, these are in this scene'}</button>
            {!cast.saved && <span className="hint">Found in your story. Check them before making a clip.</span>}
          </div>
        )}
      </div>

      {hasCharacters && (
        <div className="toggle-row">
          <div>
            <span className="label-text">Use their chosen pictures?</span>
            <p className="hint">Helps them look the same in every scene. It is a help, not a promise: check each clip.</p>
          </div>
          <button type="button" role="switch" aria-checked={continuity} aria-label="Use their chosen pictures" className={`switch${continuity ? ' on' : ''}`} disabled={off} onClick={() => setContinuity((v) => !v)}>
            <span className="knob" aria-hidden="true" />
          </button>
        </div>
      )}

      <details className="frames">
        <summary>Start or end on a picture (optional)</summary>
        <div className="frame-row">
          <FrameSlot label="Starting picture" assetId={startId} on={useStart} disabled={off} onToggle={setUseStart}
            onUpload={() => startInput.current?.click()} onClear={() => void setFrame('start', undefined, null)}
            onUseScenePicture={shot.hero_asset_id && shot.hero_asset_id !== startId ? () => void setFrame('start', undefined, shot.hero_asset_id) : null} />
          <FrameSlot label="Ending picture" assetId={endId} on={useEnd} disabled={off || !startId} onToggle={setUseEnd}
            onUpload={() => endInput.current?.click()} onClear={() => void setFrame('end', undefined, null)} onUseScenePicture={null} />
        </div>
        {!startId && <p className="hint">An ending picture needs a starting picture too.</p>}
        <input ref={startInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void setFrame('start', e.target.files?.[0])} />
        <input ref={endInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void setFrame('end', e.target.files?.[0])} />
      </details>

      {needs && <NeedsBox needs={needs} openStudio={openStudio} onQuickDraft={() => setContinuity(false)} />}

      <div className="purpose-row">
        <PurposeButton label="Quick preview" quote={quotes.preview} disabled={off || (unsaved && useLooks)} onClick={() => void start(body('preview'))}
          hint="A cheaper try, to check the idea." />
        <PurposeButton label="Make final video" quote={quotes.final} disabled={off || (unsaved && useLooks)} onClick={() => void start(body('final'))}
          hint="The one for your cartoon." primary />
      </div>
      {unsaved && useLooks && <p className="hint">Save who is in this scene to see the prices.</p>}

      {draft && quotes.fromDraft?.plan && (
        <div className="card-soft from-draft">
          <p>Happy with your preview? Make the final video from the same recipe.</p>
          {quotes.fromDraft.plan.new_render && <p className="hint">This makes a new clip with a better maker, so it may not look exactly like the preview.</p>}
          <button type="button" disabled={off} onClick={() => void start({ purpose: 'final', continuity: true, from_job_id: draft.id })}>
            Make final video from the preview · {quotes.fromDraft.plan.words}
          </button>
        </div>
      )}
    </section>
  );
}

function PurposeButton({ label, quote, disabled, onClick, hint, primary }: { label: string; quote: Quote | undefined; disabled: boolean; onClick: () => void; hint: string; primary?: boolean }) {
  const plan = quote?.plan ?? null;
  const joined = plan?.parts && plan.parts.length > 1;
  return (
    <div className="purpose">
      <button type="button" className={primary ? '' : 'secondary'} disabled={disabled || !plan} onClick={onClick}>
        {label}{plan ? ` · ${plan.words}` : ''}
      </button>
      <span className="hint">
        {!quote ? 'Checking the price…' : !plan ? 'Not available for these choices.' : hint}
        {joined ? ` Made as ${plan!.parts!.length} shorter clips joined together.` : ''}
      </span>
    </div>
  );
}

function FrameSlot({ label, assetId, on, disabled, onToggle, onUpload, onClear, onUseScenePicture }: {
  label: string; assetId: string | null; on: boolean; disabled: boolean; onToggle: (v: boolean) => void;
  onUpload: () => void; onClear: () => void; onUseScenePicture: (() => void) | null;
}) {
  return (
    <div className="frame-slot">
      <span className="label-text">{label}</span>
      {assetId ? <AssetImage url={fileUrl(assetId)} alt={label} className="frame-thumb" /> : <span className="frame-thumb none">None</span>}
      <div className="row">
        <button type="button" className="secondary" disabled={disabled} onClick={onUpload}>Upload</button>
        {onUseScenePicture && <button type="button" className="secondary" disabled={disabled} onClick={onUseScenePicture}>Use the scene’s picture</button>}
        {assetId && <button type="button" className="link-button" disabled={disabled} onClick={onClear}>Remove</button>}
      </div>
      {assetId && <label className="row"><input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onToggle(e.target.checked)} /> Use it for this clip</label>}
    </div>
  );
}

function NeedsBox({ needs, openStudio, onQuickDraft }: { needs: NonNullable<Quote['needs']>; openStudio: (id: string) => void; onQuickDraft: () => void }) {
  return (
    <div className="notice needs" role="status">
      <p>{needs.detail}</p>
      <div className="row">
        {needs.state.missing === 'looks' && needs.state.characters?.map((c) => (
          <button key={c.character_id} type="button" className="secondary" onClick={() => openStudio(c.character_id)}>Choose how {c.name} looks</button>
        ))}
        {needs.state.quick_draft_available && <button type="button" className="secondary" onClick={onQuickDraft}>Make it from the words instead</button>}
      </div>
    </div>
  );
}
