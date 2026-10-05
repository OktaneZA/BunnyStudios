import type { ReactNode } from 'react';
import type { Scene } from '../api';
import { isActiveJob, seconds, type Asset, type Job, type Shot, type ShotCast } from '../director-api';
import { AssetImage, TakeImage } from './AssetMedia';

/** The words a page shows for its media and its progress, kept apart (SB state language). */
export function pageStatus(shot: Shot | undefined, hero: Asset | null, activeJob: Job | undefined, failed: boolean, hasWords: boolean) {
  const media = hero ? (hero.mime_type.startsWith('video/') ? 'Video selected' : 'Picture selected') : shot?.hero_asset_id ? 'Picture selected' : 'Empty';
  const making = activeJob ? (activeJob.progress?.say ?? (activeJob.intent === 'draft' ? 'Making preview' : 'Making clip')) : failed && !hero ? 'Could not finish' : null;
  return { media, making, hasWords };
}

/**
 * One page of the storybook (SB-11, SB-12): folded, it shows the selected media, the number
 * and name, the words, who is in it and its state. Selected, the editor opens in place.
 */
export function StoryPage({ scene, index, count, shot, hero, activeJob, failed, cast, selected, children, onSelect, onMove, onRemove, onAddAfter, adding }: {
  scene: Scene; index: number; count: number; shot: Shot | undefined; hero: Asset | null; activeJob: Job | undefined; failed: boolean;
  cast: ShotCast | null; selected: boolean; children?: ReactNode;
  onSelect: () => void; onMove: (direction: -1 | 1) => void; onRemove: () => void; onAddAfter: () => void; adding: boolean;
}) {
  const status = pageStatus(shot, hero, activeJob, failed, Boolean(scene.description.trim()));
  const needLook = cast?.characters.filter((c) => c.look_status === 'none') ?? [];
  return (
    <article id={`page-${scene.id}`} className={`story-page card${selected ? ' selected' : ''}`} aria-labelledby={selected ? `composer-${scene.id}` : `page-title-${scene.id}`} aria-current={selected ? 'true' : undefined}>
      <header className="page-head">
        <span className="eyebrow">Page {String(index + 1).padStart(2, '0')}</span>
        <div className="page-tools" role="group" aria-label={`Page ${index + 1} tools`}>
          <button type="button" className="icon" aria-label="Move this page earlier" disabled={index === 0 || adding} onClick={() => onMove(-1)}>↑</button>
          <button type="button" className="icon" aria-label="Move this page later" disabled={index === count - 1 || adding} onClick={() => onMove(1)}>↓</button>
          <button type="button" className="icon bin" aria-label={`Move page ${index + 1}, ${scene.title}, to the bin`} disabled={Boolean(activeJob) || adding} onClick={onRemove}>✕</button>
        </div>
      </header>
      {selected ? children : (
        <button type="button" className="page-summary" onClick={onSelect} aria-label={`Open page ${index + 1}, ${scene.title}`}>
          <span className="page-media">
            {hero ? <TakeImage asset={hero} alt="" /> : <span className="page-empty">{status.hasWords ? 'No clip or picture yet' : 'Write what happens first'}</span>}
            {hero?.duration_ms ? <span className="overview-duration">{seconds(hero.duration_ms)}</span> : null}
          </span>
          <span className="page-words">
            <strong id={`page-title-${scene.id}`} className="page-title">{scene.title}</strong>
            <span className="page-pills">
              <span className={`pill media-${status.media === 'Empty' ? 'empty' : 'set'}`}>{status.media}</span>
              {status.making && <span className={`pill ${activeJob ? 'making' : 'failed'}`}>{status.making}</span>}
              {needLook.length > 0 && <span className="pill needs">Needs {needLook.map((c) => `${c.name}’s`).join(' and ')} look</span>}
            </span>
            <span className="page-action">{scene.description.trim() || 'Nothing written yet.'}</span>
            {cast && cast.characters.length > 0 && (
              <span className="page-faces" aria-label={`In this page: ${cast.characters.map((c) => c.name).join(', ')}`}>
                {cast.characters.map((c) => c.main_picture ? <AssetImage key={c.character_id} url={c.main_picture.url} alt="" className="cast-face" /> : <span key={c.character_id} className="cast-face none" aria-hidden="true">{c.name.slice(0, 1)}</span>)}
                <span className="muted">{cast.characters.map((c) => c.name).join(' + ')}</span>
              </span>
            )}
            <span className="btn secondary page-edit">Edit this page</span>
          </span>
        </button>
      )}
      <button type="button" className="link-button page-add-after" disabled={adding} onClick={onAddAfter}>+ Add a page here</button>
    </article>
  );
}

export { isActiveJob };
