/**
 * Director Mode API client (docs/director-mode-plan-v1.md §5). Same request() as api.ts;
 * everything on the wire is snake_case and every error is problem+json.
 */
import { request } from './api';

export type ModelKind = 'image' | 'video';
export type AspectRatio = '16:9' | '9:16' | '1:1';
/** How much to spend on a clip: the child picks a level, never a model (D41). */
export type ModelTier = 'low' | 'medium' | 'high';
export type Transition = 'cut' | 'fade' | 'slide';

export interface ModelInfo {
  video?: { family: string; categories: string[]; audio_mode?: 'optional' | 'always' | 'none'; final_model_id?: string; documentation: string } | null;
  configuration_pricing?: boolean;
  id: string;
  kind: ModelKind;
  tier: ModelTier | null;
  friendly_label: string;
  /** Real name and provider: only the adult account sees them. */
  label: string | null;
  provider: string | null;
  help: string;
  icon: string;
  capabilities: {
    reference_images: boolean;
    start_frame: boolean;
    end_frame: boolean;
    audio: boolean;
    multi_shot: boolean;
    image_to_video: boolean;
    text_to_video: boolean;
  };
  aspect_ratios: AspectRatio[];
  resolutions: string[];
  duration_seconds: { min: number; max: number; step: number } | null;
  max_reference_images: number;
  max_prompt_length: number;
  unit: 'image' | 'second';
  unit_cost_pence: number;
}

export interface Allowance {
  daily_budget_pence: number;
  monthly_budget_pence: number;
  spent_today_pence: number;
  spent_this_month_pence: number;
  remaining_today_pence: number;
  remaining_this_month_pence: number;
  resets_at: string;
  currency: string;
}

export interface GenerationSettings {
  enabled: boolean;
  review_enabled: boolean;
  models: ModelInfo[];
  allowance: Allowance;
  allowance_words: string;
  message: string | null;
}

export interface Shot {
  id: string;
  scene_id: string;
  shot_number: number;
  sort_order: number;
  compiled_prompt: string;
  compiled_negative_prompt: string;
  prompt_template_version: string;
  prompt_locked: boolean;
  user_prompt_addendum: string;
  action_beat: string;
  shot_type: string | null;
  camera_angle: string | null;
  hero_asset_id: string | null;
  hero_video_asset_id: string | null;
  generated_asset_ids: string[];
  version: number;
  updated_at: string;
}

export interface Asset {
  id: string;
  kind: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  poster_asset_id: string | null;
  /** Needs the bearer token: load it through useAssetUrl, never a bare <img src>. */
  url: string;
  poster_url: string | null;
  review_status: 'pending' | 'allowed' | 'rejected' | 'not_required';
  review_reason: string | null;
  owner_entity_type: string | null;
  owner_entity_id: string | null;
  job_id: string | null;
  model_id: string | null;
  created_at: string;
  deleted_at: string | null;
}

export type JobStatus = 'queued' | 'submitted' | 'running' | 'reviewing' | 'ready' | 'failed' | 'cancelled';
export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ['queued', 'submitted', 'running', 'reviewing'];
export const isActiveJob = (job: { status: JobStatus }) => ACTIVE_JOB_STATUSES.includes(job.status);

export interface Job {
  id: string;
  kind: 'image' | 'video' | 'render';
  status: JobStatus;
  step: string;
  target_entity_type: string;
  target_entity_id: string;
  model_id: string;
  attempt: number;
  error: string | null;
  results: Asset[];
  held_back: number;
  created_at: string;
  finished_at: string | null;
  /** The latest child-safe step, e.g. "Making part 2 of 3", and when it began. */
  progress?: { say: string; at: string; part: number | null; parts: number | null } | null;
  /** The full step trail; only present for the adult account. */
  events?: JobEvent[];
}

export interface JobEvent { at: string; say: string; detail?: string; raw?: string; part?: number; parts?: number }
export interface LoggedJob extends Job { events: JobEvent[]; project_title: string; duration_seconds: number | null; error_code: string | null }

export interface JobRequestBody {
  resolution?: string | undefined;
  kind: ModelKind;
  model_id: string;
  aspect_ratio?: AspectRatio;
  count?: number;
  duration_seconds?: number;
  audio?: boolean;
  note?: string;
}

export interface Character {
  id: string;
  name: string;
  description: string;
  costume: string | null;
  background_story: string | null;
  source: 'story' | 'manual';
  scene_numbers: number[];
  main_reference: Asset | null;
  references: Asset[];
  pictures_stale: boolean;
  deleted_at: string | null;
}

