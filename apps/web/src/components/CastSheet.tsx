import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { director, type CastList, type CastProposal, type Job, type LibraryCharacter, type ModelInfo } from '../director-api';
import { uuid } from '../uuid';
import { ProblemBox } from './ProblemBox';
import { Sheet } from './Sheet';
import { AssetImage } from './AssetMedia';
import { CharacterStudio } from './CharacterStudio';

interface Props {
  projectId: string;
  cast: CastList | null;
  models: ModelInfo[];
  jobs: Job[];
  onJob: (job: Job) => void;
  refreshCast: () => Promise<void>;
  onClose: () => void;
  advanced: boolean;
  settingsMessage: string | null;
  onLookChosen?: (characterId: string) => Promise<void>;
  testMode?: boolean;
  /** Open straight on this character (from "Choose Fox's look" in a scene). */
  initialCharacterId?: string | null;
  /** Opened from a scene: the scene's name, for "Return to …". */
  returnToScene?: string | null;
  /** On the Characters page: a plain section, not a sheet over the working area. */
  inline?: boolean;
  /** Changes when the page asks to show a different character (the cast board's "Change how X looks"). */
  focusKey?: string | null;
  /** Shown above the characters: the storybook puts the cast board here. */
  lead?: ReactNode;
  /** The cartoon's art_style value, so a library character drawn in another look is said so (CL-07). */
  style?: string | null;
}

const LOOK_BADGE = { none: 'No look yet', approved: 'Look chosen', changed: 'Needs new pictures' } as const;

/**
 * Your cast (plan D39) and Character Studio: find people in the story or add someone, then
 * choose how each of them looks. Choosing a look is always a deliberate step (CS-04).
 */
