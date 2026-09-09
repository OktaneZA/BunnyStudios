import { useEffect, useRef, useState } from 'react';
import { api, type Scene, type ThumbnailProposal } from '../api';
import { ProblemBox } from './ProblemBox';
import { uuid } from '../uuid';

interface Props {
  scene: Scene;
  beforeGenerate: () => Promise<void>;
  mutate: (action: (saved: Scene) => Promise<unknown>) => Promise<void>;
}

export function SceneThumbnail({ scene, beforeGenerate, mutate }: Props) {
  const [settings, setSettings] = useState<Awaited<ReturnType<typeof api.aiSettings>> | null>(null);
  const [proposal, setProposal] = useState<ThumbnailProposal | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const requestId = useRef<string | null>(null);
  const key = `storyboard.thumbnail.${scene.id}`;

  function remember(id: string | null) {
    requestId.current = id;
    try { if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key); } catch { /* private mode */ }
  }

  useEffect(() => {
    let alive = true;
    void api.aiSettings().then((value) => { if (alive) setSettings(value); }).catch((err) => { if (alive) setError(err); });
    let pending: string | null = null;
    try { pending = sessionStorage.getItem(key); } catch { /* private mode */ }
    requestId.current = pending;
    // Recover previews from the server even after a reload or a retry on another device.
    void api.latestThumbnailProposal(scene.id).then(({ proposal: saved }) => {
      if (!alive) return;
      setProposal(saved);
      if (saved) remember(saved.id);
    }).catch((err) => { if (alive) setError(err); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [scene.id, key]);

  useEffect(() => {
    if (proposal?.status !== 'generating') return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const value = await api.thumbnailProposal(scene.id, proposal!.id);
        if (!alive || requestId.current !== proposal!.id) return;
        setProposal(value);
        setError(null);
        if (value.status === 'generating') timer = setTimeout(poll, 1200);
      } catch (err) {
        if (alive) { setError(err); timer = setTimeout(poll, 4000); }
      }
    }
    timer = setTimeout(poll, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [scene.id, proposal?.id, proposal?.status]);

  async function make() {
    setBusy(true); setError(null);
    try {
      await beforeGenerate();
      if (proposal) {
        await api.resolveThumbnail(scene.id, proposal.id, 'cancel');
        remember(null);
      }
      // Preserve this id across a lost response: retrying cannot purchase another sketch.
      const id = requestId.current ?? uuid();
      remember(id);
      const result = await api.makeThumbnail(scene.id, id);
      setProposal(result);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!requestId.current) return;
    setBusy(true); setError(null);
    try {
      await api.resolveThumbnail(scene.id, requestId.current, 'cancel');
      remember(null); setProposal(null);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function accept() {
    if (!proposal) return;
    setBusy(true); setError(null);
    try {
      await mutate(() => api.resolveThumbnail(scene.id, proposal.id, 'accept'));
      remember(null); setProposal(null);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true); setError(null);
    try { await mutate((saved) => api.removeThumbnail(saved.id, saved.version)); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const generating = proposal?.status === 'generating';
  const preview = proposal?.status === 'ready' ? proposal.preview : null;
  return (
    <section className="card stack thumbnail-panel" aria-labelledby="thumbnail-heading">
      <div>
        <h3 id="thumbnail-heading">A little picture of this scene</h3>
        <p className="hint">Make a simple sketch to help you recognise this scene on your board. It’s optional.</p>
      </div>
      <div className="thumbnail-columns">
        {(scene.thumbnail || !preview) && <figure className="thumbnail-figure">
          {scene.thumbnail ? <img src={scene.thumbnail.src} alt={scene.thumbnail.description} />
            : <div className="thumbnail-placeholder">Your scene sketch goes here</div>}
          <figcaption>{scene.thumbnail?.stale ? 'The scene has changed. You can keep this sketch or make a new one.' : 'Current scene thumbnail'}</figcaption>
        </figure>}
        {preview && <figure className="thumbnail-figure thumbnail-preview">
          <img src={preview.src} alt={preview.description} />
          <figcaption>Preview — choose “Use on scene board” to save this as your scene’s thumbnail.</figcaption>
        </figure>}
      </div>
      <div role="status" aria-live="polite">
        {generating && <p className="ai-progress"><span className="ai-spinner" aria-hidden="true" />AI is sketching your scene… You can keep writing while you wait.</p>}
        {checking && <p className="muted">Checking for a thumbnail preview…</p>}
        {settings?.message && <p className="muted">{settings.message}</p>}
        {proposal?.status === 'failed' && <p>{proposal.error}</p>}
        {proposal?.status === 'expired' && <p>This preview expired. You can make a new one.</p>}
      </div>
      <ProblemBox error={error} />
      <div className="row thumbnail-controls">
        {preview && <button type="button" onClick={() => void accept()} disabled={busy || scene.is_locked}>Use on scene board</button>}
        {!generating && <button type="button" className={preview ? 'secondary' : ''} onClick={() => void make()}
          disabled={busy || checking || !settings?.thumbnails_enabled || scene.is_locked}>
          {busy && <span className="ai-spinner" aria-hidden="true" />}
          {busy ? 'Please wait…' : proposal ? 'Try again' : requestId.current ? 'Retry request' : scene.thumbnail ? 'Make a new thumbnail' : 'Make a thumbnail'}
        </button>}
        {(proposal || requestId.current) && <button type="button" className="secondary" onClick={() => void cancel()} disabled={busy}>Cancel</button>}
        {scene.thumbnail && !proposal && <button type="button" className="secondary" onClick={() => void remove()} disabled={busy || scene.is_locked}>Remove thumbnail</button>}
      </div>
    </section>
  );
}