export interface CastList {
  data: Character[];
  story_changed: boolean;
  never_found: boolean;
  finder_enabled: boolean;
}

export interface FoundCharacter {
  name: string;
  description: string;
  scene_numbers: number[];
}

export interface CastProposal {
  id: string;
  status: string;
  characters: FoundCharacter[];
  error: string | null;
}

export interface TimelineItem {
  id: string;
  scene_id: string;
  scene_number: number;
  scene_title: string;
  source: 'video' | 'picture' | 'sketch' | 'empty';
  duration_ms: number;
  start_ms: number | null;
  has_sound: boolean;
  /** A clip for this scene is being made right now. */
  making: boolean;
  asset: Asset | null;
  transition_out: Transition;
}

export interface Voiceover {
  id: string;
  start_ms: number;
  volume: number;
  duration_ms: number | null;
  asset: Asset | null;
}

export interface Timeline {
  id: string;
  version: number;
  hand_edited: boolean;
  total_ms: number;
  still_hold_ms: number;
  transition_ms: number;
  items: TimelineItem[];
  music: { asset: Asset; volume: number; fade_in_ms: number; fade_out_ms: number } | null;
  voiceovers: Voiceover[];
  render: Asset | null;
  renders: Asset[];
  render_job: Job | null;
}

export interface AccountBudget {
  id: string;
  display_name: string;
  is_minor: boolean;
  allowance: Allowance;
}

/** Multipart body. Content-Type is left to the browser so the boundary is set. */
function upload(file: Blob, filename: string) {
  const form = new FormData();
  form.append('file', file, filename);
  return form;
}

