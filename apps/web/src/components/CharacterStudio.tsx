import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiProblem } from '../api';
import { director, isActiveJob, type Candidate, type Character, type Job, type Look, type Studio, type StudioJobBody, type ViewRole } from '../director-api';
import { uuid } from '../uuid';
import { ProblemBox } from './ProblemBox';
import { AssetImage } from './AssetMedia';
import { JobProgress } from './JobProgress';

interface Props {
  characterId: string;
  jobs: Job[];
  onJob: (job: Job) => void;
  /** Tell the cast list something changed (a look approved, traits saved). */
  onChanged: (lookChosen?: boolean) => void | Promise<void>;
  /** Opened from a scene: offer to go straight back to it once the look is chosen. */
  onReturn?: (() => void) | null;
  returnLabel?: string | null;
}

const SOURCE_WORDS: Record<Candidate['source'], string> = { generated: 'New', upload: 'Uploaded', refinement: 'Changed', legacy: 'Older picture' };
const TRAIT_FIELDS = [
  ['species', 'What are they?', 'A rabbit, a robot, a girl…'],
  ['build', 'Shape and size', 'Tiny and round, tall and thin…'],
  ['colours', 'Colours', 'White fur, pink ears…'],
  ['features', 'Special things', 'A torn ear, big glasses…'],
  ['costume', 'Clothes', 'A blue scarf…'],
] as const;
type TraitKey = 'description' | (typeof TRAIT_FIELDS)[number][0];

/**
 * Character Studio (docs/teen-ui-review.md "Character flow"): Describe → Choose a picture →
 * Ready. Saving words happens as part of making pictures; choosing a look is always its own,
 * deliberate step. Chosen pictures help keep a character the same; they do not promise it.
 */
