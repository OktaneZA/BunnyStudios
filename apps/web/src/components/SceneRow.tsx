import { Link } from 'react-router-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Scene } from '../api';
import type { TimelineItem } from '../director-api';
import { ItemStill } from './CartoonStrip';
import { SCENE_STATE_WORDS, sceneLink, sceneState } from '../sceneState';
import { CopyButton } from './CopyButton';
import { sceneText } from '../sceneExport';

interface Props {
  projectId: string;
  scene: Scene;
  index: number;
  count: number;
  busy: boolean;
  /** This scene on the cartoon's timeline: its clip, picture or sketch. */
  item?: TimelineItem | null;
  onMove: (index: number, direction: -1 | 1) => void;
  onDelete: (scene: Scene) => void;
}

/**
 * One row on the scene board.
 *
 * Reordering is offered three ways deliberately: drag by the grip, the up/down buttons, and
 * the keyboard (the grip is focusable — space picks it up, arrows move it, space drops it).
 * The buttons are not a legacy fallback; on a tablet they are often the easier option, and
 * they are what satisfies NF-24 without relying on drag behaving well under touch.
 */
export function SceneRow({ projectId, scene, index, count, busy, onMove, onDelete, item }: Props) {
  const thumbnail = scene.thumbnail ?? scene.thumbnail_preview;
  const state = sceneState({ hasClip: item?.source === 'video', making: Boolean(item?.making), hasDescription: Boolean(scene.description.trim()) });
  const link = sceneLink(projectId, scene.id);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: scene.id,
    // Carried into the drag announcements so a screen reader can say which scene moved
    // and where it landed, rather than reading out opaque ids.
    data: { title: scene.title, position: index + 1 },
  });

  return (
    <li
      ref={setNodeRef}
      className={`card scene-row${isDragging ? ' dragging' : ''}`}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        // Lift the dragged row above its neighbours so it is clearly the thing moving.
        zIndex: isDragging ? 2 : undefined,
      }}
    >
      <button
        className="grip"
        // Drag is a pointer/keyboard affordance on this handle only, so dragging can never
        // be confused with scrolling the page on a touch screen.
        {...attributes}
        {...listeners}
        aria-label={`Reorder scene ${scene.scene_number}, ${scene.title}`}
        title="Drag to reorder"
        type="button"
      >
        <span aria-hidden="true">⠿</span>
      </button>

      <span className="scene-number" aria-hidden="true">
        {scene.scene_number}
      </span>

      <div className="scene-body">
        {/* The same still the film strip in Make clips shows: the clip, else the sketch, else empty. */}
        <Link className="scene-thumbnail" to={link} aria-label={`Open scene ${scene.scene_number}: ${scene.title}`}>
          {item?.source === 'video' ? <ItemStill item={item} />
            : thumbnail ? <img src={thumbnail.src} alt={thumbnail.description} loading="lazy" />
            : <span className="thumbnail-placeholder">{scene.description.trim() ? 'No clip yet' : 'Write what happens'}</span>}
        </Link>
        <h4>
          <Link to={link}>{scene.title}</Link>
        </h4>
        <span className={`scene-state ${state}`}><span className="state-dot" aria-hidden="true" />{SCENE_STATE_WORDS[state]}</span>
        <p className={`scene-excerpt${scene.description.trim() ? '' : ' todo'}`}>
          {scene.description.trim() || 'No words yet. Open the scene to write what happens.'}
        </p>
      </div>

      <div className="scene-actions">
        <CopyButton text={() => sceneText(scene)} disabled={busy} />
        <button
          className="icon"
          onClick={() => onMove(index, -1)}
          disabled={index === 0 || busy}
          aria-label={`Move scene ${scene.scene_number} (${scene.title}) earlier`}
          type="button"
        >
          ↑
        </button>
        <button
          className="icon"
          onClick={() => onMove(index, 1)}
          disabled={index === count - 1 || busy}
          aria-label={`Move scene ${scene.scene_number} (${scene.title}) later`}
          type="button"
        >
          ↓
        </button>
        <button
          className="icon danger"
          onClick={() => onDelete(scene)}
          aria-label={`Delete scene ${scene.scene_number} (${scene.title})`}
          type="button"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
