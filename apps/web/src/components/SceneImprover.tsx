import { useEffect, useRef, useState } from 'react';
import { api, type Scene, type ThumbnailProposal } from '../api';
import { ProblemBox } from './ProblemBox';
import { uuid } from '../uuid';

interface Props {
  scene: Scene;
  beforeGenerate: () => Promise<void>;
  mutate: (action: (saved: Scene) => Promise<unknown>) => Promise<void>;
}

export function SceneImprover({ scene, beforeGenerate, mutate }: Props) {
  const [enabled, setEnabled] = useState(false);
  const [checking, setChecking] = useState(true);
  const [proposal, setProposal] = useState<ThumbnailProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const requestId = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.aiSettings().then((s) => { if (alive) setEnabled(s.improve_enabled); }).catch((err) => { if (alive) setError(err); });
    void api.latestImprovement(scene.id).then(({ proposal: saved }) => {
      if (alive) { setProposal(saved); requestId.current = saved?.id ?? null; }
    }).catch((err) => { if (alive) setError(err); }).finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [scene.id]);

  useEffect(() => {
    if (proposal?.status !== 'generating') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api.improvement(scene.id, proposal!.id);
        if (!alive || requestId.current !== proposal!.id) return;
        setProposal(next); setError(null);
        if (next.status === 'generating') timer = setTimeout(poll, 1200);
      } catch (err) {
        if (alive) { setError(err); timer = setTimeout(poll, 4000); }
      }
    }
    timer = setTimeout(poll, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [scene.id, proposal?.id, proposal?.status]);

  async function improve() {
    setBusy(true); setError(null);
    try {
      await beforeGenerate();
      if (proposal) {
        await api.resolveImprovement(scene.id, proposal.id, 'cancel');
        requestId.current = null;
      }
      requestId.current ??= uuid();
      setProposal(await api.improveScene(scene.id, requestId.current));
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function resolve(action: 'accept' | 'cancel') {
    if (!requestId.current) return;
    setBusy(true); setError(null);
    try {
      const id = requestId.current;
      if (action === 'accept') await mutate(() => api.resolveImprovement(scene.id, id, action));
      else await api.resolveImprovement(scene.id, id, action);
      requestId.current = null; setProposal(null);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const generating = proposal?.status === 'generating';
  return <div className="improve-box stack">
    <div className="row thumbnail-controls">
      {!generating && <button type="button" className="secondary" onClick={() => void improve()}
        disabled={!enabled || checking || busy || scene.is_locked || !scene.description.trim()}>
        {busy && <span className="ai-spinner" aria-hidden="true" />}
        {busy ? 'Please wait…' : proposal ? 'Try another version' : 'Improve for me'}
      </button>}
      {(proposal || requestId.current) && <button type="button" className="secondary" disabled={busy} onClick={() => void resolve('cancel')}>Cancel improvement</button>}
    </div>
    <p className="hint">Add clearer details about the surroundings, what happens, and the people or animals, using your story title and other scenes for context. You choose whether to use the result.</p>
    <div role="status" aria-live="polite">
      {generating && <p className="ai-progress"><span className="ai-spinner" aria-hidden="true" />AI is improving your scene… You can keep writing while you wait.</p>}
      {!checking && !enabled && <p className="hint">AI writing help is not set up yet. You can keep editing here.</p>}
      {proposal?.status === 'failed' && <p>{proposal.error}</p>}
      {proposal?.status === 'expired' && <p>This suggestion expired. You can request a new one.</p>}
    </div>
    {proposal?.status === 'ready' && proposal.text && <div className="improvement-preview stack">
      <h4>Suggested description</h4>
      <p className="scene-description-preview">{proposal.text}</p>
      <button type="button" disabled={busy || scene.is_locked} onClick={() => void resolve('accept')}>Use this description</button>
    </div>}
    <ProblemBox error={error} />
  </div>;
}