export function CharacterStudio({ characterId, jobs, onJob, onChanged, onReturn, returnLabel }: Props) {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [traits, setTraits] = useState<Record<TraitKey, string>>({ description: '', species: '', build: '', colours: '', features: '', costume: '' });
  const [dirty, setDirty] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pack, setPack] = useState<Set<string>>(new Set());
  const [changing, setChanging] = useState<Candidate | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [priceFailed, setPriceFailed] = useState(false);
  const [priceRevision, setPriceRevision] = useState(0);
  const [refinePrice, setRefinePrice] = useState<{ key: string; words: string } | null>(null);
  const making = useRef(false);
  const [editing, setEditing] = useState(false);
  /** Scenes that still use an earlier look of this character (§6.2): offered, never changed silently. */
  const [elsewhere, setElsewhere] = useState<{ scenes_to_update: number; scenes_with_clips: number } | null>(null);
  const [elsewhereNote, setElsewhereNote] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  // Set on every mount: React's dev mode mounts twice, and a flag only ever cleared would
  // leave the studio ignoring its own data.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const s = await director.studio(characterId);
    if (!alive.current || s.character.id !== characterId) return;
    setStudio(s);
    return s;
  }, [characterId]);

  useEffect(() => {
    setStudio(null); setPicked(null); setPack(new Set()); setChanging(null); setError(null); setDirty(false); setEditing(false);
    load().then((s) => {
      if (!s) return;
      const c = s.character;
      setTraits({ description: c.description, species: c.species, build: c.build, colours: c.colours, features: c.features, costume: c.costume ?? '' });
    }).catch(setError);
  }, [load]);

  const character = studio?.character ?? null;
  const look = studio?.looks.find((l) => l.current) ?? null;

  useEffect(() => {
    setElsewhere(null); setElsewhereNote('');
    if (!character || !look) return;
    let on = true;
    // Only an offer: if it cannot be checked, nothing is shown and nothing changes.
    director.lookElsewhere(character.id, look.id).then((r) => { if (on) setElsewhere(r); }).catch(() => {});
    return () => { on = false; };
  }, [character?.id, look?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function useEverywhere() {
    if (!character || !look) return;
    const done = await run(() => director.useLookEverywhere(character.id, look.id));
    if (done) {
      setElsewhere(null);
      setElsewhereNote(`${character.name} now uses this look in ${done.scenes_updated === 1 ? '1 more scene' : `${done.scenes_updated} more scenes`}.${done.scenes_with_clips ? ' Clips already made keep the earlier look until you make new ones.' : ''}`);
      try { await onChanged(true); } catch (err) { setError(err); }
    }
  }

  // Prices come from the server before anything is spent.
  useEffect(() => {
    if (!character) return;
    let on = true;
    setPrices({}); setPriceFailed(false);
    const requests: [string, StudioJobBody][] = [['portrait', { intent: 'portrait', count: 2 }]];
    if (look) for (const view of studio?.views ?? []) {
      if (view.value !== 'main') requests.push([view.value, { intent: 'view', view: view.value }]);
    }
    for (const [key, body] of requests) {
      director.quoteCharacterJob(character.id, body).then((q) => { if (on) setPrices((p) => ({ ...p, [key]: q.words })); })
        .catch(() => { if (on) setPriceFailed(true); });
    }
    return () => { on = false; };
  }, [character?.id, look?.id, priceRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  const refineKey = JSON.stringify([character?.id, changing?.id, changeNote.trim()]);
  useEffect(() => {
    setRefinePrice(null);
    if (!character || !changing || !changeNote.trim()) return;
    let on = true;
    const timer = setTimeout(() => {
      director.quoteCharacterJob(character.id, { intent: 'refine', candidate_id: changing.id, note: changeNote.trim() })
        .then((q) => { if (on) setRefinePrice({ key: refineKey, words: q.words }); })
        .catch(() => { if (on) setPriceFailed(true); });
    }, 350);
    return () => { on = false; clearTimeout(timer); };
  }, [refineKey, priceRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a picture job for this character finishes, reload the choices.
  const myJobs = useMemo(() => jobs.filter((j) => j.target_entity_type === 'character' && j.target_entity_id === characterId), [jobs, characterId]);
  const activeJob = myJobs.find(isActiveJob) ?? null;
  const lastDone = myJobs.find((j) => !isActiveJob(j)) ?? null;
  const seenDone = useRef<string | null>(null);
  useEffect(() => {
    if (!lastDone || seenDone.current === lastDone.id) return;
    seenDone.current = lastDone.id;
    void load().catch(() => {});
  }, [lastDone, load]);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true); setError(null);
    try { return await fn(); }
    catch (err) {
      if (err instanceof ApiProblem && err.problem.status === 409) void load().catch(() => {});
      setError(err);
      return undefined;
    } finally { if (alive.current) setBusy(false); }
  }

  /** Save edited words; false when saving failed, so nothing is made from stale words. */
  async function saveWords(): Promise<boolean> {
    if (!character || !dirty) return true;
    const updated = await run(() => director.updateCharacter(character.id, traits, character.version));
    if (!updated) return false;
    setDirty(false); await load(); onChanged();
    return true;
  }

  async function make(body: StudioJobBody) {
    const quoted = body.intent === 'refine' ? refinePrice?.key === refineKey : Boolean(prices[body.intent === 'view' ? body.view! : 'portrait']);
    if (!character || !quoted || making.current) return;
    making.current = true;
    try {
      if (!(await saveWords())) return;
      const job = await run(() => director.drawCharacter(character.id, body, uuid()));
      if (job) { onJob(job); setChanging(null); setChangeNote(''); }
    } finally { making.current = false; }
  }

  async function useStoryWords() {
    if (!character?.story_suggestion) return;
    setTraits((t) => ({ ...t, description: character.story_suggestion! }));
    if (await run(() => director.updateCharacter(character.id, { description: character.story_suggestion! }, character.version))) { await load(); onChanged(); }
  }
  async function keepMine() {
    if (!character) return;
    if (await run(() => director.updateCharacter(character.id, { dismiss_story_suggestion: true }, character.version))) await load();
  }

  async function uploadPicture(file: File | undefined) {
    if (!file || !character) return;
    await run(async () => { const c = await director.uploadCandidate(character.id, file); await load(); setPicked(c.asset.id); });
    if (fileInput.current) fileInput.current.value = '';
  }

  async function remove(c: Candidate) {
    if (!character) return;
    await run(async () => { await director.removeCandidate(character.id, c.id); await load(); });
    if (picked === c.asset.id) setPicked(null);
  }

  /** "Use this look": the chosen picture becomes the character's look. */
  async function useThisLook() {
    if (!character || !picked) return;
    const approved = await run(() => director.approveLook(character.id, { main_asset_id: picked, pictures: [{ asset_id: picked, role: 'main' }] }, character.version));
    if (approved) {
      try { await onChanged(true); setPicked(null); setEditing(false); await load(); }
      catch (err) { setError(err); }
    }
  }

  /** "Add these angles": the current look plus the chosen extra angles. */
  async function addAngles() {
    if (!character || !look || !studio) return;
    const main = look.references[0]!;
    const keep = look.references.map((r) => ({ asset_id: r.asset.id, role: r.role }));
    const added = studio.candidates.filter((c) => pack.has(c.id)).map((c) => ({ asset_id: c.asset.id, role: c.view_role }));
    const approved = await run(() => director.approveLook(character.id, { main_asset_id: main.asset.id, pictures: [...keep, ...added] }, character.version));
    if (approved) {
      try { await onChanged(true); setPack(new Set()); await load(); }
      catch (err) { setError(err); }
    }
  }

  async function goBackTo(l: Look) {
    if (!character) return;
    if (await run(() => director.selectLook(character.id, l.id, character.version))) {
      try { await onChanged(true); await load(); } catch (err) { setError(err); }
    }
  }

  if (!studio || !character) return <><ProblemBox error={error} />{!error && <p className="muted">Opening the studio…</p>}</>;

  const newMains = studio.candidates.filter((c) => c.view_role === 'main' && !look?.references.some((r) => r.asset.id === c.asset.id));
  const angles = studio.candidates.filter((c) => c.view_role !== 'main' && !look?.references.some((r) => r.asset.id === c.asset.id));
  const angleOptions = studio.views.filter((v) => v.value !== 'main');
  const earlier = studio.looks.filter((l) => !l.current);
  const choosing = !look || editing;
  const statusWords = character.look_status === 'none' ? 'No look chosen yet'
    : character.look_status === 'changed' ? `You changed how ${character.name} looks. The chosen look is still used until you choose a new picture.`
      : 'Using this look';

  return (
    <div className="studio stack">
      <ProblemBox error={error} />
      {priceFailed && <p className="hint" role="status">Some prices could not be checked. <button type="button" className="secondary" onClick={() => setPriceRevision((n) => n + 1)}>Check prices again</button></p>}
      <p className={`look-status look-${character.look_status}`} role="status">{statusWords}</p>
      {look && elsewhere && elsewhere.scenes_to_update > 0 && (
        <section className="notice" aria-label="Use this look in every scene">
          <p>
            {elsewhere.scenes_to_update === 1 ? '1 scene still uses' : `${elsewhere.scenes_to_update} scenes still use`} an earlier look of {character.name}, so they may look different there.
            {elsewhere.scenes_with_clips > 0 && ` Clips already made keep the earlier look; make a new clip to see this one.`}
          </p>
          <div className="row">
            <button type="button" disabled={busy} onClick={() => void useEverywhere()}>Use this look in every scene</button>
            <button type="button" className="secondary" onClick={() => setElsewhere(null)}>Not now</button>
          </div>
        </section>
      )}
      {elsewhereNote && <p className="hint" role="status">{elsewhereNote}</p>}

      {character.story_suggestion && (
        <div className="card-soft story-suggestion">
          <p>Your story now describes {character.name} as: <i>{character.story_suggestion}</i></p>
          <div className="row">
            <button type="button" className="secondary" disabled={busy} onClick={() => void useStoryWords()}>Use the story’s words</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void keepMine()}>Keep mine</button>
          </div>
        </div>
      )}

      {look && !choosing && (
        <section className="card-soft studio-ready stack" aria-label={`${character.name} is ready`}>
          <div className="ready-portrait">
            <AssetImage url={look.references[0]!.asset.url} alt={`${character.name}’s chosen look`} className="ready-face" />
            <div className="stack">
              <h4>{character.name} is ready</h4>
              <p className="hint">Scenes use this look to help keep {character.name} the same. Check each clip: it can still change a little.</p>
              <div className="row">
                {onReturn && <button type="button" onClick={onReturn}>Return to {returnLabel ?? 'the scene'}</button>}
                <button type="button" className="secondary" onClick={() => setEditing(true)}>Change how {character.name} looks</button>
              </div>
            </div>
          </div>

          <details className="studio-more">
            <summary>Add more angles (optional)</summary>
            <p className="hint">Made from the chosen picture. Each button shows its price.</p>
            <div className="view-buttons">
              {angleOptions.map((v) => (
                <button key={v.value} type="button" className="secondary" title={v.help} disabled={busy || Boolean(activeJob) || !prices[v.value]} onClick={() => void make({ intent: 'view', view: v.value })}>{v.label}{prices[v.value] ? ` · ${prices[v.value]}` : ' · checking price…'}</button>
              ))}
            </div>
            {activeJob && <JobProgress job={activeJob} what="pictures" />}
            {angles.length > 0 && (
              <>
                <div className="candidate-grid">
                  {angles.map((c) => (
                    <label key={c.id} className={`candidate${pack.has(c.id) ? ' picked' : ''}`}>
                      <AssetImage url={c.asset.url} alt={`${character.name}, ${viewLabel(studio, c.view_role)}`} />
                      <span className="candidate-tag">{viewLabel(studio, c.view_role)} · not chosen yet</span>
                      <span className="row">
                        <input type="checkbox" disabled={!c.can_approve || busy} checked={pack.has(c.id)} onChange={(e) => {
                          const next = new Set(pack); if (e.target.checked) next.add(c.id); else next.delete(c.id); setPack(next);
                        }} /> Add
                      </span>
                      {!c.can_approve && <span className="hint">Still being checked</span>}
                    </label>
                  ))}
                </div>
                <button type="button" disabled={busy || pack.size === 0} onClick={() => void addAngles()}>Add these angles</button>
              </>
            )}
          </details>

          {earlier.length > 0 && (
            <details className="studio-more">
              <summary>Earlier looks ({earlier.length})</summary>
              <ul className="look-history">
                {earlier.map((l) => (
                  <li key={l.id}>
                    <div className="look-strip">
                      {l.references.map((r) => <AssetImage key={r.position} url={r.asset.url} alt={`Earlier look, ${viewLabel(studio, r.role)}`} className="look-thumb" />)}
                    </div>
                    <span className="hint">Chosen {new Date(l.approved_at).toLocaleDateString()}</span>
                    <button type="button" className="secondary" disabled={busy} onClick={() => void goBackTo(l)}>Use this look again</button>
                  </li>
                ))}
              </ul>
              <p className="hint">Scenes keep the look they were given, and older clips never change.</p>
            </details>
          )}
        </section>
      )}

      {choosing && (
        <>
          <section className="card-soft stack studio-describe">
            <h4>1 · Describe {character.name}</h4>
            <div className="field">
              <label htmlFor="studio-desc">What do they look like?</label>
              <textarea id="studio-desc" rows={2} maxLength={600} value={traits.description}
                onChange={(e) => { setTraits({ ...traits, description: e.target.value }); setDirty(true); }} />
            </div>
            <details>
              <summary>More details (optional)</summary>
              <div className="studio-traits">
                {TRAIT_FIELDS.map(([key, label, hint]) => (
                  <div className="field" key={key}>
                    <label htmlFor={`studio-${key}`}>{label}</label>
                    <input id={`studio-${key}`} value={traits[key]} placeholder={hint} maxLength={400}
                      onChange={(e) => { setTraits({ ...traits, [key]: e.target.value }); setDirty(true); }} />
                  </div>
                ))}
              </div>
            </details>
            <div className="row">
              <button type="button" disabled={busy || Boolean(activeJob) || !traits.description.trim() || !prices.portrait} onClick={() => void make({ intent: 'portrait', count: 2 })}>
                Make 2 pictures{prices.portrait ? ` · ${prices.portrait}` : ' · checking price…'}
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>Upload a picture</button>
              <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadPicture(e.target.files?.[0])} />
              {look && <button type="button" className="link-button" onClick={() => { setEditing(false); setPicked(null); }}>Keep the current look</button>}
            </div>
            {dirty && <p className="hint">Your words are saved when you make pictures.</p>}
            {activeJob && <JobProgress job={activeJob} what="pictures" />}
            {lastDone?.status === 'failed' && <p className="problem-inline">{lastDone.error ?? 'That did not work. Try again.'}</p>}
            {lastDone && lastDone.held_back > 0 && <p className="hint">{lastDone.held_back === 1 ? '1 picture was' : `${lastDone.held_back} pictures were`} held back by the safety checker.</p>}
          </section>

          {newMains.length > 0 && (
            <section className="card-soft stack">
              <h4>2 · Choose a picture</h4>
              <p className="hint">These are only ideas until you choose one.</p>
              <div className="candidate-grid" role="radiogroup" aria-label={`Pictures of ${character.name}`}>
                {newMains.map((c) => (
                  <CandidateTile key={c.id} candidate={c} name={character.name} picked={picked === c.asset.id} busy={busy}
                    onPick={() => setPicked(c.asset.id)} onChange={() => { setChanging(c); setChangeNote(''); }} onRemove={() => void remove(c)} />
                ))}
              </div>
              {changing && (
                <div className="try-again">
                  <label htmlFor="studio-change">What should be different in this picture?</label>
                  <input id="studio-change" value={changeNote} maxLength={300} placeholder="Example: floppier ears" onChange={(e) => setChangeNote(e.target.value)} />
                  <div className="row">
                    <button type="button" disabled={busy || !changeNote.trim() || Boolean(activeJob) || refinePrice?.key !== refineKey} onClick={() => void make({ intent: 'refine', candidate_id: changing.id, note: changeNote.trim() })}>
                      Make a changed picture{refinePrice?.key === refineKey ? ` · ${refinePrice.words}` : ''}
                    </button>
                    <button type="button" className="secondary" onClick={() => setChanging(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <button type="button" disabled={busy || !picked} onClick={() => void useThisLook()}>Use this look</button>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function CandidateTile({ candidate, name, picked, busy, onPick, onChange, onRemove }: {
  candidate: Candidate; name: string; picked: boolean; busy: boolean; onPick: () => void; onChange: () => void; onRemove: () => void;
}) {
  return (
    <div className={`candidate${picked ? ' picked' : ''}`}>
      <AssetImage url={candidate.asset.url} alt={`Picture of ${name}`} />
      <span className="candidate-tag">{SOURCE_WORDS[candidate.source]} · not chosen yet</span>
      {candidate.can_approve
        ? <label className="row"><input type="radio" name="studio-main" checked={picked} disabled={busy} onChange={onPick} /> Pick this one</label>
        : <span className="hint">Still being checked</span>}
      <span className="row">
        <button type="button" className="link-button" disabled={busy || !candidate.can_approve} onClick={onChange}>Change this picture</button>
        <button type="button" className="link-button" disabled={busy} onClick={onRemove}>Remove</button>
      </span>
    </div>
  );
}

function viewLabel(studio: Studio, role: ViewRole) {
  return studio.views.find((v) => v.value === role)?.label ?? role;
}

export type { Character };
