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
  video?: { family: string; categories: string[]; audio_mode?: 'optional' | 'always' | 'none'; final_model_id?: string; documentation: string; rollout?: 'production' | 'advanced'; verified_live?: boolean } | null;
  configuration_pricing?: boolean;
  /** Not yet checked by us with a real request and bill (Advanced only). */
  unverified?: boolean;
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
  /** The pre-paid pot: what is left to spend until a grown-up adds more. */
  pot_pence: number;
  topped_up_pence: number;
  spent_all_time_pence: number;
  daily_budget_pence: number;
  spent_today_pence: number;
  remaining_today_pence: number;
  resets_at: string;
  currency: string;
}

export interface TopUp { id: string; pence: number; note: string; added_by: string | null; created_at: string }

export interface GenerationSettings {
  enabled: boolean;
  test_mode: boolean;
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
  start_frame_asset_id?: string | null;
  end_frame_asset_id?: string | null;
  cast_saved?: boolean;
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
  task?: string | null;
  /** A quick preview or a final video (production clips only). */
  intent?: 'draft' | 'final' | null;
  parent_job_id?: string | null;
  source_scene_version?: number | null;
  /** Characters were in the scene but no pictures of them were sent. */
  words_only?: boolean;
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

export type ViewRole = 'main' | 'front' | 'three_quarter' | 'side' | 'back' | 'full_body' | 'expression';

/** An approved, unchangeable look (Character Studio CS-09). */
export interface Look {
  id: string;
  visual_version: number;
  approved_at: string;
  art_style: string;
  references: { role: ViewRole; position: number; is_main: boolean; content_sha256: string; asset: Asset }[];
  current?: boolean;
}

export interface Character {
  id: string;
  name: string;
  version: number;
  description: string;
  species: string;
  build: string;
  colours: string;
  features: string;
  costume: string | null;
  outfits: { label: string; description: string }[];
  personality: string;
  background_story: string | null;
  source: 'story' | 'manual';
  scene_numbers: number[];
  /** The approved main picture. A picture that is only a candidate never appears here. */
  main_reference: Asset | null;
  look: Look | null;
  /** none: no look chosen; approved; changed: traits edited since, the old look still in use. */
  look_status: 'none' | 'approved' | 'changed';
  story_suggestion: string | null;
  references: Asset[];
  pictures_stale: boolean;
  deleted_at: string | null;
}

export interface Candidate {
  id: string;
  view_role: ViewRole;
  source: 'generated' | 'upload' | 'refinement' | 'legacy';
  created_at: string;
  from_look_id?: string | null;
  parent_candidate_id?: string | null;
  job_id?: string | null;
  /** Passed review: may be chosen. Approval and review are separate gates (CS-11). */
  can_approve: boolean;
  asset: Asset;
}

export interface Studio {
  character: Character;
  candidates: Candidate[];
  looks: Look[];
  views: { value: ViewRole; label: string; help: string }[];
}

export type CharacterTraits = Partial<Pick<Character, 'name' | 'description' | 'species' | 'build' | 'colours' | 'features' | 'personality'>> & { costume?: string; dismiss_story_suggestion?: true };

export interface StudioJobBody { intent: 'portrait' | 'view' | 'refine'; count?: number; view?: ViewRole; candidate_id?: string; note?: string }

export interface ShotCastCharacter {
  character_id: string;
  name: string;
  proposed: boolean;
  look_id: string | null;
  look_version: number | null;
  current_look_id: string | null;
  newer_look_available: boolean;
  look_status: 'approved' | 'none';
  main_picture: Asset | null;
  outfit_label: string | null;
  outfits: string[];
}
export interface ShotCast { shot_id: string; version: number; saved: boolean; characters: ShotCastCharacter[] }

export interface VideoBody {
  expected_quote_key?: string;
  purpose: 'preview' | 'final';
  continuity: boolean;
  /** Leave out when finishing a preview to keep its length. */
  duration_seconds?: number;
  use_start_frame?: boolean;
  use_end_frame?: boolean;
  audio?: boolean;
  model_id?: string;
  from_job_id?: string;
  use_latest?: boolean;
  /** "Make another version": a short change for this run only. */
  note?: string;
}

export interface VideoPlan {
  quote_key: string;
  output: { durationSeconds: number; resolution: string; aspectRatio: string; audio: boolean };
  prompt: string;
  pence: number;
  words: string;
  task: 'text-to-video' | 'image-to-video' | 'reference-to-video';
  intent: 'draft' | 'final';
  model_id: string | null;
  model_label: string | null;
  parts: number[] | null;
  generated_seconds: number;
  characters: { character_id: string; name: string; look_version: number | null }[];
  reference_count: number;
  /** Characters are in the scene but this clip sends no pictures of them. */
  words_only: boolean;
  new_render: boolean;
  native_completion: 'unavailable';
  estimate_only: boolean;
}

/** The cartoon's one look (docs/video-optimisation-plan.md §7.1). */
export interface CartoonStyle {
  art_style: string;
  chosen: boolean;
  /** Where the cartoon happens, in the child's words; '' until chosen. */
  setting: string;
  scenes_with_own_style: { scene_id: string; scene_number: number; art_style: string | null }[];
}

/** Does every scene match? Warnings are written for the child. */
export interface Continuity {
  art_style: string;
  style_chosen: boolean;
  scenes: {
    scene_id: string; scene_number: number; title: string; art_style: string | null; own_style: boolean;
    characters: { character_id: string; name: string; saved: boolean; look_id: string | null; look_version: number | null; current_look_id: string | null }[];
    clip: { job_id: string; intent: string | null; words_only: boolean; family: string; model_id?: string; seed?: number | null } | null;
  }[];
  warnings: { kind: 'scene_style' | 'mixed_looks' | 'look_style' | 'words_only' | 'mixed_makers'; detail: string; scene_ids: string[] }[];
}

/** What a 422 "choose something first" carries, so the screen can offer the next step. */
export interface NeedsChoice {
  missing?: 'cast' | 'looks' | 'compatible_model' | 'start_frame' | 'end_frame' | 'resolution';
  characters?: { character_id: string; name: string }[];
  proposed?: { character_id: string; name: string }[];
  quick_draft_available?: boolean;
  supported_durations?: number[];
  can_use_latest?: boolean;
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
  topUps: (accountId: string) => request<{ data: TopUp[] }>(`/accounts/${accountId}/top-ups`),
  addTopUp: (accountId: string, body: { pence: number; note?: string }) =>
    request<TopUp & { allowance: Allowance }>(`/accounts/${accountId}/top-ups`, { method: 'POST', body: JSON.stringify(body) }),
  setBudget: (accountId: string, body: { daily_budget_pence?: number }) =>
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
  updateCharacter: (id: string, body: CharacterTraits, version?: number) =>
    request<Character>(`/characters/${id}`, { method: 'PATCH', body: JSON.stringify(body), ...(version ? { headers: { 'If-Match': String(version) } } : {}) }),
  deleteCharacter: (id: string) => request<void>(`/characters/${id}`, { method: 'DELETE' }),

