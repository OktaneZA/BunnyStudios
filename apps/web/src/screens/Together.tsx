import { useCallback, useEffect, useRef, useState } from 'react';
import { CartoonHeader } from '../components/ProjectTabs';
import { Link, useParams } from 'react-router-dom';
import { api, ApiProblem, type Project } from '../api';
import { director, isActiveJob, laneSpan, seconds, type Timeline, type Transition } from '../director-api';
import { useAssetUrl } from '../assetUrl';
import { uuid } from '../uuid';
import { ProblemBox } from '../components/ProblemBox';
import { AssetVideo } from '../components/AssetMedia';
import { ItemStill } from '../components/CartoonStrip';
import { TransitionChip, TransitionPopover } from '../components/Transitions';
import { JobProgress } from '../components/JobProgress';

/**
 * Put it together (plan §6, DM-21–DM-24): the timeline drawn to time, music and voice,
 * and Make my cartoon. Order follows Story; nothing here is dragged in Simple mode.
 */
export function Together() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [timeline, setTimeline] = useState<Timeline | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [join, setJoin] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceStart, setVoiceStart] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const mounted = useRef(true);
  const requestingMic = useRef(false);
  const chunks = useRef<Blob[]>([]);
  const musicInput = useRef<HTMLInputElement>(null);
  const voiceInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => { if (projectId) setTimeline(await director.timeline(projectId)); }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    api.getProject(projectId).then(setProject).catch(setError);
    refresh().catch(setError);
  }, [projectId, refresh]);

  const rendering = Boolean(timeline?.render_job && isActiveJob(timeline.render_job));
  useEffect(() => {
    if (!rendering) return;
    const timer = setInterval(() => void refresh().catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [rendering, refresh]);

  async function change(action: () => Promise<Timeline>) {
    setBusy(true); setError(null);
    try { setTimeline(await action()); setJoin(null); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function makeCartoon() {
    if (!projectId) return;
    setBusy(true); setError(null);
    try { await director.render(projectId, uuid()); await refresh(); }
    catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  async function startRecording() {
    if (requestingMic.current || recorder.current?.state === 'recording') return;
    requestingMic.current = true;
    let stream: MediaStream | null = null;
    setError(null);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        if (!mounted.current) return;
        const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' });
        setRecording(false);
        if (projectId && blob.size) void change(() => director.uploadVoiceover(projectId, blob, 'recording.webm', voiceStart * 1000));
      };
      rec.start();
      recorder.current = rec;
      setRecording(true);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (!mounted.current) return;
      setError(new ApiProblem({ type: 'about:blank', title: 'No microphone', status: 0, detail: 'The browser did not let us use the microphone. You can upload a recording instead.' }));
    } finally { requestingMic.current = false; }
  }

  function stopRecording() { recorder.current?.stop(); }

  // Leaving the screen switches the microphone off and drops the unfinished recording.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') rec.stop();
        rec.stream.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const renderUrl = useAssetUrl(timeline?.render?.url ?? null);

  if (error && !timeline) return <ProblemBox error={error} />;
  if (!timeline || !project) return <p className="muted">Loading…</p>;

  const playing = timeline.items.filter((i) => i.duration_ms > 0);
  const skipped = timeline.items.filter((i) => i.duration_ms === 0);
  const total = Math.max(timeline.total_ms, 1);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const span = (start: number, duration: number) => laneSpan(start, duration, timeline.total_ms);
  const tickStep = total <= 20_000 ? 2000 : total <= 60_000 ? 5000 : 10_000;
  const ticks: number[] = [];
  for (let t = 0; t < total; t += tickStep) ticks.push(t);
  const counts = { video: 0, picture: 0, sketch: 0 };
  for (const i of playing) counts[i.source === 'empty' ? 'sketch' : i.source] += 1;
  const joinItem = join !== null ? timeline.items[join] : null;
  const failed = timeline.render_job?.status === 'failed' ? timeline.render_job : null;

  return (
    <>
      <CartoonHeader projectId={project.id} title={project.title} step="together" />
      <ProblemBox error={error} />
      {skipped.length > 0 && (
        <section className="notice" aria-label="Scenes missing from your cartoon">
          <b>{skipped.length === 1 ? 'One scene is' : `${skipped.length} scenes are`} missing from the finished cartoon.</b>
          <p>Make clips for them, or continue with the scenes that are ready.</p>
          <div className="row">{skipped.map((item) => <Link className="btn secondary" key={item.id}
            to={`/projects/${projectId}/director?scene=${item.scene_id}`}>Make scene {item.scene_number}</Link>)}</div>
        </section>
      )}

      <div className="together together-simple">
        <div className="together-main stack">
          {/* Watch and save first (docs/teen-ui-review.md P2); music and timing are optional, below. */}
          <section className="card player-card" aria-labelledby="watch-heading">
            <h3 id="watch-heading">Watch your cartoon</h3>
            {timeline.render ? (
              <AssetVideo url={timeline.render.url} className="player" />
            ) : (
              <div className="player-empty">
                {rendering ? <JobProgress job={timeline.render_job!} what="cartoon" /> : <p className="muted">Your cartoon shows here once you press <b>Make my cartoon</b>.</p>}
              </div>
            )}
            {timeline.render && rendering && timeline.render_job && <JobProgress job={timeline.render_job} what="cartoon" />}
            {failed && <p className="problem-inline">{failed.error ?? 'Putting it together did not work. Try again in a minute.'}</p>}
            <p className="hint">
              {playing.length} {playing.length === 1 ? 'scene plays' : 'scenes play'} · {Math.round(timeline.total_ms / 1000)} seconds · {countWords(counts)}.
              {skipped.length > 0 && <> Left out: {skipped.map((i) => `scene ${i.scene_number}`).join(', ')}.</>}
              {' '}Putting it together is free and takes about a minute.
            </p>
            <div className="row player-actions">
              <button type="button" onClick={() => void makeCartoon()} disabled={busy || rendering || playing.length === 0}>
                {rendering && <span className="ai-spinner" aria-hidden="true" />}{rendering ? 'Making your cartoon…' : timeline.render ? 'Make my cartoon again' : 'Make my cartoon'}
              </button>
              {timeline.render && <a className="btn secondary" href={renderUrl ?? undefined} download={`${project.title}.mp4`} aria-disabled={!renderUrl}>Save video</a>}
              {timeline.render && <span className="hint">Made {new Date(timeline.render.created_at).toLocaleString()} · {seconds(timeline.render.duration_ms ?? timeline.total_ms)}</span>}
            </div>
          </section>

          <details className="card together-extras">
          <summary>Music, voice and timing (optional)</summary>
          <section className="timeline-card">
            <header className="strip-head">
              <h3>Your cartoon, in story order</h3>
              <span className="hint">Total <b>{Math.round(timeline.total_ms / 1000)} seconds</b>{skipped.length > 0 && <> · {skipped.length === 1 ? `scene ${skipped[0]!.scene_number} skipped (empty)` : `${skipped.length} scenes skipped (empty)`}</>}</span>
            </header>

            <div className="ruler" aria-hidden="true">
              <span className="lane-name" />
              <div className="ruler-track">
                {ticks.map((t) => <span key={t} className="tick" style={{ left: pct(t) }}>{t / 1000}s</span>)}
              </div>
            </div>

            <div className="lane tall">
              <span className="lane-name">Video</span>
              <div className="lane-track">
                {playing.map((item, idx) => {
                  const index = timeline.items.indexOf(item);
                  const next = playing[idx + 1];
                  return (
                    <div key={item.id} className="video-block" style={span(item.start_ms ?? 0, item.duration_ms)}>
                      <ItemStill item={item} className="block-still" />
                      <span className="block-title">{item.scene_number}. {item.scene_title}</span>
                      <span className="block-secs">{seconds(item.duration_ms)}</span>
                      {next && <span className="block-join"><TransitionChip value={item.transition_out} onClick={() => setJoin(index)} disabled={busy} /></span>}
                    </div>
                  );
                })}
                {playing.length === 0 && <span className="lane-empty">Nothing plays yet. Make a clip for a scene in Director.</span>}
              </div>
            </div>

            <div className="lane">
              <span className="lane-name">Sounds</span>
              <div className="lane-track">
                {playing.filter((i) => i.has_sound).map((i) => <span key={i.id} className="lane-seg sound labelled" style={span(i.start_ms ?? 0, i.duration_ms)}>clip sounds</span>)}
                {!playing.some((i) => i.has_sound) && <span className="lane-empty">No clip has its own sounds yet.</span>}
              </div>
            </div>

            <div className="lane">
              <span className="lane-name">Voice</span>
              <div className="lane-track">
                {timeline.voiceovers.map((v) => (
                  <span key={v.id} className="lane-seg voice labelled" style={span(v.start_ms, v.duration_ms ?? 2000)}>
                    Your recording{v.duration_ms ? ` - ${seconds(v.duration_ms)}` : ''}
                    <button type="button" className="seg-remove" aria-label="Remove this recording" disabled={busy} onClick={() => void change(async () => { await director.deleteVoiceover(v.id); return director.timeline(projectId!); })}>✕</button>
                  </span>
                ))}
              </div>
            </div>
            <div className="row lane-actions">
              {recording
                ? <button type="button" className="danger-text secondary" onClick={stopRecording}><span className="ai-spinner" aria-hidden="true" />Stop recording</button>
                : <button type="button" className="secondary" disabled={busy} onClick={() => void startRecording()}>+ Record</button>}
              <button type="button" className="secondary" disabled={busy || recording} onClick={() => voiceInput.current?.click()}>+ Upload a recording</button>
              <label className="inline-field">Starts at second
                <input type="number" min={0} max={Math.ceil(total / 1000)} value={voiceStart} onChange={(e) => setVoiceStart(Math.max(0, Number(e.target.value) || 0))} aria-label="Recording starts at second" />
              </label>
              <input ref={voiceInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && projectId) void change(() => director.uploadVoiceover(projectId, f, f.name, voiceStart * 1000)); e.target.value = ''; }} />
            </div>

            <div className="lane">
              <span className="lane-name">Music</span>
              <div className="lane-track">
                {timeline.music
                  ? <span className="lane-seg music labelled" style={{ left: 0, width: '100%' }}>Your music{timeline.music.fade_out_ms > 0 ? ' - fades out at the end' : ''}</span>
                  : <span className="lane-empty">No music yet.</span>}
              </div>
            </div>
            <div className="row lane-actions">
              <button type="button" className="secondary" disabled={busy} onClick={() => musicInput.current?.click()}>{timeline.music ? 'Change' : '+ Add music'}</button>
              {timeline.music && <button type="button" className="secondary" disabled={busy} onClick={() => void change(() => director.updateTimeline(projectId!, { music_asset_id: null }))}>Remove music</button>}
              <span className="hint">MP3, M4A, WAV or OGG, up to 20 MB.</span>
              <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && projectId) void change(() => director.uploadMusic(projectId, f, f.name)); e.target.value = ''; }} />
            </div>

            <p className="hint">The little buttons between scenes choose how one scene joins the next: <b>Cut</b>, <b>Fade</b> or <b>Slide</b>. Sounds come from clips that had sounds on.</p>
          </section>
          </details>

          {timeline.renders.length > 1 && (
            <details className="card">
              <summary>Earlier versions of your cartoon</summary>
              {timeline.renders.slice(1).map((r) => <p key={r.id} className="hint">{new Date(r.created_at).toLocaleString()} · {seconds(r.duration_ms ?? 0)}</p>)}
            </details>
          )}
        </div>
      </div>

      {joinItem && join !== null && (
        <TransitionPopover
          fromNumber={joinItem.scene_number}
          toNumber={playing[playing.indexOf(joinItem) + 1]?.scene_number ?? joinItem.scene_number + 1}
          value={joinItem.transition_out}
          busy={busy}
          onPick={(t: Transition) => void change(() => director.setTransition(joinItem.id, t))}
          onPickAll={(t: Transition) => void change(() => director.setAllTransitions(projectId!, t))}
          onClose={() => setJoin(null)}
        />
      )}
    </>
  );
}

function countWords(c: { video: number; picture: number; sketch: number }) {
  const parts: string[] = [];
  if (c.video) parts.push(`${c.video} ${c.video === 1 ? 'clip' : 'clips'}`);
  if (c.picture) parts.push(`${c.picture} ${c.picture === 1 ? 'picture' : 'pictures'}`);
  if (c.sketch) parts.push(`${c.sketch} ${c.sketch === 1 ? 'sketch' : 'sketches'}`);
  return parts.length ? parts.join(', ') : 'nothing yet';
}
