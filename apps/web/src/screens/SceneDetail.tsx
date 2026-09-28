import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiProblem, type Scene, type Account } from '../api';
import { ProblemBox } from '../components/ProblemBox';
import { OptionPicker } from '../components/OptionPicker';
import { SceneThumbnail } from '../components/SceneThumbnail';
import { SceneImprover } from '../components/SceneImprover';
import { CopyButton } from '../components/CopyButton';
import { sceneText } from '../sceneExport';
import { CartoonHeader } from '../components/ProjectTabs';
import { sceneLink } from '../sceneState';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';
type Field = keyof Scene;

interface Props {
  account: Account;
}

/**
 * Scene detail — SC-3.
 *
 * Saves on blur rather than behind a Save button (SC-5): a young user should never lose work
 * by navigating away, and there is no "did I save?" question to answer.
 *
 * Two things this has to get right, both learned the hard way:
 *
 *  1. A save response must NOT replace the whole local record. While one field's save is in
 *     flight the user is usually typing in the next field, and the server's reply knows
 *     nothing about that text. Overwriting wholesale silently erased what they had just
 *     typed. Server values are therefore merged only into fields that are not dirty.
 *
 *  2. Saves are serialised. Each PATCH carries If-Match with the version, so two overlapping
 *     saves would send the same version and the second would 409 (NF-10). Chaining them keeps
 *     the version fresh without the user ever seeing a conflict they did not cause.
 */
export function SceneDetail({ account }: Props) {
  const { sceneId } = useParams();
  // A different scene gets independent form refs and a save queue.
  return <SceneEditor key={sceneId} account={account} />;
}

