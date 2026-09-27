import { useEffect, useState, type FormEvent } from 'react';
import { director, type CastList, type CastProposal, type Job, type ModelInfo } from '../director-api';
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
  /** Open straight on this character (from "Choose Fox's look" in a scene). */
  initialCharacterId?: string | null;
  /** Opened from a scene: the scene's name, for "Return to …". */
  returnToScene?: string | null;
}

const LOOK_BADGE = { none: 'No look yet', approved: 'Look chosen', changed: 'Needs new pictures' } as const;

/**
 * Your cast (plan D39) and Character Studio: find people in the story or add someone, then
 * choose how each of them looks. Choosing a look is always a deliberate step (CS-04).
 */
export function CastSheet({ projectId, cast, jobs, onJob, refreshCast, onClose, settingsMessage, initialCharacterId, returnToScene }: Props) {
  const characters = cast?.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(initialCharacterId ?? null);
  const [proposal, setProposal] = useState<CastProposal | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
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
    } catch (err) { setError(err); }
    finally { setFinding(false); }
  }

  async function useThese() {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      await director.resolveCast(projectId, proposal.id, 'accept', [...keep]);
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

  return (
    <Sheet title="Your characters" lede="Describe each character and choose the picture that looks right. Chosen pictures help keep them the same in every scene; check each clip, as they can still change a little." onClose={onClose}>
      <ProblemBox error={error} />

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
        <button type="button" className="cast-chip add" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>+ Make a character</button>
      </div>

      {adding && (
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
          <CharacterStudio key={selected.id} characterId={selected.id} jobs={jobs} onJob={onJob} onChanged={() => void refreshCast().catch(() => {})}
            onReturn={returnToScene ? onClose : null} returnLabel={returnToScene ? "the scene" : null} />
        </>
      )}

      {characters.length === 0 && !needsFinding && !proposal && (
        <p className="muted">No characters yet. Name them in your scenes and find them here, or make a character yourself.</p>
      )}
      {settingsMessage && <p className="hint">{settingsMessage}</p>}
    </Sheet>
  );
}

function listNumbers(numbers: number[]) {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}
