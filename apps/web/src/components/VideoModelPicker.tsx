import { useState } from 'react';
import { VIDEO_CATEGORIES } from '@storyboard/models';
import type { ModelInfo } from '../director-api';

export function VideoModelPicker({ models, value, onChange }: { models: ModelInfo[]; value: string | undefined; onChange: (id: string) => void }) {
  const [category, setCategory] = useState('recommended');
  const candidates = models.filter((m) => m.kind === 'video' && m.video);
  const groups = VIDEO_CATEGORIES.filter((g) => candidates.some((m) => m.video?.categories.includes(g.id)));
  const active = groups.some((g) => g.id === category) ? category : groups[0]?.id;
  if (!groups.length) return null;
  return <details className="video-model-picker">
    <summary>Choose a clip maker</summary>
    <div className="video-model-categories" role="group" aria-label="Clip maker categories">
      {groups.map((g) => <button key={g.id} type="button" className="secondary" aria-pressed={g.id === active} onClick={() => setCategory(g.id)}>{g.label}</button>)}
    </div>
    <div className="video-model-options" role="group" aria-label="Clip makers">
      {candidates.filter((m) => m.video?.categories.includes(active!)).map((m) => <button key={m.id} type="button" className="secondary video-model-option" aria-pressed={m.id === value} onClick={() => onChange(m.id)}>
        <strong>{m.label ?? m.friendly_label}</strong><span>{m.help}</span>
        <small>{m.duration_seconds?.min}–{m.duration_seconds?.max}s per take · {m.video?.audio_mode === 'always' ? 'Sound included' : m.capabilities.audio ? 'Optional sound' : 'Silent'}</small>
        {m.unverified && <small className="unverified">Not tried by us yet: check the first clip and its price.</small>}
      </button>)}
    </div>
  </details>;
}
