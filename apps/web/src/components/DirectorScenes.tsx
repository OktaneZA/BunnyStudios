import { useState } from 'react';
import type { Scene } from '../api';
import { director, isActiveJob, seconds, type Asset, type Job, type Shot, type Timeline } from '../director-api';
import { TakeImage } from './AssetMedia';
import { TransitionChip, TransitionPopover } from './Transitions';
import { ProblemBox } from './ProblemBox';
import { SCENE_STATE_WORDS, sceneState } from '../sceneState';

/** One scene list, shown as either the film strip or the scene board. */
export function DirectorScenes({ layout, scenes, shots, jobs, assets, selectedId, projectId, timeline, onTimeline, onSelect, onAdd, adding }: {
  layout: string; scenes: Scene[]; shots: Map<string, Shot>; jobs: Job[]; assets: Map<string, Asset>;
  selectedId?: string; projectId: string; timeline: Timeline | null;
  onTimeline: (timeline: Timeline) => void; onSelect: (sceneId: string) => void;
  /** Add a scene: the last tile in the strip, and the last choice in the phone's scene list. */
  onAdd: () => void; adding: boolean;
}) {
  const [join, setJoin] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const joinItem = timeline?.items.find((item) => item.scene_id === join);
  const ready = scenes.filter((scene) => shots.get(scene.id)?.hero_video_asset_id).length;
  async function change(action: () => Promise<Timeline>) {
    setBusy(true); setError(null);
    try { onTimeline(await action()); setJoin(null); } catch (err) { setError(err); }
    finally { setBusy(false); }
  }
  return <section className={`director-scenes ${layout}`} aria-label="Your cartoon scenes">
    <header className="scene-overview-head">
      <div><h3>Your cartoon</h3><span className="hint">Tap a scene to work on it · {ready} of {scenes.length} ready · {seconds(timeline?.total_ms ?? 0)} so far</span></div>
    </header>
    <ProblemBox error={error} />
    {!scenes.length && <p className="notice">Add a scene, describe what happens, then make its clip.</p>}
    {/* Phones: one compact scene chooser instead of the strip. */}
    {scenes.length > 0 && (
      <label className="scene-select">
        <span className="label-text">Scene</span>
        <select value={selectedId ?? ''} disabled={adding} onChange={(e) => { if (e.target.value === '__add') onAdd(); else onSelect(e.target.value); }}>
          {scenes.map((scene) => {
            const shot = shots.get(scene.id);
            const making = jobs.some((job) => job.target_entity_id === shot?.id && job.kind === 'video' && isActiveJob(job));
            const state = sceneState({ hasClip: Boolean(shot?.hero_video_asset_id), making, hasDescription: Boolean(scene.description.trim()) });
            return <option key={scene.id} value={scene.id}>{scene.scene_number}. {scene.title} · {SCENE_STATE_WORDS[state]}</option>;
          })}
          <option value="__add">+ Add scene</option>
        </select>
      </label>
    )}
    <div className="scene-overview-list">
      {scenes.map((scene, index) => {
        const shot = shots.get(scene.id);
        const activeJob = jobs.find((job) => job.target_entity_id === shot?.id && job.kind === 'video' && isActiveJob(job));
        const failed = jobs.find((job) => job.target_entity_id === shot?.id && job.kind === 'video')?.status === 'failed';
        const hero = shot?.hero_video_asset_id ? assets.get(shot.hero_video_asset_id) : null;
        const state = sceneState({ hasClip: Boolean(hero || shot?.hero_video_asset_id), making: Boolean(activeJob), hasDescription: Boolean(scene.description.trim()) });
        const words = state === 'nothing' && failed ? 'Try again' : SCENE_STATE_WORDS[state];
        const item = timeline?.items.find((item) => item.scene_id === scene.id);
        return <div className="scene-overview-wrap" key={scene.id}>
          <article className={`scene-overview-card${selectedId === scene.id ? ' selected' : ''}`}>
            <button type="button" className="scene-overview-select" aria-label={`${scene.scene_number} ${scene.title} ${words}`}
              aria-current={selectedId === scene.id ? 'true' : undefined} onClick={() => onSelect(scene.id)}>
              <span className="scene-overview-still">
                {hero ? <TakeImage asset={hero} alt="" /> : <span className="scene-overview-empty">{activeJob ? '' : scene.description.trim() ? 'No clip yet' : 'Write what happens first'}</span>}
                {hero?.duration_ms ? <span className="overview-duration">{seconds(hero.duration_ms)}</span> : null}
                {activeJob && <span className="overview-making" aria-hidden="true">● Making…</span>}
              </span>
              <span className="scene-overview-text">
                <strong>{scene.scene_number}. {scene.title}</strong>
                <span className={`scene-state ${state}`}><span className="state-dot" aria-hidden="true" />{words}</span>
                {layout === 'scene-board' && <span className="overview-description">{scene.description || 'This scene has no description yet. Write what happens before making a clip.'}</span>}
              </span>
            </button>
            {layout === 'scene-board' && <div className="overview-actions">
              {!scene.description.trim() ? <button type="button" className="secondary" onClick={() => { onSelect(scene.id); document.getElementById('director-scene-work')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>Write this scene</button>
                : <button type="button" className="secondary" onClick={() => {
                  onSelect(scene.id);
                  document.getElementById('director-scene-work')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}>{activeJob ? 'View progress' : hero ? 'Watch / choose a take' : 'Choose clip settings'}</button>}
            </div>}
          </article>
          {item && index < scenes.length - 1 && <TransitionChip value={item.transition_out} disabled={busy} onClick={() => setJoin(scene.id)} />}
        </div>;
      })}
      <button type="button" className="scene-add-tile" disabled={adding} onClick={onAdd}>{adding ? 'Adding scene…' : '+ Add scene'}</button>
    </div>
    {joinItem && <TransitionPopover fromNumber={joinItem.scene_number} toNumber={joinItem.scene_number + 1}
      value={joinItem.transition_out} busy={busy} onClose={() => setJoin(null)}
      onPick={(value) => void change(() => director.setTransition(joinItem.id, value))}
      onPickAll={(value) => void change(() => director.setAllTransitions(projectId, value))} />}
  </section>;
}