export function CastSheet({ projectId, cast, jobs, onJob, refreshCast, onClose, settingsMessage, initialCharacterId, returnToScene, testMode, onLookChosen, inline = false, focusKey, lead, style = null }: Props) {
  const characters = cast?.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(initialCharacterId ?? null);
  useEffect(() => { if (focusKey) setSelectedId(focusKey); }, [focusKey]);
  const [proposal, setProposal] = useState<CastProposal | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  /** CL-03: for a found name with a library match, which character to reuse (absent = make a new one). */
  const [reuse, setReuse] = useState<Map<string, string>>(new Map());
  const [library, setLibrary] = useState<LibraryCharacter[] | null>(null);
  const [addMode, setAddMode] = useState<'library' | 'new'>('new');
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const selected = characters.find((c) => c.id === selectedId) ?? characters[0] ?? null;
  useEffect(() => { if (!selectedId && characters[0]) setSelectedId(characters[0].id); }, [characters, selectedId]);

  async function find() {
    setFinding(true); setError(null);
    try {
      const p = await director.findCast(projectId, uuid());
      setProposal(p);
      setKeep(new Set(p.characters.map((c) => c.name)));
      // Reusing a known character is the default; the creator can still choose a new one.
      setReuse(new Map(p.characters.filter((c) => c.library_match).map((c) => [c.name, c.library_match!.character_id])));
    } catch (err) { setError(err); }
    finally { setFinding(false); }
  }

  async function useThese() {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      await director.resolveCast(projectId, proposal.id, 'accept', [...keep], [...reuse].filter(([name]) => keep.has(name)).map(([name, character_id]) => ({ name, character_id })));
      setProposal(null);
      await refreshCast();
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function notNow() {
    if (!proposal) return;
    setBusy(true);
    try { await director.resolveCast(projectId, proposal.id, 'cancel'); } catch { /* it expires on its own */ }
    setProposal(null); setBusy(false);
  }

  /** CL-04: the library, without the characters already in this cartoon. */
  async function openAdd(mode: 'library' | 'new') {
    setAdding(true); setAddMode(mode); setError(null);
    if (mode === 'library' && library === null) {
      try { setLibrary((await director.library()).data); } catch (err) { setError(err); setLibrary([]); }
    }
  }
  async function addFromLibrary(characterId: string) {
    setBusy(true); setError(null);
    try {
      const c = await director.addFromLibrary(projectId, characterId);
      setAdding(false);
      await refreshCast();
      setSelectedId(c.id);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  const here = new Set(characters.map((c) => c.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')));
  const offered = (library ?? []).filter((l) => l.project_id !== projectId && !here.has(l.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')));

  async function addSomeone(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError(null);
    try {
      const c = await director.addCharacter(projectId, { name: newName.trim(), description: newDescription.trim() });
      setNewName(''); setNewDescription(''); setAdding(false);
      await refreshCast();
      setSelectedId(c.id);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const needsFinding = cast ? cast.never_found || cast.story_changed : false;

  const lede = 'Describe each character and choose the picture that looks right. Chosen pictures help keep them the same in every scene; check each clip, as they can still change a little.';
  // The same body in a sheet or on the page; a conditional wrapper, not a component made per render.
  const frame = (children: ReactNode) => inline
    ? <section className="cast-inline stack" aria-label="Your characters"><p className="hint">{lede}</p>{children}</section>
    : <Sheet title="Your characters" lede={lede} onClose={onClose}>{children}</Sheet>;
  return frame(
    <>
      <ProblemBox error={error} />
      {lead}
      {testMode && <p className="notice" role="status">Test mode: these are coloured placeholders, not character pictures. Nothing is spent.</p>}

      {needsFinding && !proposal && (
        <div className="cast-find card-soft">
          <p>{cast?.never_found ? 'Nobody has been found yet. The finder reads your scenes and lists who is in them.' : 'Your story changed since the characters were found. Look again to catch anyone new.'}</p>
          <button type="button" onClick={() => void find()} disabled={finding || !cast?.finder_enabled}>
            {finding && <span className="ai-spinner" aria-hidden="true" />}
            {finding ? 'Reading your story…' : 'Find characters in my story'}
          </button>
          {cast && !cast.finder_enabled && <p className="hint">Finding characters isn’t connected yet. Ask the account owner to set it up, or make a character yourself below.</p>}
        </div>
      )}

      {proposal && (
        <div className="cast-found card-soft">
          <h4>Found in your story</h4>
          {proposal.characters.length === 0 && <p className="muted">Nobody was named in your scenes yet. Add a name to a scene in Story, or add someone below.</p>}
          <ul className="found-list">
            {proposal.characters.map((c) => (
              <li key={c.name}>
                <label className="found-row">
                  <input type="checkbox" checked={keep.has(c.name)} onChange={(e) => {
                    const next = new Set(keep); if (e.target.checked) next.add(c.name); else next.delete(c.name); setKeep(next);
                  }} />
                  <span><strong>{c.name}</strong> <span className="muted">· {c.description}</span>{c.scene_numbers.length > 0 && <span className="muted"> · scenes {c.scene_numbers.join(', ')}</span>}</span>
                </label>
                {c.library_match && keep.has(c.name) && (
                  <div className="found-match">
                    {c.library_match.main_picture ? <AssetImage url={c.library_match.main_picture.url} alt="" className="cast-face" /> : <span className="cast-face none" aria-hidden="true" />}
                    <div className="stack-tight">
                      <span>You already have a <strong>{c.name}</strong> in <strong>{c.library_match.project_title}</strong>{c.library_match.art_style && c.library_match.art_style !== style ? `, drawn in ${c.library_match.art_style_label}` : ''}.</span>
                      <div className="row" role="group" aria-label={`Which ${c.name}?`}>
                        <button type="button" className={reuse.has(c.name) ? '' : 'secondary'} aria-pressed={reuse.has(c.name)} disabled={busy} onClick={() => setReuse(new Map(reuse).set(c.name, c.library_match!.character_id))}>Use that {c.name}</button>
                        <button type="button" className={reuse.has(c.name) ? 'secondary' : ''} aria-pressed={!reuse.has(c.name)} disabled={busy} onClick={() => { const next = new Map(reuse); next.delete(c.name); setReuse(next); }}>Make a new {c.name}</button>
                        {c.library_match.others.map((o) => (
                          <button key={o.character_id} type="button" className="link-button" disabled={busy} onClick={() => setReuse(new Map(reuse).set(c.name, o.character_id))}>{reuse.get(c.name) === o.character_id ? `Using the one from ${o.project_title}` : `The one from ${o.project_title}?`}</button>
                        ))}
                      </div>
                      <span className="hint">{reuse.has(c.name) ? 'Same look in both cartoons until you change it here. Changing them here never changes the other one.' : `A fresh ${c.name} with no pictures yet.`}</span>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" onClick={() => void useThese()} disabled={busy}>Use these</button>
            <button type="button" className="secondary" onClick={() => void notNow()} disabled={busy}>Not now</button>
          </div>
        </div>
      )}

      <div className="cast-chips">
        {characters.map((c) => (
          <button key={c.id} type="button" className={`cast-chip${selected?.id === c.id ? ' selected' : ''}`} onClick={() => setSelectedId(c.id)} aria-pressed={selected?.id === c.id}>
            {c.main_reference ? <AssetImage url={c.main_reference.url} alt="" className="cast-face" /> : <span className="cast-face none" aria-hidden="true" />}
            <span>{c.name}<span className={`look-badge look-${c.look_status}`}>{LOOK_BADGE[c.look_status]}</span></span>
          </button>
        ))}
        <button type="button" className="cast-chip add" onClick={() => (adding ? setAdding(false) : void openAdd('new'))} aria-expanded={adding}>+ Add a character</button>
      </div>

      {adding && (
        <div className="row" role="tablist" aria-label="Add a character">
          <button type="button" role="tab" className={addMode === 'library' ? '' : 'secondary'} aria-selected={addMode === 'library'} onClick={() => void openAdd('library')}>From your characters</button>
          <button type="button" role="tab" className={addMode === 'new' ? '' : 'secondary'} aria-selected={addMode === 'new'} onClick={() => void openAdd('new')}>New character</button>
        </div>
      )}
      {adding && addMode === 'library' && (
        <div className="card-soft stack" aria-label="Your characters from other cartoons">
          {library === null ? <p className="muted">Finding your characters…</p> : offered.length === 0 ? (
            <p className="muted">{library.length === 0 ? 'No characters with a chosen look yet. Make one and choose their look, and they will be here for your next cartoon.' : 'Everyone from your other cartoons is already in this one.'}</p>
          ) : (
            <ul className="library-list">
              {offered.map((l) => (
                <li key={l.character_id} className="library-row">
                  {l.main_picture ? <AssetImage url={l.main_picture.url} alt="" className="cast-face" /> : <span className="cast-face none" aria-hidden="true" />}
                  <span className="stack-tight"><strong>{l.name}</strong><span className="muted">{l.project_title}{l.art_style && l.art_style !== style ? ` · drawn in ${l.art_style_label}` : ''}</span></span>
                  <button type="button" disabled={busy} onClick={() => void addFromLibrary(l.character_id)}>Add {l.name}</button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">Adding someone copies their look and pictures into this cartoon. Changing them here never changes the other cartoon.</p>
        </div>
      )}

      {adding && addMode === 'new' && (
        <form className="card-soft stack" onSubmit={addSomeone}>
          <div className="field">
            <label htmlFor="new-name">What is their name?</label>
            <input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Their name" maxLength={60} />
          </div>
          <div className="field">
            <label htmlFor="new-desc">What do they look like?</label>
            <p className="hint">Example: "A small white rabbit with one floppy ear and a blue scarf."</p>
            <textarea id="new-desc" rows={3} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} maxLength={600} />
          </div>
          <div className="row">
            <button type="submit" disabled={busy || !newName.trim()}>Make {newName.trim() || 'them'}</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      {selected && (
        <>
          <div className="cast-person">
            <h4>{selected.name}</h4>
            {selected.scene_numbers.length > 0 && <p className="muted">In {selected.scene_numbers.length === 1 ? 'scene' : 'scenes'} {listNumbers(selected.scene_numbers)}.</p>}
          </div>
          <CharacterStudio key={selected.id} characterId={selected.id} jobs={jobs} onJob={onJob} onChanged={async (lookChosen) => {
            if (lookChosen) await onLookChosen?.(selected.id);
            await refreshCast().catch((err) => { setError(err); if (lookChosen) throw err; });
          }}
            onReturn={returnToScene ? onClose : null} returnLabel={returnToScene ? "the scene" : null} />
        </>
      )}

      {characters.length === 0 && !needsFinding && !proposal && (
        <p className="muted">No characters yet. Name them in your scenes and find them here, or make a character yourself.</p>
      )}
      {settingsMessage && <p className="hint">{settingsMessage}</p>}
    </>,
  );
}

function listNumbers(numbers: number[]) {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
