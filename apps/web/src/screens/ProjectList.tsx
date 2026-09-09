import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import { ProblemBox } from '../components/ProblemBox';
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function CartoonCard({ p, busy }: { p: Project; busy: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: busy });
  return <article ref={setNodeRef} className="card project-card" style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined, opacity: isDragging ? .8 : 1 }}>
    <div className="cartoon-card-head">
      <span className="chip">{p.series_number ? `Series - No ${p.series_number}` : 'Series - Not numbered'}</span>
      <button className="grip" type="button" disabled={busy} {...attributes} {...listeners} aria-label={`Move ${p.title}`} title="Drag to reorder">
        <svg width="20" height="24" viewBox="0 0 20 24" fill="currentColor" aria-hidden="true" focusable="false">
          <circle cx="6" cy="5" r="2" /><circle cx="14" cy="5" r="2" />
          <circle cx="6" cy="12" r="2" /><circle cx="14" cy="12" r="2" />
          <circle cx="6" cy="19" r="2" /><circle cx="14" cy="19" r="2" />
        </svg>
      </button>
    </div>
    <Link to={`/projects/${p.id}`}><h3>{p.title}</h3></Link>
    <p>{p.logline || 'No description yet.'}</p>
    <div className="meta"><span>{p.scene_count ?? 0} scenes</span></div>
    <div className="project-dates">
      <span>Created <time dateTime={p.created_at}>{new Date(p.created_at).toLocaleString()}</time></span>
      <span>Updated <time dateTime={p.updated_at}>{new Date(p.updated_at).toLocaleString()}</time></span>
    </div>
  </article>;
}


export function ProjectList() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [deleted, setDeleted] = useState<Project[]>([]);
  const [showBin, setShowBin] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);

  async function restore(p: Project) {
    setSaving(true); setError(null);
    try {
      await api.restoreProject(p.id);
      const [live, binned] = await Promise.all([api.listProjects(), api.listDeletedProjects()]);
      setProjects(live.data); setDeleted(binned.data);
    } catch (err) { setError(err); }
    finally { setSaving(false); }
  }

  const bin = deleted.length > 0 && <section className="bin card">
    <button type="button" className="secondary" onClick={() => setShowBin((v) => !v)} aria-expanded={showBin}>
      {showBin ? 'Hide the bin' : `Bin (${deleted.length})`}
    </button>
    {showBin && <ul className="bin-list">
      {deleted.map((p) => <li key={p.id}>
        <span><strong>{p.title}</strong> <span className="muted">· deleted {p.deleted_at ? new Date(p.deleted_at).toLocaleDateString() : ''}</span></span>
        <button type="button" disabled={saving} onClick={() => void restore(p)}>Put back</button>
      </li>)}
    </ul>}
  </section>;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  async function reorder({ active, over }: DragEndEvent) {
    if (!projects || saving || !over || active.id === over.id) return;
    const from = projects.findIndex((p) => p.id === active.id);
    const to = projects.findIndex((p) => p.id === over.id);
    if (from < 0 || to < 0) return;
    const previous = projects;
    const next = arrayMove(projects, from, to).map((p, i) => ({ ...p, series_number: i + 1 }));
    setProjects(next); setSaving(true); setError(null);
    try {
      await api.reorderProjects(next.map((p) => p.id));
      setProjects((await api.listProjects()).data);
    } catch (err) {
      setError(err);
      setProjects((await api.listProjects().catch(() => ({ data: previous }))).data);
    } finally { setSaving(false); }
  }

  useEffect(() => {
    api.listProjects().then((r) => setProjects(r.data)).catch(setError);
    api.listDeletedProjects().then((r) => setDeleted(r.data)).catch(() => { /* the bin is optional */ });
  }, []);

  if (error && !projects) return <ProblemBox error={error} />;
  if (!projects) return <p className="muted">Loading your cartoons…</p>;

  if (projects.length === 0) {
    return (
      <div className="empty card">
        <h2>No cartoons yet</h2>
        <p>A cartoon is one story. Inside it you build the scenes that make it up.</p>
        <Link className="btn" to="/projects/new">
          Make your first cartoon
        </Link>
        {bin}
        <ProblemBox error={error} />
      </div>
    );
  }

  return (
    <>
      <div className="section-head">
        <h2>Your cartoons</h2>
        <span className="muted">{projects.length} in total</span>
      </div>

      <p className="hint">Drag a card by its handle to move it left or right, or between rows. Series numbers update automatically. With a keyboard, press Space on a handle, use the arrow keys, then Space to drop.</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void reorder(event)}>
        <SortableContext items={projects.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className="grid">{projects.map((p) => <CartoonCard key={p.id} p={p} busy={saving} />)}</div>
        </SortableContext>
      </DndContext>
      <ProblemBox error={error} />
      <p className="hint" role="status">{saving ? 'Saving…' : 'Order saves automatically.'}</p>
      {bin}
    </>
  );
}
