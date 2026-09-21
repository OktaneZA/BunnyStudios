/**
 * ffmpeg helpers (plan D36, DM-19). Every function degrades gracefully when the binary is
 * missing so a development PC without ffmpeg still runs the pipeline; the poster is simply
 * absent and the render reports a clear error.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config.ts';

const run = promisify(execFile);

export async function ffmpegAvailable(): Promise<boolean> {
  try { await run(config.FFMPEG_PATH, ['-version']); return true; } catch { return false; }
}

/** First frame, or the frame at `atMs`, as a JPEG. Null when ffmpeg is unavailable. */
export async function posterFrame(video: Buffer, atMs = 0): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'poster-'));
  try {
    const input = join(dir, 'in.mp4');
    const output = join(dir, 'out.jpg');
    await writeFile(input, video);
    await run(config.FFMPEG_PATH, ['-y', '-loglevel', 'error', '-ss', (atMs / 1000).toFixed(3), '-i', input, '-frames:v', '1', '-q:v', '3', output]);
    return await readFile(output);
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function probeDurationMs(video: Buffer): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), 'probe-'));
  try {
    const input = join(dir, 'in.bin');
    await writeFile(input, video);
    const { stdout } = await run(config.FFPROBE_PATH, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input]);
    const seconds = Number.parseFloat(stdout.trim());
    return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
  } catch {
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Development stand-ins for the fake provider: a plain coloured clip or picture (needs ffmpeg). */
export async function makeTestClip(seconds: number, colour = 'steelblue'): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'testclip-'));
  try {
    const out = join(dir, 'clip.mp4');
    await run(config.FFMPEG_PATH, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=640x360:d=${seconds}:r=25`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', String(seconds), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', out]);
    return await readFile(out);
  } catch { return null; } finally { await rm(dir, { recursive: true, force: true }); }
}
export async function makeTestImage(colour = 'goldenrod'): Promise<Buffer | null> {
  const dir = await mkdtemp(join(tmpdir(), 'testimg-'));
  try {
    const out = join(dir, 'pic.png');
    await run(config.FFMPEG_PATH, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${colour}:s=640x360:d=1`, '-frames:v', '1', out]);
    return await readFile(out);
  } catch { return null; } finally { await rm(dir, { recursive: true, force: true }); }
}

/** Whether a media file carries an audio stream; clips from some makers are silent. */
export async function probeHasAudio(path: string): Promise<boolean> {
  try {
    const { stdout } = await run(config.FFPROBE_PATH, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path]);
    return stdout.includes('audio');
  } catch { return false; }
}

export type Transition = 'cut' | 'fade' | 'slide';
export interface RenderItem {
  /** Absolute path to an mp4, or an image (png/jpg/svg) shown for `holdMs`. */
  path: string;
  isVideo: boolean;
  /** A silent clip gets a generated silent track so the audio graph stays uniform. */
  hasAudio: boolean;
  holdMs: number;
  transitionOut: Transition;
}
export interface RenderPlan {
  items: RenderItem[];
  music: { path: string; volume: number; fadeInMs: number; fadeOutMs: number } | null;
  voiceovers: { path: string; startMs: number; volume: number }[];
  width: number;
  height: number;
}

export const TRANSITION_MS = 500;

/**
 * Build the ffmpeg filter graph for the timeline (D36, D40). Every item is normalised to
 * the same size and frame rate, joined with xfade (fade, slideleft) or concat (cut), and
 * the music and voice tracks are mixed under the clips' own sound.
 */
export function renderArgs(plan: RenderPlan, output: string): string[] {
  const args: string[] = ['-y', '-loglevel', 'error'];
  const filters: string[] = [];
  plan.items.forEach((item, i) => {
    if (item.isVideo) args.push('-i', item.path);
    else args.push('-loop', '1', '-t', (item.holdMs / 1000).toFixed(3), '-i', item.path);
    filters.push(`[${i}:v]scale=${plan.width}:${plan.height}:force_original_aspect_ratio=decrease,pad=${plan.width}:${plan.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=25,format=yuv420p,settb=AVTB,setpts=PTS-STARTPTS[v${i}]`);
    filters.push(item.isVideo && item.hasAudio
      ? `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${(item.holdMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  });
  // Chain the video: pairwise xfade offsets are cumulative durations minus the overlap.
  let video = '[v0]';
  let audio = '[a0]';
  let elapsedMs = plan.items[0]?.holdMs ?? 0;
  for (let i = 1; i < plan.items.length; i++) {
    const prev = plan.items[i - 1]!;
    const item = plan.items[i]!;
    const out = `[vx${i}]`;
    const aout = `[ax${i}]`;
    if (prev.transitionOut === 'cut') {
      filters.push(`${video}[v${i}]concat=n=2:v=1:a=0${out}`);
      filters.push(`${audio}[a${i}]concat=n=2:v=0:a=1${aout}`);
      elapsedMs += item.holdMs;
    } else {
      const offset = Math.max(0, elapsedMs - TRANSITION_MS) / 1000;
      const kind = prev.transitionOut === 'fade' ? 'fade' : 'slideleft';
      filters.push(`${video}[v${i}]xfade=transition=${kind}:duration=${TRANSITION_MS / 1000}:offset=${offset.toFixed(3)}${out}`);
      filters.push(`${audio}[a${i}]acrossfade=d=${TRANSITION_MS / 1000}:c1=tri:c2=tri${aout}`);
      elapsedMs += item.holdMs - TRANSITION_MS;
    }
    video = out; audio = aout;
  }
  const totalSeconds = elapsedMs / 1000;
  let inputIndex = plan.items.length;
  const mixInputs = [audio];
  if (plan.music) {
    args.push('-stream_loop', '-1', '-i', plan.music.path);
    const fadeOutStart = Math.max(0, totalSeconds - plan.music.fadeOutMs / 1000);
    filters.push(`[${inputIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${totalSeconds.toFixed(3)},volume=${(plan.music.volume / 100).toFixed(2)},afade=t=in:st=0:d=${(plan.music.fadeInMs / 1000).toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${(plan.music.fadeOutMs / 1000).toFixed(3)}[music]`);
    mixInputs.push('[music]');
    inputIndex += 1;
  }
  plan.voiceovers.forEach((v, n) => {
    args.push('-i', v.path);
    filters.push(`[${inputIndex}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${(v.volume / 100).toFixed(2)},adelay=${v.startMs}|${v.startMs}[voice${n}]`);
    mixInputs.push(`[voice${n}]`);
    inputIndex += 1;
  });
  filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0[aout]`);
  args.push('-filter_complex', filters.join(';'), '-map', video, '-map', '[aout]', '-t', totalSeconds.toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', output);
  return args;
}

export async function render(plan: RenderPlan): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), 'render-'));
  try {
    const output = join(dir, 'out.mp4');
    await run(config.FFMPEG_PATH, renderArgs(plan, output), { maxBuffer: 16 * 1024 * 1024 });
    return await readFile(output);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
