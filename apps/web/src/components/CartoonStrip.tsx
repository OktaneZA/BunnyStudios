import { useState } from 'react';
import { Link } from 'react-router-dom';
import { director, laneSpan, seconds, type Timeline, type TimelineItem, type Transition } from '../director-api';
import { AssetImage, PlayIcon } from './AssetMedia';
import { TransitionChip, TransitionPopover } from './Transitions';
import { ProblemBox } from './ProblemBox';

/** The picture that stands for an item: the clip's poster, the hero picture or the sketch. */
export function ItemStill({ item, className }: { item: TimelineItem; className?: string }) {
  if (!item.asset) return <span className={`item-still blank${className ? ` ${className}` : ''}`}>empty</span>;
  const url = item.source === 'video' ? item.asset.poster_url : item.asset.url;
  return (
    <span className={`item-still${className ? ` ${className}` : ''}`}>
      <AssetImage url={url} alt={`Scene ${item.scene_number}`} placeholder={item.source === 'video' ? 'clip' : ''} />
      {item.source === 'video' && <span className="play-badge" aria-hidden="true"><PlayIcon /></span>}
      <span className="item-kind">{item.source === 'video' ? 'clip' : item.source}</span>
    </span>
  );
}

/**
 * The four thin lanes drawn to time (DM-21): Video, Sounds, Voice, Music. Positions come
 * from the server's start_ms so what the child sees matches what ffmpeg will render.
 */
export function Lanes({ timeline }: { timeline: Timeline }) {
  const span = (start: number, duration: number) => laneSpan(start, duration, timeline.total_ms);
  const playing = timeline.items.filter((i) => i.duration_ms > 0 && i.start_ms !== null);
  return (
    <div className="lanes" aria-label="Video, sounds, voice and music over time">
      <div className="lane"><span className="lane-name">Video</span><div className="lane-track">
        {playing.map((i) => <span key={i.id} className="lane-seg video" style={span(i.start_ms!, i.duration_ms)} title={`Scene ${i.scene_number}`} />)}
      </div></div>
      <div className="lane"><span className="lane-name">Sounds</span><div className="lane-track">
        {playing.filter((i) => i.has_sound).map((i) => <span key={i.id} className="lane-seg sound" style={span(i.start_ms!, i.duration_ms)} />)}
      </div></div>
      <div className="lane"><span className="lane-name">Voice</span><div className="lane-track">
        {timeline.voiceovers.map((v) => <span key={v.id} className="lane-seg voice" style={span(v.start_ms, v.duration_ms ?? 1000)} />)}
      </div></div>
      <div className="lane"><span className="lane-name">Music</span><div className="lane-track">
        {timeline.music && <span className="lane-seg music" style={{ left: 0, width: '100%' }} />}
      </div></div>
    </div>
  );
}

interface StripProps {
  projectId: string;
  timeline: Timeline | null;
  onTimeline: (t: Timeline) => void;
}

/** "Your cartoon" along the bottom of Director: the scenes in story order, joins, lanes. */
export function CartoonStrip({ projectId, timeline, onTimeline }: StripProps) {
  const [join, setJoin] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function change(action: () => Promise<Timeline>) {
    setBusy(true); setError(null);
    try { onTimeline(await action()); setJoin(null); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  const items = timeline?.items ?? [];
  const joinItem = join !== null ? items[join] : null;

  return (
    <section className="cartoon-strip card" aria-labelledby="cartoon-strip-title">
      <header className="strip-head">
        <div><h3 id="cartoon-strip-title">Your cartoon</h3><span className="hint">In story order</span></div>
        <div className="strip-total"><b>{timeline ? seconds(timeline.total_ms) : '…'}</b><span className="hint">so far</span></div>
      </header>
      <ProblemBox error={error} />
      {timeline && items.length === 0 && <p className="muted">Add scenes in Story and they appear here.</p>}
      <div className="strip-scroll">
        <div className="strip-items">
          {items.map((item, i) => (
            <div key={item.id} className="strip-item-wrap">
              <div className={`strip-item${item.duration_ms === 0 ? ' skipped' : ''}`}>
                <ItemStill item={item} />
                <span className="strip-caption">
                  <span className="strip-title">{item.scene_number}. {item.scene_title}</span>
                  <span className="strip-secs">{item.duration_ms > 0 ? seconds(item.duration_ms) : 'skipped'}</span>
                </span>
              </div>
              {i < items.length - 1 && <TransitionChip value={item.transition_out} onClick={() => setJoin(i)} disabled={busy} />}
            </div>
          ))}
        </div>
        {timeline && items.length > 0 && <Lanes timeline={timeline} />}
      </div>
      <div className="strip-foot">
        <Link className="btn" to={`/projects/${projectId}/together`}>Put it together →</Link>
      </div>
      {joinItem && join !== null && (
        <TransitionPopover
          fromNumber={joinItem.scene_number}
          toNumber={items[join + 1]?.scene_number ?? joinItem.scene_number + 1}
          value={joinItem.transition_out}
          busy={busy}
          onPick={(t: Transition) => void change(() => director.setTransition(joinItem.id, t))}
          onPickAll={(t: Transition) => void change(() => director.setAllTransitions(projectId, t))}
          onClose={() => setJoin(null)}
        />
      )}
    </section>
  );
}