function SceneEditor({ account }: Props) {
  const { projectId, sceneId } = useParams<{ projectId: string; sceneId: string }>();
  const navigate = useNavigate();

  const [scene, setScene] = useState<Scene | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [projectMode, setProjectMode] = useState(account.default_editor_mode);
  const [hasConflict, setHasConflict] = useState(false);
  const [continuing, setContinuing] = useState(false);
  const [projectTitle, setProjectTitle] = useState('');
  /** The cartoon's scenes in order, for "Scene 2 of 4" and the arrows between scenes. */
  const [siblings, setSiblings] = useState<Scene[]>([]);
  const [search] = useSearchParams();
  const fromMake = search.get('from') === 'make';
  const conflict = useRef(false);

  /** The server's last confirmed record. Source of the version sent as If-Match. */
  const committed = useRef<Scene | null>(null);
  /**
   * The live form values. State drives rendering, but a queued save needs to read the
   * newest value at the moment it runs, and a setState updater is not a synchronous read.
   */
  const live = useRef<Scene | null>(null);
  /** Fields edited locally and not yet confirmed by the server. */
  const dirty = useRef<Set<Field>>(new Set());
  /** Tail of the save chain, so PATCHes never overlap and versions never race. */
  const queue = useRef<Promise<void>>(Promise.resolve());

  const friendly = projectMode === 'simple';

  useEffect(() => {
    if (!projectId) return;
    void api.getProject(projectId).then((p) => { setProjectMode(p.editor_mode); setProjectTitle(p.title); }).catch(setError);
    void api.listScenes(projectId).then((r) => setSiblings(r.data)).catch(() => { /* the arrows are optional */ });
  }, [projectId]);

  useEffect(() => {
    if (!sceneId) return;
    setError(null);
    dirty.current.clear();
    api
      .getScene(sceneId)
      .then((s) => {
        setScene(s);
        committed.current = s;
        live.current = s;
      })
      .catch(setError);
  }, [sceneId]);

  useEffect(() => {
    const timer = setInterval(() => { for (const field of dirty.current) void enqueue(field); }, 10_000);
    return () => clearInterval(timer);
  }, []);

  function edit<K extends Field>(field: K, value: Scene[K]) {
    if (!live.current) return;
    dirty.current.add(field);
    live.current = { ...live.current, [field]: value };
    setScene(live.current);
  }

  /** Applies a server record without clobbering anything the user is still editing. */
  function reconcile(fromServer: Scene) {
    committed.current = fromServer;
    const merged = { ...fromServer };
    for (const field of dirty.current) {
      if (live.current) (merged as Record<string, unknown>)[field as string] = live.current[field];
    }
    live.current = merged;
    setScene(merged);
  }

  function enqueue(field: Field) {
    queue.current = queue.current.then(async () => {
      if (conflict.current) return;
      const current = committed.current;
      if (!current || !live.current) return;

      // Read the freshest value at the moment this link of the chain runs, not the value
      // captured when the blur fired — the user may have typed more since.
      const value = live.current[field];
      if (value === current[field]) {
        dirty.current.delete(field);
        return;
      }

      setSaveState('saving');
      try {
        const updated = await api.updateScene(
          current.id,
          { [field]: value } as Partial<Scene>,
          current.version,
        );
        // The field is clean only if nothing was typed into it while the save was away.
        if (live.current && live.current[field] === value) dirty.current.delete(field);
        reconcile(updated);
        setSaveState('saved');
        setError(null);
      } catch (err) {
        setSaveState('error');
        setError(err);
        if (err instanceof ApiProblem && err.problem.status === 409) {
          conflict.current = true;
          setHasConflict(true);
          const fresh = await api.getScene(current.id).catch(() => null);
          if (fresh) reconcile(fresh);
        }
      }
    });
    return queue.current;
  }

  function save(field: Field) {
    if (!dirty.current.has(field)) return;
    void enqueue(field);
  }

  /** Pickers commit immediately — there is no blur to wait for. */
  function saveNow<K extends Field>(field: K, value: Scene[K]) {
    edit(field, value);
    void enqueue(field);
  }

  async function flushEdits() {
    for (const field of dirty.current) void enqueue(field);
    await queue.current;
    if (dirty.current.size || conflict.current) throw new ApiProblem({
      status: 409, type: 'about:blank', title: 'Save your scene first',
      detail: 'Resolve any save problems before continuing. Your text is still here.',
    });
  }

  async function resolveSaveConflict(keepMine: boolean) {
    try {
      const fresh = await api.getScene(sceneId!);
      if (!keepMine) dirty.current.clear();
      reconcile(fresh);
      conflict.current = false; setHasConflict(false); setError(null);
      if (keepMine) await flushEdits();
    } catch (err) { setError(err); }
  }

  async function mutateThumbnail(action: (saved: Scene) => Promise<unknown>) {
    await flushEdits();
    const change = queue.current.then(async () => {
      if (!committed.current) return;
      await action(committed.current);
      reconcile(await api.getScene(committed.current.id));
    });
    queue.current = change.catch(() => {});
    await change;
  }

  async function removeScene() {
    if (!scene || !projectId) return;
    if (!confirm(`Move scene ${scene.scene_number}, "${scene.title}", to the bin? You can put it back from Story.`)) {
      return;
    }
    try {
      await api.deleteScene(scene.id);
      navigate(`/projects/${projectId}`, { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  if (error && !scene) return <ProblemBox error={error} />;
  if (!scene) return <p className="muted">Loading…</p>;

  const index = siblings.findIndex((s) => s.id === scene.id);
  const prev = index > 0 ? siblings[index - 1] : null;
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
  /** Leave this scene only once its edits are saved. */
  async function go(to: string) {
    setContinuing(true);
    try { await flushEdits(); navigate(to); }
    catch (err) { setError(err); }
    finally { setContinuing(false); }
  }

  const saveLabel =
    saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'All changes saved' : '';

  return (
    <>


      {projectId && <CartoonHeader projectId={projectId} title={projectTitle || ' '} step="write" />}
      <header className="scene-head">
        <p className="muted">Scene {scene.scene_number}{siblings.length ? ` of ${siblings.length}` : ''}</p>
        <h3 className="scene-title">{scene.title}</h3>
        <CopyButton text={() => sceneText(live.current ?? scene)} />
        {/* SC-5 requires a visible save-state indicator; silence is not an answer. */}
        <p className="save-state" role="status" aria-live="polite">
          {saveLabel}
        </p>
        <p className="hint">Your edits save automatically when you leave a box, and every 10 seconds while you write. AI suggestions are saved only when you choose to use them.</p>
      </header>

      <ProblemBox error={error} />
      {hasConflict && <div className="card stack">
        <p>This scene was edited somewhere else. Your unsaved text is still in the fields below.</p>
        <div className="row">
          <button type="button" onClick={() => void resolveSaveConflict(true)}>Save my changes</button>
          <button type="button" className="secondary" onClick={() => void resolveSaveConflict(false)}>Use saved version</button>
        </div>
      </div>}

      <section className="card stack">
        <h3>The basics</h3>

        <div className="field">
          <label htmlFor="title">What's this scene called?</label>
          <input
            id="title"
            value={scene.title}
            onChange={(e) => edit('title', e.target.value)}
            onBlur={() => save('title')}
          />
        </div>

      <details className="scene-settings">
        <summary>Camera, time and mood</summary>
        <div className="stack scene-settings-body">

        <div className="field">
          <span className="label-text">Camera angle</span>
          <p className="hint">These choices guide improved descriptions and scene sketches, including when they differ from your text.</p>
          <OptionPicker vocabulary="camera_angle" value={scene.camera_angle ?? 'eye_level'}
            friendly={friendly} allowedValues={['eye_level', 'low_angle', 'high_angle', 'birds_eye', 'profile', 'three_quarter']}
            onChange={(value) => saveNow('camera_angle', value)} />
        </div>

        <div className="field">
          <span className="label-text">What time of day is it?</span>
          <OptionPicker
            vocabulary="time_of_day"
            value={scene.time_of_day}
            friendly={friendly}
            onChange={(v) => saveNow('time_of_day', v ?? 'unspecified')}
          />
        </div>

        <div className="field">
          <span className="label-text">What's the mood?</span>
          <OptionPicker
            vocabulary="mood_atmosphere"
            value={scene.mood_atmosphere}
            friendly={friendly}
            allowNone
            onChange={(v) => saveNow('mood_atmosphere', v)}
          />
        </div>

      </div>
      </details>

        <div className="field">
          <label htmlFor="description">Scene description</label>
          <p className="hint">
            Describe where we are, who is there, and what happens. Example: "Two dogs chase a biscuit
            across a sunny kitchen, sliding between the table legs and scattering crumbs."
          </p>
          <textarea
            id="description"
            rows={7}
            maxLength={12000}
            value={scene.description}
            onChange={(e) => edit('description', e.target.value)}
            onBlur={() => save('description')}
          />
        </div>
        <SceneImprover scene={scene} beforeGenerate={flushEdits} mutate={mutateThumbnail} />
      </section>



      <details className="card optional-sketch">
        <summary>Optional: a quick sketch of this scene</summary>
        <SceneThumbnail scene={scene} beforeGenerate={flushEdits} mutate={mutateThumbnail} />
      </details>

      <div className="row danger-row">
        <button className="secondary danger-text" onClick={removeScene} type="button">
          Delete this scene
        </button>
      </div>

      {/* Always on screen: move between scenes, or go and make this scene's clip. */}
      <nav className="scene-dock" aria-label="Scene navigation">
        <button type="button" className="icon secondary" aria-label="Previous scene" disabled={!prev || continuing} onClick={() => prev && void go(sceneLink(projectId!, prev.id, fromMake ? 'make' : undefined))}>‹</button>
        <span className="scene-dock-count">Scene {scene.scene_number}{siblings.length ? ` of ${siblings.length}` : ''}</span>
        <button type="button" className="icon secondary" aria-label="Next scene" disabled={!next || continuing} onClick={() => next && void go(sceneLink(projectId!, next.id, fromMake ? 'make' : undefined))}>›</button>
        <span className="scene-dock-space" />
        {!scene.description.trim() && <span className="hint">Write what happens first.</span>}
        <button type="button" disabled={!scene.description.trim() || continuing || hasConflict}
          onClick={() => void go(`/projects/${projectId}/director?scene=${scene.id}`)}>
          {continuing ? 'Saving your scene…' : 'Make this scene’s clip →'}
        </button>
      </nav>
    </>
  );
}
