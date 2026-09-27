import { useEffect, useState, type FormEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { restrictToParentElement, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { api, type Project, type Scene } from '../api';
import { director, type Timeline } from '../director-api';
import { ProblemBox } from '../components/ProblemBox';
import { SceneRow } from '../components/SceneRow';
import { CopyButton } from '../components/CopyButton';
import { storyText } from '../sceneExport';
import { CartoonHeader } from '../components/ProjectTabs';

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [binned, setBinned] = useState<Scene[]>([]);
  const [showBin, setShowBin] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  // The same clip state Make clips shows, so a scene reads the same in both steps.
  const [timeline, setTimeline] = useState<Timeline | null>(null);

  const sensors = useSensors(
    // A small distance threshold stops a stray click registering as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    // On touch, a short press-and-hold distinguishes "pick this up" from "scroll the page".
    // Without the delay, dragging the handle and flicking the board would be the same gesture.
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (!id) return;
    setError(null);
    Promise.all([api.getProject(id), api.listScenes(id)])
      .then(([p, s]) => {
        setProject(p);
        setScenes(s.data);
      })
      .catch(setError);
    api.listDeletedScenes(id).then((r) => setBinned(r.data)).catch(() => { /* the bin is optional */ });
    director.timeline(id).then(setTimeline).catch(() => { /* clip state is optional here */ });
  }, [id]);

  async function addScene(e: FormEvent) {
    e.preventDefault();
    if (!id || !title.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const scene = await api.createScene(id, { title: title.trim() });
      setScenes((prev) => [...(prev ?? []), scene]);
      setTitle('');
    } catch (err) {
      setError(err);
    } finally {
      setAdding(false);
    }
  }

  /**
   * Applies a new order optimistically, then persists the whole list.
   *
   * The server's response replaces local state because scene_number is derived server-side
   * and never trusted from the client. On failure the board is refetched rather than left
   * showing an order that was never saved.
   */
  async function persistOrder(next: Scene[]) {
    if (!id) return;
    setScenes(next.map((s, i) => ({ ...s, scene_number: i + 1 })));
    setSaving(true);
    setError(null);
    try {
      const result = await api.reorderScenes(id, next.map((s) => s.id));
      setScenes(result.data);
    } catch (err) {
      setError(err);
      const fresh = await api.listScenes(id).catch(() => null);
      if (fresh) setScenes(fresh.data);
    } finally {
      setSaving(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    if (!scenes) return;
    const target = index + direction;
    if (target < 0 || target >= scenes.length) return;
    void persistOrder(arrayMove(scenes, index, target));
  }

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!scenes || !over || active.id === over.id) return;

    const from = scenes.findIndex((s) => s.id === active.id);
    const to = scenes.findIndex((s) => s.id === over.id);
    if (from === -1 || to === -1) return;

    void persistOrder(arrayMove(scenes, from, to));
  }

  async function removeScene(scene: Scene) {
    if (!id) return;
    if (!confirm(`Move scene ${scene.scene_number}, "${scene.title}", to the bin? You can put it back later.`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteScene(scene.id);
      await refreshScenes();
    } catch (err) {
      setError(err);
    }
  }

  async function refreshScenes() {
    if (!id) return;
    const [fresh, bin] = await Promise.all([api.listScenes(id), api.listDeletedScenes(id)]);
    setScenes(fresh.data);
    setBinned(bin.data);
  }

  async function restoreScene(scene: Scene) {
    setSaving(true);
    setError(null);
    try {
      await api.restoreScene(scene.id);
      await refreshScenes();
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function removeProject() {
    if (!project) return;
    if (!confirm(`Move "${project.title}" to the bin? Its scenes go with it. You can put it back from the cartoons page.`)) {
      return;
    }
    setError(null);
    try {
      await api.deleteProject(project.id);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err);
    }
  }

  if (error && !project) return <ProblemBox error={error} />;
  if (!project || !scenes) return <p className="muted">Loading…</p>;
  const nextToDescribe = scenes.find((s) => !s.description.trim());

  return (
    <>


      <CartoonHeader projectId={project.id} title={project.title} step="write">
        {project.logline && <p className="lede">{project.logline}</p>}
        <p className="hint">Write what happens in each scene. Then go to <b>Make clips</b>.</p>
      </CartoonHeader>

      <ProblemBox error={error} />

      {scenes.length > 0 && (
        <section className="next-step card" aria-label="Next step">
          <div>
            <h3>{nextToDescribe ? 'Write your scenes' : 'Your story is ready'}</h3>
            <p className="hint">{nextToDescribe
              ? 'Give each scene a description: who is there, where they are, and what happens.'
              : 'Every scene has words. Make a clip for each one. You can come back and change the words any time.'}</p>
          </div>
          {nextToDescribe ? (
            <Link className="btn" to={`/projects/${project.id}/scenes/${nextToDescribe.id}`}>Write the next scene</Link>
          ) : <Link className="btn" to={`/projects/${project.id}/director`}>Make clips →</Link>}
        </section>
      )}

      <div className="section-head">
        <h3>Scenes {saving && <span className="muted">· saving order…</span>}</h3>
        <span className="muted">
          {scenes.length === 0 ? 'None yet' : `${scenes.length} in order`}
        </span>
      </div>

      {scenes.length === 0 ? (
        <div className="empty card">
          <p>
            A scene is one place at one time — like "Milo argues with the postman on the porch".
            Add your first one below.
          </p>
        </div>
      ) : (
        <>
          {scenes.length > 1 && (
            <p className="hint board-hint">
              Drag the ⠿ handle to move a scene, or use the arrows. They renumber themselves.
            </p>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
            accessibility={{
              // dnd-kit's defaults talk in positions; these name the scene being moved,
              // which is what a screen-reader user actually needs to follow the board.
              announcements: {
                onDragStart: ({ active }) => `Picked up scene ${String(active.data.current?.['title'] ?? '')}.`,
                onDragOver: ({ over }) =>
                  over ? `Now over position ${String(over.data.current?.['position'] ?? '')}.` : '',
                onDragEnd: ({ over }) =>
                  over
                    ? `Dropped into position ${String(over.data.current?.['position'] ?? '')}.`
                    : 'Dropped. Order unchanged.',
                onDragCancel: () => 'Move cancelled. The order is unchanged.',
              },
            }}
          >
            <SortableContext
              items={scenes.map((s) => s.id)}
              strategy={verticalListSortingStrategy}
            >
              <ol className="scene-list">
                {scenes.map((scene, i) => (
                  <SceneRow
                    key={scene.id}
                    projectId={project.id}
                    scene={scene}
                    index={i}
                    count={scenes.length}
                    busy={saving}
                    item={timeline?.items.find((item) => item.scene_id === scene.id) ?? null}
                    onMove={move}
                    onDelete={removeScene}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        </>
      )}

      <div className="row copy-row">
        <CopyButton label="Copy all scenes" disabled={saving || scenes.length === 0} text={() => storyText(project.title, project.logline, scenes)} />
        <span className="hint">Copies scene descriptions, camera, time, mood and your notes as text.</span>
      </div>

      <form className="card add-scene" onSubmit={addScene}>
        <label htmlFor="scene-title">Add a scene</label>
        <p className="hint">What happens in it? Example: "Milo finds the parcel on the porch".</p>
        <div className="row">
          <input
            id="scene-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Scene name"
          />
          <button type="submit" disabled={adding || !title.trim()}>
            {adding ? 'Adding…' : 'Add scene'}
          </button>
        </div>
      </form>

      {binned.length > 0 && (
        <section className="bin card">
          <button type="button" className="secondary" onClick={() => setShowBin((v) => !v)} aria-expanded={showBin}>
            {showBin ? 'Hide the bin' : `Bin (${binned.length})`}
          </button>
          {showBin && (
            <ul className="bin-list">
              {binned.map((s) => (
                <li key={s.id}>
                  <span>
                    <strong>{s.title}</strong>{' '}
                    <span className="muted">· deleted {s.deleted_at ? new Date(s.deleted_at).toLocaleDateString() : ''}</span>
                  </span>
                  <button type="button" disabled={saving} onClick={() => void restoreScene(s)}>Put back</button>
                </li>
              ))}
            </ul>
          )}
          <p className="hint">A scene you put back goes to the end of the board.</p>
        </section>
      )}

      <div className="row danger-row">
        <button className="secondary danger-text" onClick={() => void removeProject()} type="button" disabled={saving}>
          Delete this cartoon
        </button>
        <span className="hint">It goes to the bin, where you can put it back.</span>
      </div>
    </>
  );
}