export const director = {
  settings: () => request<GenerationSettings>('/settings/generation'),
  /** The clip maker behind each cost level, low to high. */
  tiers: () => request<{ data: ModelInfo[] }>('/models/tiers'),
  estimate: (modelId: string, opts: { count?: number; duration_seconds?: number; resolution?: string }) => {
    const q = new URLSearchParams({ model_id: modelId });
    if (opts.count) q.set('count', String(opts.count));
    if (opts.duration_seconds) q.set('duration_seconds', String(opts.duration_seconds));
    if (opts.resolution) q.set('resolution', opts.resolution);
    return request<{ pence: number; words: string; parts: number[] | null }>(`/settings/estimate?${q.toString()}`);
  },

  shots: (sceneId: string) => request<{ data: Shot[] }>(`/scenes/${sceneId}/shots`),
  updateShot: (id: string, body: { user_prompt_addendum?: string; prompt_locked?: boolean; action_beat?: string }, version: number) =>
    request<Shot>(`/shots/${id}`, { method: 'PATCH', body: JSON.stringify(body), headers: { 'If-Match': String(version) } }),
  startJob: (shotId: string, body: JobRequestBody, requestId: string) =>
    request<Job>(`/shots/${shotId}/jobs`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': requestId } }),
  job: (id: string) => request<Job>(`/jobs/${id}`),
  projectJobs: (projectId: string) => request<{ data: Job[] }>(`/projects/${projectId}/jobs`),
  cancelJob: (id: string) => request<{ status: JobStatus }>(`/jobs/${id}/cancel`, { method: 'POST' }),
  pickHero: (shotId: string, assetId: string) =>
    request<Shot>(`/shots/${shotId}/hero`, { method: 'POST', body: JSON.stringify({ asset_id: assetId }) }),

  media: (projectId: string, q: { kind?: string; scene_id?: string; deleted?: boolean } = {}) => {
    const params = new URLSearchParams();
    if (q.kind) params.set('kind', q.kind);
    if (q.scene_id) params.set('scene_id', q.scene_id);
    if (q.deleted) params.set('deleted', 'true');
    const query = params.toString();
    return request<{ data: Asset[] }>(`/projects/${projectId}/media${query ? `?${query}` : ''}`);
  },
  heldBack: (projectId: string) => request<{ data: Asset[] }>(`/projects/${projectId}/held-back`),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: 'DELETE' }),
  restoreAsset: (id: string) => request<Asset>(`/assets/${id}/restore`, { method: 'POST' }),

  accounts: () => request<{ data: AccountBudget[] }>('/accounts'),
  accountJobs: (accountId: string) => request<{ data: LoggedJob[] }>(`/accounts/${accountId}/jobs`),
  setBudget: (accountId: string, body: { daily_budget_pence?: number; monthly_budget_pence?: number }) =>
    request<AccountBudget>(`/accounts/${accountId}/budget`, { method: 'PATCH', body: JSON.stringify(body) }),

  // Cast (D39)
  cast: (projectId: string) => request<CastList>(`/projects/${projectId}/cast`),
  findCast: (projectId: string, requestId: string) =>
    request<CastProposal>(`/projects/${projectId}/cast/proposals`, { method: 'POST', headers: { 'Idempotency-Key': requestId } }),
  resolveCast: (projectId: string, proposalId: string, action: 'accept' | 'cancel', keep?: string[]) =>
    request<{ status: string }>(`/projects/${projectId}/cast/proposals/${proposalId}/${action}`, {
      method: 'POST', body: JSON.stringify(keep ? { keep } : {}),
    }),
  addCharacter: (projectId: string, body: { name: string; description: string }) =>
    request<Character>(`/projects/${projectId}/cast`, { method: 'POST', body: JSON.stringify(body) }),
  updateCharacter: (id: string, body: { name?: string; description?: string; main_reference_asset_id?: string | null }) =>
    request<Character>(`/characters/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCharacter: (id: string) => request<void>(`/characters/${id}`, { method: 'DELETE' }),
  uploadReference: (characterId: string, file: File) =>
    request<Asset>(`/characters/${characterId}/references`, { method: 'POST', body: upload(file, file.name) }),
  drawCharacter: (characterId: string, body: { intent: 'portrait' | 'angles'; model_id: string; count?: number }, requestId: string) =>
    request<Job>(`/characters/${characterId}/jobs`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': requestId } }),

  // Timeline (D36, D40)
  timeline: (projectId: string) => request<Timeline>(`/projects/${projectId}/timeline`),
  updateTimeline: (projectId: string, body: { music_asset_id?: string | null; music_volume?: number; music_fade_in_ms?: number; music_fade_out_ms?: number }) =>
    request<Timeline>(`/projects/${projectId}/timeline`, { method: 'PATCH', body: JSON.stringify(body) }),
  setTransition: (itemId: string, transition_out: Transition) =>
    request<Timeline>(`/timeline-items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ transition_out }) }),
  setAllTransitions: (projectId: string, transition_out: Transition) =>
    request<Timeline>(`/projects/${projectId}/timeline/transitions`, { method: 'POST', body: JSON.stringify({ transition_out }) }),
  uploadMusic: (projectId: string, file: Blob, filename: string) =>
    request<Timeline>(`/projects/${projectId}/timeline/music`, { method: 'POST', body: upload(file, filename) }),
  uploadVoiceover: (projectId: string, file: Blob, filename: string, startMs: number) =>
    request<Timeline>(`/projects/${projectId}/timeline/voiceovers?start_ms=${Math.max(0, Math.round(startMs))}`, { method: 'POST', body: upload(file, filename) }),
  deleteVoiceover: (id: string) => request<void>(`/timeline-voiceovers/${id}`, { method: 'DELETE' }),
  render: (projectId: string, requestId: string) =>
    request<Job>(`/projects/${projectId}/timeline/render`, { method: 'POST', headers: { 'Idempotency-Key': requestId } }),
};

/** "5p" under a pound, "£1.10" from a pound up. Fractions of a penny keep one decimal. */
export function formatPence(p: number): string {
  if (p < 100) return `${p < 10 ? Math.round(p * 10) / 10 : Math.round(p)}p`;
  return `£${(p / 100).toFixed(2)}`;
}

/** "6 s" style, rounded to whole seconds; "skipped" is the caller's job. */
export function seconds(ms: number): string {
  return `${Math.round(ms / 1000)} s`;
}

/** Kid-word chips for a model's capabilities (plan §6, model picker). */
export function modelChips(m: ModelInfo): string[] {
  const chips: string[] = [];
  if (m.capabilities.reference_images) chips.push('Uses your cast pictures');
  if (m.capabilities.audio) chips.push('Has sound');
  if (m.duration_seconds) chips.push(`Up to ${m.duration_seconds.max} seconds`);
  return chips;
}

export function modelPrice(m: ModelInfo): string {
  return `${formatPence(m.unit_cost_pence)} ${m.unit === 'image' ? 'a picture' : 'a second'}`;
}

/** A lane segment as percentages of the whole, clamped so it never runs past the end. */
export function laneSpan(startMs: number, durationMs: number, totalMs: number): { left: string; width: string } {
  const total = Math.max(totalMs, 1);
  const start = Math.min(Math.max(startMs, 0), total);
  const width = Math.max(0, Math.min(durationMs, total - start));
  return { left: `${(start / total) * 100}%`, width: `${(width / total) * 100}%` };
}
