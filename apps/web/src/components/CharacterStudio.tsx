import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
  onChanged: () => void;
}

const SOURCE_WORDS: Record<Candidate['source'], string> = { generated: 'Made for you', upload: 'Uploaded', refinement: 'Changed', legacy: 'Older picture' };
const TRAIT_FIELDS = [
  ['species', 'What are they?', 'A rabbit, a robot, a girl…'],
  ['build', 'Shape and size', 'Tiny and round, tall and thin…'],
  ['colours', 'Colours', 'White fur, pink ears…'],
  ['features', 'Special things', 'A torn ear, big glasses…'],
  ['costume', 'Clothes', 'A blue scarf…'],
] as const;
type TraitKey = 'description' | (typeof TRAIT_FIELDS)[number][0];

/**
 * Character Studio (CS-02–CS-09): describe someone, make or upload choices, say which one looks
 * right, add more views made from that picture, then approve the pack. Pictures are only ever
 * candidates until the child says so, and an approved look never changes by itself.
 */
export function CharacterStudio({ characterId, jobs, onJob, onChanged }: Props) {
  const [studio, setStudio] = useState<Studio | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [traits, setTraits] = useState<Record<TraitKey, string>>({ description: '', species: '', build: '', colours: '', features: '', costume: '' });
  const [dirty, setDirty] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [pack, setPack] = useState<Set<string>>(new Set());
  const [changing, setChanging] = useState<Candidate | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [prices, setPrices] = useState<{ portrait?: string; view?: string }>({});
  const [saved, setSaved] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  // Set on every mount: React's dev mode mounts, unmounts and mounts again, and a flag only
  // cleared would leave the studio ignoring its own data ("Opening the studio…" for ever).
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const load = useCallback(async () => {
    const s = await director.studio(characterId);
    if (!alive.current || s.character.id !== characterId) return;
    setStudio(s);
    return s;
  }, [characterId]);

  useEffect(() => {
    setStudio(null); setPicked(null); setPack(new Set()); setChanging(null); setError(null); setDirty(false);
    load().then((s) => {
      if (!s) return;
      const c = s.character;
      setTraits({ description: c.description, species: c.species, build: c.build, colours: c.colours, features: c.features, costume: c.costume ?? '' });
    }).catch(setError);
  }, [load]);

  const character = studio?.character ?? null;
  const look = studio?.looks.find((l) => l.current) ?? null;

  // Prices come from the server before anything is spent (CS-03).
  useEffect(() => {
    if (!character) return;
    let on = true;
    director.quoteCharacterJob(character.id, { intent: 'portrait', count: 2 }).then((q) => on && setPrices((p) => ({ ...p, portrait: q.words }))).catch(() => {});
    if (look) director.quoteCharacterJob(character.id, { intent: 'view', view: 'side' }).then((q) => on && setPrices((p) => ({ ...p, view: q.words }))).catch(() => {});
    return () => { on = false; };
  }, [character?.id, look?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a picture job for this character finishes, reload the candidates.
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
      // Someone changed this character elsewhere: show the latest and let them choose again.
      if (err instanceof ApiProblem && err.problem.status === 409) void load().catch(() => {});
      setError(err);
      return undefined;
    } finally { if (alive.current) setBusy(false); }
  }

  async function saveTraits(e: FormEvent) {
    e.preventDefault();
    if (!character) return;
    const updated = await run(() => director.updateCharacter(character.id, traits, character.version));
    if (updated) {
      setDirty(false); await load(); onChanged();
      setSaved(updated.look_status === 'changed' ? `Saved. ${updated.name} keeps the chosen look until you choose new pictures.` : 'Saved.');
    }
  }

  async function useStoryWords() {
    if (!character?.story_suggestion) return;
    setTraits((t) => ({ ...t, description: character.story_suggestion! }));
    const updated = await run(() => director.updateCharacter(character.id, { description: character.story_suggestion! }, character.version));
    if (updated) { await load(); onChanged(); }
  }
  async function keepMine() {
    if (!character) return;
    if (await run(() => director.updateCharacter(character.id, { dismiss_story_suggestion: true }, character.version))) await load();
  }

  async function make(body: StudioJobBody) {
    if (!character) return;
    const job = await run(() => director.drawCharacter(character.id, body, uuid()));
    if (job) { onJob(job); setChanging(null); setChangeNote(''); }
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

  /** "This looks like <name>": the chosen picture becomes a new look on its own. */
  async function thisLooksRight() {
    if (!character || !picked) return;
    const approved = await run(() => director.approveLook(character.id, { main_asset_id: picked, pictures: [{ asset_id: picked, role: 'main' }] }, character.version));
    if (approved) { setPicked(null); await load(); onChanged(); }
  }

  /** "Use these pictures": the current look plus the chosen views, as a new look. */
  async function useThesePictures() {
    if (!character || !look || !studio) return;
    const main = look.references[0]!;
    const keep = look.references.map((r) => ({ asset_id: r.asset.id, role: r.role }));
    const added = studio.candidates.filter((c) => pack.has(c.id)).map((c) => ({ asset_id: c.asset.id, role: c.view_role }));
    const approved = await run(() => director.approveLook(character.id, { main_asset_id: main.asset.id, pictures: [...keep, ...added] }, character.version));
    if (approved) { setPack(new Set()); await load(); onChanged(); }
  }

  async function goBackTo(l: Look) {
    if (!character) return;
    if (await run(() => director.selectLook(character.id, l.id, character.version))) { await load(); onChanged(); }
  }

  if (!studio || !character) return <><ProblemBox error={error} />{!error && <p className="muted">Opening the studio…</p>}</>;

  const mains = studio.candidates.filter((c) => c.view_role === 'main');
  const views = studio.candidates.filter((c) => c.view_role !== 'main');
  const viewOptions = studio.views.filter((v) => v.value !== 'main');
  const lookWords = character.look_status === 'none' ? 'No look chosen yet'
    : character.look_status === 'changed' ? `Look ${look?.visual_version ?? ''} in use · you changed how ${character.name} looks, so choose new pictures when you are ready`
      : `Look ${look?.visual_version ?? ''} chosen`;

  return (
    <div className="studio stack">
      <ProblemBox error={error} />
      <p className={`look-status look-${character.look_status}`} role="status">{lookWords}</p>

      {character.story_suggestion && (
        <div className="card-soft story-suggestion">
          <p>Your story now describes {character.name} as: <i>{character.story_suggestion}</i></p>
          <p className="hint">{character.name}’s chosen look stays the same unless you change it.</p>
          <div className="row">
            <button type="button" className="secondary" disabled={busy} onClick={() => void useStoryWords()}>Use the story’s words</button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void keepMine()}>Keep mine</button>
          </div>
        </div>
      )}

      <form className="card-soft stack studio-describe" onSubmit={saveTraits}>
        <h4>1 · Describe {character.name}</h4>
        <div className="field">
          <label htmlFor="studio-desc">What do they look like?</label>
          <textarea id="studio-desc" rows={2} maxLength={600} value={traits.description}
            onChange={(e) => { setTraits({ ...traits, description: e.target.value }); setDirty(true); setSaved(''); }} />
        </div>
        <details>
          <summary>More details (you can skip these)</summary>
          <div className="studio-traits">
            {TRAIT_FIELDS.map(([key, label, hint]) => (
              <div className="field" key={key}>
                <label htmlFor={`studio-${key}`}>{label}</label>
                <input id={`studio-${key}`} value={traits[key]} placeholder={hint} maxLength={400}
                  onChange={(e) => { setTraits({ ...traits, [key]: e.target.value }); setDirty(true); setSaved(''); }} />
              </div>
            ))}
          </div>
        </details>
        <div className="row">
          <button type="submit" disabled={busy || !dirty}>Save how they look</button>
          <span className="hint" aria-live="polite">{saved}</span>
        </div>
      </form>

      <section className="card-soft stack">
        <h4>2 · Make some choices</h4>
        <div className="row">
          <button type="button" disabled={busy || Boolean(activeJob) || dirty || !traits.description.trim()} onClick={() => void make({ intent: 'portrait', count: 2 })}>
            Make 2 pictures{prices.portrait ? ` · ${prices.portrait}` : ''}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => fileInput.current?.click()}>Upload a picture</button>
          <input ref={fileInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadPicture(e.target.files?.[0])} />
        </div>
        {dirty && <p className="hint">Save how they look first, so the pictures match.</p>}
        {activeJob && <JobProgress job={activeJob} what="pictures" />}
        {lastDone?.status === 'failed' && <p className="problem-inline">{lastDone.error ?? 'That did not work. Try again.'}</p>}
        {lastDone && lastDone.held_back > 0 && <p className="hint">{lastDone.held_back === 1 ? '1 picture was' : `${lastDone.held_back} pictures were`} held back by the safety checker.</p>}

        {mains.length > 0 && (
          <>
            <p className="hint">New pictures are only ideas until you choose one.</p>
            <div className="candidate-grid" role="radiogroup" aria-label={`Pictures of ${character.name}`}>
              {mains.map((c) => (
                <CandidateTile key={c.id} candidate={c} name={character.name} picked={picked === c.asset.id} busy={busy}
                  onPick={() => setPicked(c.asset.id)} onChange={() => { setChanging(c); setChangeNote(''); }} onRemove={() => void remove(c)} />
              ))}
            </div>
            <button type="button" disabled={busy || !picked} onClick={() => void thisLooksRight()}>This looks like {character.name}</button>
          </>
        )}
        {changing && (
          <div className="try-again">
            <label htmlFor="studio-change">What should be different in this picture?</label>
            <input id="studio-change" value={changeNote} maxLength={300} placeholder="Example: floppier ears" onChange={(e) => setChangeNote(e.target.value)} />
            <div className="row">
              <button type="button" disabled={busy || !changeNote.trim() || Boolean(activeJob)} onClick={() => void make({ intent: 'refine', candidate_id: changing.id, note: changeNote.trim() })}>
                Make a changed picture{prices.view ? ` · ${prices.view}` : ''}
              </button>
              <button type="button" className="secondary" onClick={() => setChanging(null)}>Cancel</button>
            </div>
          </div>
        )}
      </section>

      {look && (
        <section className="card-soft stack">
          <h4>3 · More views of {character.name} <span className="muted">(optional)</span></h4>
          <p className="hint">Made from the picture you chose, so they start from the same look. Check each one: pictures can still come out a bit different.</p>
          <div className="view-buttons">
            {viewOptions.map((v) => (
              <button key={v.value} type="button" className="secondary" title={v.help} disabled={busy || Boolean(activeJob)}
                onClick={() => void make({ intent: 'view', view: v.value })}>{v.label}</button>
            ))}
          </div>
          {prices.view && <p className="hint">About {prices.view.replace(/^about /, '')} a view.</p>}
          {views.length > 0 && (
            <>
              <div className="candidate-grid">
                {views.map((c) => (
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
              <button type="button" disabled={busy || pack.size === 0} onClick={() => void useThesePictures()}>Use these pictures</button>
            </>
          )}
        </section>
      )}

      {studio.looks.length > 0 && (
        <section className="card-soft stack">
          <h4>{character.name}’s looks</h4>
          <ul className="look-history">
            {studio.looks.map((l) => (
              <li key={l.id} className={l.current ? 'current' : undefined}>
                <div className="look-strip">
                  {l.references.map((r) => <AssetImage key={r.position} url={r.asset.url} alt={`Look ${l.visual_version}, ${viewLabel(studio, r.role)}`} className="look-thumb" />)}
                </div>
                <span>Look {l.visual_version}{l.current ? ' · in use' : ''}</span>
                {!l.current && <button type="button" className="secondary" disabled={busy} onClick={() => void goBackTo(l)}>Use this look again</button>}
              </li>
            ))}
          </ul>
          <p className="hint">Scenes keep the look they were given. Older clips never change.</p>
        </section>
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
        <button type="button" className="link-button" disabled={busy || !candidate.can_approve} onClick={onChange}>Change this</button>
        <button type="button" className="link-button" disabled={busy} onClick={onRemove}>Remove</button>
      </span>
    </div>
  );
}

function viewLabel(studio: Studio, role: ViewRole) {
  return studio.views.find((v) => v.value === role)?.label ?? role;
}

export type { Character };
