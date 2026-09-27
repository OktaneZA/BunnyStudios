import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { director, formatPence, isActiveJob, type CastList, type Character, type CastProposal, type Job, type ModelInfo } from '../director-api';
import { uuid } from '../uuid';
import { ProblemBox } from './ProblemBox';
import { Sheet } from './Sheet';
import { AssetImage } from './AssetMedia';
import { JobProgress } from './JobProgress';

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
}

/**
 * Your cast (plan D39, DM-5–DM-7): found from the story, never typed in. The sheet lets the
 * child give each person a picture; changing how they look means editing the story.
 */
export function CastSheet({ projectId, cast, models, jobs, onJob, refreshCast, onClose, advanced, settingsMessage }: Props) {
  const characters = cast?.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CastProposal | null>(null);
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = characters.find((c) => c.id === selectedId) ?? characters[0] ?? null;
  useEffect(() => { if (!selectedId && characters[0]) setSelectedId(characters[0].id); }, [characters, selectedId]);

  const drawModel = useMemo(() => models.filter((m) => m.kind === 'image').sort((a, b) => a.unit_cost_pence - b.unit_cost_pence)[0] ?? null, [models]);
  const anglesModel = useMemo(() => models.filter((m) => m.kind === 'image' && m.capabilities.reference_images).sort((a, b) => a.unit_cost_pence - b.unit_cost_pence)[0] ?? null, [models]);
  const myJobs = selected ? jobs.filter((j) => j.target_entity_type === 'character' && j.target_entity_id === selected.id) : [];
  const latestJob = myJobs[0] ?? null;
  const newIds = new Set(latestJob?.results.map((a) => a.id) ?? []);

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

  async function uploadPicture(file: File | undefined) {
    if (!file || !selected) return;
    setBusy(true); setError(null);
    try { await director.uploadReference(selected.id, file); await refreshCast(); }
    catch (err) { setError(err); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }

  async function draw(intent: 'portrait' | 'angles') {
    const model = intent === 'portrait' ? drawModel : anglesModel;
    if (!selected || !model) return;
    setBusy(true); setError(null);
    try {
      const job = await director.drawCharacter(selected.id, { intent, model_id: model.id, count: intent === 'portrait' ? 2 : 1 }, uuid());
      onJob({ ...job, target_entity_type: 'character', target_entity_id: selected.id, model_id: model.id, attempt: job.attempt ?? 1, created_at: job.created_at ?? new Date().toISOString(), finished_at: job.finished_at ?? null });
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function useThisOne(c: Character, assetId: string) {
    setBusy(true); setError(null);
    try { await director.updateCharacter(c.id, { main_reference_asset_id: assetId }); await refreshCast(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const needsFinding = cast ? cast.never_found || cast.story_changed : false;
  const drawCost = drawModel ? `About ${formatPence(drawModel.unit_cost_pence * 2)} a go.` : settingsMessage ?? 'Picture makers are not set up yet.';

  return (
    <Sheet title="Your cast" lede="Found in your story. Pictures help you plan their look. Clips use your written descriptions, so describe each character the same way in every scene." onClose={onClose}>
      <ProblemBox error={error} />

      {needsFinding && !proposal && (
        <div className="cast-find card-soft">
          <p>{cast?.never_found ? 'Nobody has been found yet. The finder reads your scenes and lists who is in them.' : 'Your story changed since the cast was found. Find it again to catch anyone new.'}</p>
          <button type="button" onClick={() => void find()} disabled={finding || !cast?.finder_enabled}>
            {finding && <span className="ai-spinner" aria-hidden="true" />}
            {finding ? 'Reading your story…' : 'Find my cast'}
          </button>
          {cast && !cast.finder_enabled && <p className="hint">The cast finder is not set up yet. Ask a grown-up to add the Claude key.</p>}
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
            {c.name}
          </button>
        ))}
        <button type="button" className="cast-chip add" onClick={() => setAdding((v) => !v)} aria-expanded={adding}>+ Someone missing?</button>
      </div>

      {adding && (
        <form className="card-soft stack" onSubmit={addSomeone}>
          <div className="field">
            <label htmlFor="new-name">Who is missing?</label>
            <input id="new-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Their name" maxLength={60} />
          </div>
          <div className="field">
            <label htmlFor="new-desc">What do they look like?</label>
            <p className="hint">Example: "A tall girl with red curly hair, green dungarees and a big grin."</p>
            <textarea id="new-desc" rows={3} value={newDescription} onChange={(e) => setNewDescription(e.target.value)} maxLength={600} />
          </div>
          <div className="row">
            <button type="submit" disabled={busy || !newName.trim()}>Add {newName.trim() || 'them'}</button>
            <button type="button" className="secondary" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}

      {selected && (
        <>
          <div className="cast-person">
            <h4>{selected.name}</h4>
            <p className="muted">
              {selected.description ? <>{selected.source === 'story' ? 'From your story:' : 'You said:'} <i>{selected.description}</i></> : 'Your story does not say what they look like yet.'}
              {selected.scene_numbers.length > 0 && <> In {selected.scene_numbers.length === 1 ? 'scene' : 'scenes'} {listNumbers(selected.scene_numbers)}.</>}
            </p>
            {selected.pictures_stale && <p className="hint">The story changed how {selected.name} is described. These pictures may not match any more.</p>}
          </div>

          <div className="cast-pictures">
            <h4>{possessive(selected.name)} pictures</h4>
            <div className="ref-strip">
              {orderRefs(selected).filter((a) => !newIds.has(a.id)).map((a) => (
                <div key={a.id} className={`ref-tile${a.id === selected.main_reference?.id ? ' main' : ''}`}>
                  <AssetImage url={a.url} alt={`${selected.name} picture`} />
                  {a.id === selected.main_reference?.id
                    ? <span className="ref-tag">Main</span>
                    : <button type="button" className="ref-use" disabled={busy} onClick={() => void useThisOne(selected, a.id)}>Use this one</button>}
                </div>
              ))}
              <label className="ref-tile add">
                <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => void uploadPicture(e.target.files?.[0])} disabled={busy} />
                + Add
              </label>
            </div>
          </div>

          <div className="row cast-actions">
            <button type="button" onClick={() => void draw('portrait')} disabled={busy || !drawModel || !selected.description}>Draw {selected.name}</button>
            <button type="button" className="secondary" onClick={() => void draw('angles')} disabled={busy || !anglesModel || !selected.main_reference}>More angles</button>
            <button type="button" className="secondary" onClick={() => fileInput.current?.click()} disabled={busy}>Upload a drawing</button>
            <span className="hint">{drawCost}</span>
          </div>
          {!selected.description && <p className="hint">Say what {selected.name} looks like in a scene first, then Draw works.</p>}

          {latestJob && (
            <div className="cast-new">
              <h4>New pictures</h4>
              {isActiveJob(latestJob) && <JobProgress job={latestJob} what="pictures" />}
              {latestJob.status === 'failed' && <p className="problem-inline">{latestJob.error ?? 'That did not work. Try again.'}</p>}
              {latestJob.held_back > 0 && <p className="hint">{latestJob.held_back === 1 ? '1 picture was' : `${latestJob.held_back} pictures were`} held back by the safety checker.</p>}
              {latestJob.results.length > 0 && (
                <div className="ref-strip">
                  {latestJob.results.map((a) => (
                    <div key={a.id} className={`ref-tile${a.id === selected.main_reference?.id ? ' main' : ''}`}>
                      <AssetImage url={a.url} alt={`New picture of ${selected.name}`} />
                      {a.id === selected.main_reference?.id
                        ? <span className="ref-tag">Main</span>
                        : <button type="button" className="ref-use" disabled={busy} onClick={() => void useThisOne(selected, a.id)}>Use this one</button>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="hint cast-foot">To change how {selected.name} looks, edit the scenes in <b>Story</b>.</p>
        </>
      )}

      {characters.length === 0 && !needsFinding && !proposal && (
        <p className="muted">Nobody is in the cast yet. Name people in your scenes in Story, then find them here.</p>
      )}
    </Sheet>
  );
}

function orderRefs(c: Character) {
  const main = c.references.find((a) => a.id === c.main_reference?.id);
  return main ? [main, ...c.references.filter((a) => a.id !== main.id)] : c.references;
}

function listNumbers(numbers: number[]) {
  if (numbers.length <= 1) return numbers.join('');
  return `${numbers.slice(0, -1).join(', ')} and ${numbers[numbers.length - 1]}`;
}

function possessive(name: string) {
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}