  // Character Studio
  studio: (characterId: string) => request<Studio>(`/characters/${characterId}/studio`),
  uploadCandidate: (characterId: string, file: File, view: ViewRole = 'main') =>
    request<Candidate>(`/characters/${characterId}/references?view=${view}`, { method: 'POST', body: upload(file, file.name) }),
  removeCandidate: (characterId: string, candidateId: string) => request<void>(`/characters/${characterId}/candidates/${candidateId}`, { method: 'DELETE' }),
  approveLook: (characterId: string, body: { main_asset_id: string; pictures: { asset_id: string; role: ViewRole }[] }, version: number) =>
    request<Character>(`/characters/${characterId}/looks`, { method: 'POST', body: JSON.stringify(body), headers: { 'If-Match': String(version) } }),
  selectLook: (characterId: string, lookId: string, version: number) =>
    request<Character>(`/characters/${characterId}/looks/${lookId}/select`, { method: 'POST', headers: { 'If-Match': String(version) } }),
  quoteCharacterJob: (characterId: string, body: StudioJobBody) =>
    request<{ pence: number; words: string; count: number; keeps_look: boolean }>(`/characters/${characterId}/jobs/quote`, { method: 'POST', body: JSON.stringify(body) }),
  drawCharacter: (characterId: string, body: StudioJobBody, requestId: string) =>
    request<Job>(`/characters/${characterId}/jobs`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': requestId } }),

  // One look per cartoon, and the same characters in every scene
  cartoonStyle: (projectId: string) => request<CartoonStyle>(`/projects/${projectId}/style`),
  setCartoonStyle: (projectId: string, artStyle: string, keepSceneStyles = false) =>
    request<CartoonStyle>(`/projects/${projectId}/style`, { method: 'PUT', body: JSON.stringify({ art_style: artStyle, keep_scene_styles: keepSceneStyles }) }),
  setCartoonSetting: (projectId: string, setting: string) =>
    request<CartoonStyle>(`/projects/${projectId}/style`, { method: 'PUT', body: JSON.stringify({ setting }) }),
  continuity: (projectId: string) => request<Continuity>(`/projects/${projectId}/continuity`),
  lookElsewhere: (characterId: string, lookId: string) => request<{ scenes_to_update: number; scenes_with_clips: number }>(`/characters/${characterId}/looks/${lookId}/use-everywhere`),
  useLookEverywhere: (characterId: string, lookId: string) =>
    request<{ scenes_updated: number; scenes_with_clips: number }>(`/characters/${characterId}/looks/${lookId}/use-everywhere`, { method: 'POST' }),

  // Characters in a scene, starting pictures and production clips
  shotCast: (shotId: string) => request<ShotCast>(`/shots/${shotId}/cast`),
  saveShotCast: (shotId: string, characters: { character_id: string; look?: 'current' | 'none' | string; outfit_label?: string | null }[], version: number) =>
    request<ShotCast>(`/shots/${shotId}/cast`, { method: 'PUT', body: JSON.stringify({ characters }), headers: { 'If-Match': String(version) } }),
  uploadFrame: (shotId: string, file: File) => request<Asset>(`/shots/${shotId}/frames`, { method: 'POST', body: upload(file, file.name) }),
  setFrames: (shotId: string, body: { start_asset_id?: string | null; end_asset_id?: string | null }, version: number) =>
    request<Shot>(`/shots/${shotId}/frames`, { method: 'PUT', body: JSON.stringify(body), headers: { 'If-Match': String(version) } }),
  quoteVideo: (shotId: string, body: VideoBody) => request<VideoPlan>(`/shots/${shotId}/videos/quote`, { method: 'POST', body: JSON.stringify(body) }),
  startVideo: (shotId: string, body: VideoBody, requestId: string) =>
    request<Job & { plan: VideoPlan | null; shot: Shot | null }>(`/shots/${shotId}/videos`, { method: 'POST', body: JSON.stringify(body), headers: { 'Idempotency-Key': requestId } }),

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
