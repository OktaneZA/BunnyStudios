/**
 * Full domain model — requirements §3.
 *
 * Deviations from the spec, all recorded in docs/build-plan-v1.1.md:
 *   D6  one compiled prompt per shot. No outputMode, no compiled_prompt_video, and
 *       camera_movement / motion_intent are absent in v1.
 *   D1  every table carries account_id from day one so opening this up later is not a migration.
 *
 * Controlled-vocabulary enums are derived from @storyboard/vocabularies rather than retyped,
 * so CV-1's "one machine-readable fixture" holds at the database layer too.
 */
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
  uniqueIndex,
  bigint,
} from 'drizzle-orm/pg-core';
import { values } from '@storyboard/vocabularies';

/** drizzle's pgEnum wants a non-empty tuple; vocabularies always supply one. */
function enumValues(name: Parameters<typeof values>[0]): [string, ...string[]] {
  const v = values(name);
  if (v.length === 0) throw new Error(`Vocabulary ${name} is empty`);
  return v as unknown as [string, ...string[]];
}

// ── Enums derived from the vocabulary fixture (§4) ──────────────────────────
export const shotTypeEnum = pgEnum('shot_type', enumValues('shot_type'));
export const cameraAngleEnum = pgEnum('camera_angle', enumValues('camera_angle'));
export const lensFocalLengthEnum = pgEnum('lens_focal_length', enumValues('lens_focal_length'));
export const depthOfFieldEnum = pgEnum('depth_of_field', enumValues('depth_of_field'));
export const lightingPresetEnum = pgEnum('lighting_preset', enumValues('lighting_preset'));
export const timeOfDayEnum = pgEnum('time_of_day', enumValues('time_of_day'));
export const moodAtmosphereEnum = pgEnum('mood_atmosphere', enumValues('mood_atmosphere'));
export const cameraMovementEnum = pgEnum('camera_movement', enumValues('camera_movement'));

// ── Structural enums (§3) ───────────────────────────────────────────────────
export const authProviderEnum = pgEnum('auth_provider', ['email_password', 'google', 'apple']);
export const editorModeEnum = pgEnum('editor_mode', ['simple', 'advanced']);
export const targetAudienceEnum = pgEnum('target_audience', [
  'preschool', 'kids_6_11', 'tween', 'teen', 'adult', 'all_ages',
]);
export const projectStatusEnum = pgEnum('project_status', [
  'draft', 'in_progress', 'complete', 'archived',
]);
export const aspectRatioEnum = pgEnum('aspect_ratio', ['16:9', '9:16', '1:1', '4:3', '2.39:1']);
export const frameRateIntentEnum = pgEnum('frame_rate_intent', ['12fps_limited', '24fps', '30fps']);
export const narrationStyleEnum = pgEnum('narration_style', [
  'none', 'character_vo', 'omniscient_narrator',
]);
export const characterRoleEnum = pgEnum('character_role', [
  'protagonist', 'antagonist', 'supporting', 'background', 'narrator',
]);
export const interiorExteriorEnum = pgEnum('interior_exterior', ['INT', 'EXT', 'INT/EXT']);
export const propSignificanceEnum = pgEnum('prop_significance', [
  'plot_critical', 'running_gag', 'set_dressing',
]);
export const musicGenreEnum = pgEnum('music_genre', [
  'orchestral', 'jazz', 'chiptune', 'synthwave', 'folk_acoustic', 'rock',
  'hip_hop', 'ambient', 'circus_polka', 'lullaby', 'marching_band', 'silence',
]);
export const episodeStatusEnum = pgEnum('episode_status', [
  'outline', 'drafting', 'locked', 'exported',
]);
export const transitionEnum = pgEnum('transition', [
  'cut', 'fade_in', 'fade_out', 'dissolve', 'wipe', 'match_cut', 'smash_cut',
]);
export const generationStatusEnum = pgEnum('generation_status', [
  'not_started', 'exported', 'generated', 'approved', 'needs_rework',
]);
export const continuityTargetEnum = pgEnum('continuity_target', [
  'scene', 'shot', 'scene_pair', 'project',
]);
export const detectorEnum = pgEnum('detector', [
  'absent_speaker', 'costume_contradiction', 'bible_rule_violation', 'unestablished_prop',
  'time_discontinuity', 'location_contradiction', 'style_drift', 'voice_drift',
]);
export const severityEnum = pgEnum('severity', ['info', 'warning', 'error']);
export const assetKindEnum = pgEnum('asset_kind', [
  'style_ref', 'character_ref', 'location_ref', 'prop_ref', 'generated_output', 'cover', 'scene_thumbnail',
  'final_render', 'music', 'voiceover', 'poster', 'frame_ref',
]);
export const proposalStatusEnum = pgEnum('proposal_status', [
  'pending', 'accepted', 'rejected', 'cancelled', 'expired',
]);
export const proposalScopeEnum = pgEnum('proposal_scope', [
  'tree', 'collection', 'record', 'field', 'advisory',
]);
export const exportFormatEnum = pgEnum('export_format', [
  'markdown', 'json', 'csv', 'pdf', 'txt_bundle',
]);
export const exportScopeEnum = pgEnum('export_scope', ['episode', 'scene', 'shot_selection']);

// ── Director Mode (docs/director-mode-plan-v1.md) ───────────────────────────
export const generationJobKindEnum = pgEnum('generation_job_kind', ['image', 'video', 'render']);
export const generationJobStatusEnum = pgEnum('generation_job_status', [
  'queued', 'submitted', 'running', 'reviewing', 'ready', 'failed', 'cancelled',
]);
export const ledgerStatusEnum = pgEnum('ledger_status', ['reserved', 'settled', 'refunded']);
export const reviewStatusEnum = pgEnum('review_status', ['not_required', 'pending', 'allowed', 'rejected']);
export const characterSourceEnum = pgEnum('character_source', ['manual', 'story']);
export const transitionOutEnum = pgEnum('transition_out', ['cut', 'fade', 'slide']);

// ── Character Studio (docs/character-studio-requirements.md) ────────────────
/** The views a reference pack can hold (CS-05). `main` is the identity anchor. */
export const referenceViewEnum = pgEnum('reference_view', [
  'main', 'front', 'three_quarter', 'side', 'back', 'full_body', 'expression',
]);
/** Where a candidate picture came from. `legacy` = a pre-Studio picture awaiting confirmation (CS-12). */
export const candidateSourceEnum = pgEnum('candidate_source', ['generated', 'upload', 'refinement', 'legacy']);
export const candidateStatusEnum = pgEnum('candidate_status', ['candidate', 'removed']);
/**
 * MG-07: where a paid submission got to. `submitting` is written before the provider call, so a
 * crash inside that window is visible afterwards as `uncertain` instead of being retried blind.
 */
export const submissionStateEnum = pgEnum('submission_state', ['not_submitted', 'submitting', 'accepted', 'uncertain']);
export const generationIntentEnum = pgEnum('generation_intent', ['draft', 'final']);
/**
 * MB-04: what we know about the real bill. `estimated` = our quote stands in for it; `actual` =
 * the provider reported it; `unknown` = work was submitted and may be billed, amount unconfirmed;
 * `not_incurred` = nothing reached the provider.
 */
export const costStateEnum = pgEnum('cost_state', ['estimated', 'actual', 'unknown', 'not_incurred']);

// ── §3.2 Account ────────────────────────────────────────────────────────────
export const accounts = pgTable('accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 320 }).notNull().unique(),
  displayName: text('display_name').notNull(),
  authProvider: authProviderEnum('auth_provider').notNull().default('email_password'),
  /** Hex scrypt hash. v1 credentials are seeded from Key Vault (plan D8). */
  passwordHash: text('password_hash'),
  defaultEditorMode: editorModeEnum('default_editor_mode').notNull().default('simple'),
  /**
   * Plan D16: on a teen account the constrained AI system prompt is applied to every
   * generation regardless of a project's target_audience, which a 13-year-old can change
   * in two taps. Not a preference — a property of who is generating.
   */
  isMinor: boolean('is_minor').notNull().default(false),
  /**
   * Plan D31: the daily cap in pence, set by the adult account; the teen sees it as "about N
   * pictures". The long-run limit is the pre-paid pot (credit_top_ups), not a monthly cap.
   */
  dailyBudgetPence: integer('daily_budget_pence').notNull().default(200),
  currency: varchar('currency', { length: 3 }).notNull().default('GBP'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

// ── §3.3 Project ────────────────────────────────────────────────────────────
export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    genre: text('genre').array().notNull().default([]),
    targetAudience: targetAudienceEnum('target_audience').notNull().default('kids_6_11'),
    tone: text('tone').array().notNull().default([]),
    editorMode: editorModeEnum('editor_mode').notNull().default('simple'),
    status: projectStatusEnum('status').notNull().default('draft'),
    seriesNumber: integer('series_number'),
    coverImageAssetId: uuid('cover_image_asset_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Logical delete. A deleted cartoon and everything under it (bible, episodes, scenes,
     * thumbnails, AI history) stays in the database untouched; it is simply hidden from
     * every read and can be put back. Nothing hard-deletes a project.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('projects_account_idx').on(t.accountId)],
);

// ── §3.4 SeriesBible (1:1 with Project) ─────────────────────────────────────
export const seriesBibles = pgTable('series_bibles', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().unique()
    .references(() => projects.id, { onDelete: 'cascade' }),
  artStyle: text('art_style').notNull().default(''),
  /** Where the cartoon happens, in the child's words ("a sunny beach by the sea"). Every scene without its own location uses it. */
  defaultSetting: text('default_setting').notNull().default(''),
  styleReferenceAssetIds: uuid('style_reference_asset_ids').array().notNull().default([]),
  /** [{name, hex, role}] — role ∈ primary|secondary|accent|shadow|highlight */
  colourPalette: jsonb('colour_palette').notNull().default([]),
  lineTreatment: text('line_treatment').notNull().default(''),
  renderQualityTokens: text('render_quality_tokens').notNull().default(''),
  negativePrompt: text('negative_prompt').notNull().default(''),
  aspectRatio: aspectRatioEnum('aspect_ratio').notNull().default('16:9'),
  resolutionTarget: text('resolution_target').notNull().default(''),
  frameRateIntent: frameRateIntentEnum('frame_rate_intent').notNull().default('24fps'),
  defaultLighting: text('default_lighting').notNull().default(''),
  musicGenre: text('music_genre').notNull().default(''),
  musicInstrumentation: text('music_instrumentation').notNull().default(''),
  soundDesignNotes: text('sound_design_notes').notNull().default(''),
  narrationStyle: narrationStyleEnum('narration_style').notNull().default('none'),
  continuityRules: text('continuity_rules').array().notNull().default([]),
});

// ── §3.5 Character ──────────────────────────────────────────────────────────
export const characters = pgTable(
  'characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: characterRoleEnum('role').notNull().default('supporting'),
    /** The field that keeps one character identical across 200 shots (§3.5). */
    promptToken: text('prompt_token').notNull().default(''),
    referenceAssetIds: uuid('reference_asset_ids').array().notNull().default([]),
    /**
     * Phase -1 may promote this from a nullable footnote to a first-class workflow object
     * if Character Builder — not prompt text — turns out to be what holds a character.
     */
    openartCharacterRef: text('openart_character_ref'),
    ageAppearance: text('age_appearance').notNull().default(''),
    physicalBuild: text('physical_build').notNull().default(''),
    distinguishingFeatures: text('distinguishing_features').notNull().default(''),
    defaultCostume: text('default_costume').notNull().default(''),
    /** [{label, description}] */
    costumeVariants: jsonb('costume_variants').notNull().default([]),
    personality: text('personality').notNull().default(''),
    motivation: text('motivation').notNull().default(''),
    speechPattern: text('speech_pattern').notNull().default(''),
    voiceDirection: text('voice_direction').notNull().default(''),
    characterArc: text('character_arc').notNull().default(''),
    /** [{other_character_id, relationship}] */
    relationships: jsonb('relationships').notNull().default([]),
    /** Plan D39: 'story' rows were found in the scene text by a proposal; 'manual' were typed. */
    source: characterSourceEnum('source').notNull().default('manual'),
    foundInSceneIds: uuid('found_in_scene_ids').array().notNull().default([]),
    /** Fingerprint of the description the cast proposal read, so pictures can be marked stale. */
    descriptionFingerprint: text('description_fingerprint'),
    mainReferenceAssetId: uuid('main_reference_asset_id'),
    backgroundStory: text('background_story').notNull().default(''),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /** Optimistic edit version for Studio writes (CS-09). */
    version: integer('version').notNull().default(1),
    /** The selected approved look. Null until someone says "This looks like <name>". */
    currentVisualVersionId: uuid('current_visual_version_id'),
    /** CS-02 optional visual traits. Personality lives in its own fields, never here. */
    species: text('species').notNull().default(''),
    colours: text('colours').notNull().default(''),
    /** CS-08: traits were edited after the look was approved; the approved look stays in use. */
    lookOutdated: boolean('look_outdated').notNull().default(false),
    /** CS-08: what story rediscovery would have written, kept as a suggestion when a look is approved. */
    storySuggestion: text('story_suggestion'),
  },
  (t) => [index('characters_project_idx').on(t.projectId)],
);

/**
 * CS-09: an approved look. Rows are immutable once written; approving again inserts a new row
 * and moves characters.current_visual_version_id. Going back selects an older row.
 */
export const characterVisualVersions = pgTable(
  'character_visual_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
    visualVersion: integer('visual_version').notNull(),
    /** The traits and style that were true when this look was approved. */
    traits: jsonb('traits').notNull(),
    artStyle: text('art_style').notNull().default(''),
    approvedBy: uuid('approved_by').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('character_visual_versions_unique').on(t.characterId, t.visualVersion)],
);

/** CS-04: a picture that might become part of a look. Being a candidate never changes identity. */
export const characterReferenceCandidates = pgTable(
  'character_reference_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
    viewRole: referenceViewEnum('view_role').notNull().default('main'),
    source: candidateSourceEnum('source').notNull(),
    /** The approved look this was generated from, when it was generated from one (CS-06). */
    sourceVisualVersionId: uuid('source_visual_version_id'),
    /** "Change this picture" makes a new candidate pointing at the one it changed. */
    parentCandidateId: uuid('parent_candidate_id'),
    generationJobId: uuid('generation_job_id'),
    status: candidateStatusEnum('status').notNull().default('candidate'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('character_reference_candidates_character_idx').on(t.characterId, t.createdAt), uniqueIndex('character_reference_candidates_asset_unique').on(t.characterId, t.assetId)],
);

/** CS-10: the exact pictures of an approved look, pinned by content hash and order. */
export const characterVisualReferences = pgTable(
  'character_visual_references',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    visualVersionId: uuid('visual_version_id').notNull().references(() => characterVisualVersions.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').notNull().references(() => assets.id),
    contentSha256: text('content_sha256').notNull(),
    role: referenceViewEnum('role').notNull(),
    position: integer('position').notNull(),
    isMain: boolean('is_main').notNull().default(false),
  },
  (t) => [uniqueIndex('character_visual_references_position').on(t.visualVersionId, t.position)],
);

// ── §3.6 Location ───────────────────────────────────────────────────────────
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    promptToken: text('prompt_token').notNull().default(''),
    interiorExterior: interiorExteriorEnum('interior_exterior').notNull().default('INT'),
    referenceAssetIds: uuid('reference_asset_ids').array().notNull().default([]),
    defaultTimeOfDay: timeOfDayEnum('default_time_of_day'),
    defaultLighting: text('default_lighting').notNull().default(''),
    ambientSound: text('ambient_sound').notNull().default(''),
    setDressing: text('set_dressing').notNull().default(''),
  },
  (t) => [index('locations_project_idx').on(t.projectId)],
);

// ── §3.7 Prop ───────────────────────────────────────────────────────────────
export const props = pgTable(
  'props',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    promptToken: text('prompt_token').notNull().default(''),
    referenceAssetIds: uuid('reference_asset_ids').array().notNull().default([]),
    significance: propSignificanceEnum('significance').notNull().default('set_dressing'),
  },
  (t) => [index('props_project_idx').on(t.projectId)],
);

// ── §3.8 MusicCue ───────────────────────────────────────────────────────────
export const musicCues = pgTable(
  'music_cues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    genre: musicGenreEnum('genre').notNull().default('orchestral'),
    tempoBpm: integer('tempo_bpm'),
    mood: text('mood').notNull().default(''),
    instrumentation: text('instrumentation').notNull().default(''),
    referenceTrackNote: text('reference_track_note').notNull().default(''),
    loopable: boolean('loopable').notNull().default(false),
  },
  (t) => [index('music_cues_project_idx').on(t.projectId)],
);

// ── §3.9 Episode ────────────────────────────────────────────────────────────
export const episodes = pgTable(
  'episodes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    episodeNumber: integer('episode_number').notNull().default(1),
    title: text('title').notNull().default(''),
    logline: text('logline').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    targetDurationSeconds: integer('target_duration_seconds'),
    status: episodeStatusEnum('status').notNull().default('outline'),
    rawScript: text('raw_script'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('episodes_project_idx').on(t.projectId, t.sortOrder)],
);

// ── §3.10 Scene ─────────────────────────────────────────────────────────────
export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
    sceneNumber: integer('scene_number').notNull().default(1),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Logical delete, like projects.deleted_at. The scene, its thumbnail asset and AI history stay. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    slugline: text('slugline').notNull().default(''),
    title: text('title').notNull().default(''),
    locationId: uuid('location_id').references(() => locations.id, { onDelete: 'set null' }),
    timeOfDay: timeOfDayEnum('time_of_day').notNull().default('unspecified'),
    weather: text('weather'),
    /** uuid[] with GIN, per plan — supports SB-5's reverse lookup without a join table. */
    characterIds: uuid('character_ids').array().notNull().default([]),
    /** [{character_id, costume_variant_label}] */
    costumeOverrides: jsonb('costume_overrides').notNull().default([]),
    sceneIntent: text('scene_intent').notNull().default(''),
    /** Unified scene-writing field; null reads the legacy fields without losing their text. */
    description: text('description'),
    cameraAngle: cameraAngleEnum('camera_angle'),
    /** §4.3, video template only (docs/video-optimisation-plan.md V5). Null: the clip maker decides. */
    cameraMovement: cameraMovementEnum('camera_movement'),
    emotionalBeat: text('emotional_beat').notNull().default(''),
    synopsis: text('synopsis').notNull().default(''),
    actionDescription: text('action_description').notNull().default(''),
    sceneryDescription: text('scenery_description').notNull().default(''),
    lighting: text('lighting').notNull().default(''),
    lightingPreset: lightingPresetEnum('lighting_preset'),
    moodAtmosphere: moodAtmosphereEnum('mood_atmosphere'),
    styleOverride: text('style_override'),
    musicCueId: uuid('music_cue_id').references(() => musicCues.id, { onDelete: 'set null' }),
    musicDirection: text('music_direction').notNull().default(''),
    sfx: text('sfx').array().notNull().default([]),
    /** §3.11 ScriptLine[], embedded. Diffed per line by id for NF-10b. */
    scriptLines: jsonb('script_lines').notNull().default([]),
    estimatedDurationSeconds: integer('estimated_duration_seconds'),
    transitionIn: transitionEnum('transition_in').notNull().default('cut'),
    transitionOut: transitionEnum('transition_out').notNull().default('cut'),
    /** Never exported to prompts (§3.10). */
    directorNotes: text('director_notes').notNull().default(''),
    isLocked: boolean('is_locked').notNull().default(false),
    thumbnailAssetId: uuid('thumbnail_asset_id'),
    thumbnailSourceFingerprint: text('thumbnail_source_fingerprint'),
    thumbnailRevision: integer('thumbnail_revision').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('scenes_episode_idx').on(t.episodeId, t.sortOrder),
    index('scenes_character_ids_idx').using('gin', t.characterIds),
  ],
);

// ── §3.12 Shot — the export unit ────────────────────────────────────────────
export const shots = pgTable(
  'shots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').notNull().references(() => scenes.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Derived from position; a letter suffix (4B) may be appended by the user. */
    shotNumber: text('shot_number').notNull().default('1'),
    /**
     * Immutable. The matching authority when files come back from OpenArt (EX-7, GR-2),
     * because scene and shot numbers change on reorder. Uniqueness is checked per project
     * at insert and the key extended on collision — 6 hex chars alone collide in the low
     * thousands of shots, which would break GR-2's zero-mis-assignment requirement.
     */
    exportKey: text('export_key').notNull(),
    shotType: shotTypeEnum('shot_type').notNull().default('medium'),
    cameraAngle: cameraAngleEnum('camera_angle').notNull().default('eye_level'),
    lensFocalLength: lensFocalLengthEnum('lens_focal_length').notNull().default('normal_50mm'),
    depthOfField: depthOfFieldEnum('depth_of_field').notNull().default('deep_focus'),
    subjectCharacterIds: uuid('subject_character_ids').array().notNull().default([]),
    subjectPlacement: text('subject_placement').notNull().default(''),
    actionBeat: text('action_beat').notNull().default(''),
    expressionNote: text('expression_note').notNull().default(''),
    visibleProps: uuid('visible_props').array().notNull().default([]),
    lightingOverride: text('lighting_override'),
    durationSeconds: numeric('duration_seconds', { precision: 6, scale: 2 }),
    /** D6: single compiled prompt. No still/video split in v1. */
    compiledPrompt: text('compiled_prompt').notNull().default(''),
    compiledNegativePrompt: text('compiled_negative_prompt').notNull().default(''),
    promptTemplateVersion: text('prompt_template_version').notNull().default('v1'),
    generationStatus: generationStatusEnum('generation_status').notNull().default('not_started'),
    generatedAssetIds: uuid('generated_asset_ids').array().notNull().default([]),
    heroAssetId: uuid('hero_asset_id'),
    /** The picked clip (D35). heroAssetId stays the picked picture the clip started from. */
    heroVideoAssetId: uuid('hero_video_asset_id'),
    reworkNote: text('rework_note'),
    userPromptAddendum: text('user_prompt_addendum').notNull().default(''),
    promptLocked: boolean('prompt_locked').notNull().default(false),
    aiDefaultUnreviewed: boolean('ai_default_unreviewed').notNull().default(false),
    /** CR-06: chosen production pictures a clip starts / ends on. Never a rough sketch. */
    startFrameAssetId: uuid('start_frame_asset_id'),
    endFrameAssetId: uuid('end_frame_asset_id'),
    /** CR-01: the user saved "Characters in this shot" (possibly nobody); stop proposing from the story. */
    castSaved: boolean('cast_saved').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('shots_scene_idx').on(t.sceneId, t.sortOrder),
    uniqueIndex('shots_export_key_unique').on(t.projectId, t.exportKey),
    index('shots_subject_character_ids_idx').using('gin', t.subjectCharacterIds),
  ],
);

/**
 * CR-01: "Characters in this shot". An explicit, accepted binding of a character and the look
 * it uses. A null look means the character is in the shot by words only (no continuity promise).
 */
export const shotCharacterBindings = pgTable(
  'shot_character_bindings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id').notNull().references(() => shots.id, { onDelete: 'cascade' }),
    characterId: uuid('character_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
    visualVersionId: uuid('visual_version_id').references(() => characterVisualVersions.id),
    outfitLabel: text('outfit_label'),
    position: integer('position').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('shot_character_bindings_unique').on(t.shotId, t.characterId), index('shot_character_bindings_shot_idx').on(t.shotId, t.position)],
);

// ── §3.13 Asset ─────────────────────────────────────────────────────────────
export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    ownerEntityType: text('owner_entity_type').notNull(),
    ownerEntityId: uuid('owner_entity_id'),
    kind: assetKindEnum('kind').notNull(),
    filename: text('filename').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: text('storage_key').notNull(),
    /** Small, application-rendered SVG sketches only; ordinary uploads still use Blob. */
    thumbnailSvg: text('thumbnail_svg'),
    thumbnailDescription: text('thumbnail_description'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    /** Extracted first frame for videos; what GR-4 and EX-6 display. */
    posterAssetId: uuid('poster_asset_id'),
    /** Plan D32 gate 3: a rejected take is kept, hidden from the teen, listed for the adult. */
    reviewStatus: reviewStatusEnum('review_status').notNull().default('not_required'),
    reviewReason: text('review_reason'),
    /** Which generation job made this take, so the media bin can group by request. */
    generationJobId: uuid('generation_job_id'),
    /** The model that made it, for the adult's view and the ledger. */
    modelId: text('model_id'),
    /** sha256 of the stored bytes (CS-10). Null only for rows written before it was recorded. */
    contentSha256: text('content_sha256'),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('assets_project_idx').on(t.projectId, t.kind), index('assets_owner_idx').on(t.ownerEntityType, t.ownerEntityId)],
);

// ── §3.13b UnmatchedUpload — backs the GR-2 manual-assignment tray ───────────
export const unmatchedUploads = pgTable('unmatched_uploads', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
  assetId: uuid('asset_id').notNull().references(() => assets.id, { onDelete: 'cascade' }),
  originalFilename: text('original_filename').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  assignedShotId: uuid('assigned_shot_id').references(() => shots.id, { onDelete: 'set null' }),
});

// ── §3.10b ContinuityFlag ───────────────────────────────────────────────────
export const continuityFlags = pgTable(
  'continuity_flags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
    targetEntityType: continuityTargetEnum('target_entity_type').notNull(),
    targetEntityId: uuid('target_entity_id').notNull(),
    /** The other scene, for scene_pair flags (detector 5). */
    secondaryEntityId: uuid('secondary_entity_id'),
    detector: detectorEnum('detector').notNull(),
    severity: severityEnum('severity').notNull().default('warning'),
    field: text('field'),
    message: text('message').notNull(),
    suggestedFix: text('suggested_fix'),
    /** Dismissals key on this, so a re-run raises nothing new while content is unchanged (CC-3). */
    dedupeHash: text('dedupe_hash').notNull(),
    dismissed: boolean('dismissed').notNull().default(false),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('continuity_flags_project_idx').on(t.projectId, t.dismissed),
    uniqueIndex('continuity_flags_dedupe_unique').on(t.projectId, t.dedupeHash),
  ],
);

// ── §3.14 AiInteraction (audit + cost) ──────────────────────────────────────
export const aiInteractions = pgTable('ai_interactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  operation: text('operation').notNull(),
  mode: editorModeEnum('mode').notNull(),
  targetEntityType: text('target_entity_type'),
  targetEntityId: uuid('target_entity_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  model: text('model').notNull().default(''),
  latencyMs: integer('latency_ms'),
  /** Set at accept/reject time, not at generation time (AI-4). */
  accepted: boolean('accepted'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── §6.5 AiProposal — nothing reaches a domain record without an accept ─────
export const aiProposals = pgTable('ai_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  operation: text('operation').notNull(),
  scope: proposalScopeEnum('scope').notNull(),
  targetEntityType: text('target_entity_type'),
  targetEntityId: uuid('target_entity_id'),
  payload: jsonb('payload').notNull(),
  status: proposalStatusEnum('status').notNull().default('pending'),
  revertToken: text('revert_token'),
  /** Snapshot of prior state, so AI-2's revert restores exactly. */
  revertPayload: jsonb('revert_payload'),
  aiInteractionId: uuid('ai_interaction_id').references(() => aiInteractions.id),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// ── §3.15 ExportPack ────────────────────────────────────────────────────────
export const exportPacks = pgTable('export_packs', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  episodeId: uuid('episode_id').references(() => episodes.id, { onDelete: 'cascade' }),
  scope: exportScopeEnum('scope').notNull(),
  format: exportFormatEnum('format').notNull(),
  shotCount: integer('shot_count').notNull().default(0),
  templateVersion: text('template_version').notNull(),
  storageKey: text('storage_key').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── NF-8 scene version history, last 20, restorable ─────────────────────────
export const sceneVersions = pgTable(
  'scene_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').notNull().references(() => scenes.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('scene_versions_unique').on(t.sceneId, t.version)],
);

// ── Director Mode: jobs, ledger, timeline ───────────────────────────────────

/** The queue (plan D30). A runner claims rows with UPDATE … RETURNING; stale claims are free. */
export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    /** The client's Idempotency-Key, so a lost response never double-spends. */
    requestKey: uuid('request_key').notNull(),
    kind: generationJobKindEnum('kind').notNull(),
    /** 'shot' | 'character' | 'timeline' */
    targetEntityType: text('target_entity_type').notNull(),
    targetEntityId: uuid('target_entity_id').notNull(),
    modelId: text('model_id').notNull(),
    provider: text('provider').notNull(),
    providerJobId: text('provider_job_id'),
    /** Prompt, options and the asset ids used as references; never file bytes. */
    request: jsonb('request').notNull(),
    status: generationJobStatusEnum('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    claimedBy: text('claimed_by'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    errorCode: text('error_code'),
    /** Always user-safe. Upstream bodies are never stored here. */
    errorDetail: text('error_detail'),
    resultAssetIds: uuid('result_asset_ids').array().notNull().default([]),
    /**
     * The job's step trail: [{at, step, detail?, part?, parts?, raw?}]. What the runner did and
     * when, so a slow or stuck clip says where it got to. `raw` is server-side error text: it is
     * only ever shown to the adult account.
     */
    events: jsonb('events').notNull().default([]),
    /** MG-05: the task the request asked for ('text-to-video' | 'image-to-video' | 'reference-to-video' | image intents). */
    task: text('task'),
    /** DF-01: a quick preview or a final video. Null for older jobs and pictures. */
    intent: generationIntentEnum('intent'),
    /** Drafts and finals of one idea share a group; each still has its own quote and reservation. */
    generationGroupId: uuid('generation_group_id'),
    parentJobId: uuid('parent_job_id'),
    /** Version of the creative snapshot inside `request.creative`; null = legacy request shape. */
    snapshotVersion: integer('snapshot_version'),
    submissionState: submissionStateEnum('submission_state').notNull().default('not_submitted'),
    /** Durable poll scheduling: a released job is not claimed again before this. */
    nextPollAt: timestamp('next_poll_at', { withTimezone: true }),
    /** Provider metadata kept for lineage: seed, native draft id and its expiry (DF-04). */
    providerResult: jsonb('provider_result'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    index('generation_jobs_group_idx').on(t.generationGroupId),
    uniqueIndex('generation_jobs_request_key').on(t.accountId, t.requestKey),
    index('generation_jobs_status_idx').on(t.status, t.createdAt),
    index('generation_jobs_target_idx').on(t.targetEntityType, t.targetEntityId),
  ],
);

/**
 * Pre-paid picture money. An adult adds money to an account's pot; every generation reserves
 * from it through the ledger. The pot is never stored as a running number: it is the sum of
 * top-ups minus everything the ledger still counts, so it cannot drift.
 */
export const creditTopUps = pgTable(
  'credit_top_ups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    /** The adult who added it; null for the starting pot created by a migration. */
    addedByAccountId: uuid('added_by_account_id').references(() => accounts.id, { onDelete: 'set null' }),
    pence: integer('pence').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credit_top_ups_account_idx').on(t.accountId, t.createdAt)],
);

/** Plan D31: real money per generation, reserved before submit, settled or refunded after. */
export const generationLedger = pgTable(
  'generation_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull().references(() => generationJobs.id, { onDelete: 'cascade' }),
    modelId: text('model_id').notNull(),
    units: integer('units').notNull(),
    unitCostPence: numeric('unit_cost_pence', { precision: 8, scale: 3 }).notNull(),
    estimatedPence: integer('estimated_pence').notNull(),
    actualPence: integer('actual_pence'),
    currency: varchar('currency', { length: 3 }).notNull().default('GBP'),
    status: ledgerStatusEnum('status').notNull().default('reserved'),
    /** MB-04: what we know about the real bill. */
    costState: costStateEnum('cost_state').notNull().default('estimated'),
    /**
     * MB-02: how the estimate was made: strategy, provider rate and currency, the dated price
     * source, and the budget conversion policy (labelled a policy, not a live exchange rate).
     */
    pricingSnapshot: jsonb('pricing_snapshot'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('generation_ledger_account_day_idx').on(t.accountId, t.createdAt)],
);

export const timelines = pgTable('timelines', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
  projectId: uuid('project_id').notNull().unique().references(() => projects.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  handEdited: boolean('hand_edited').notNull().default(false),
  musicAssetId: uuid('music_asset_id'),
  musicVolume: integer('music_volume').notNull().default(70),
  musicFadeInMs: integer('music_fade_in_ms').notNull().default(0),
  musicFadeOutMs: integer('music_fade_out_ms').notNull().default(1500),
  /** The last successful render, shown in the player. */
  renderAssetId: uuid('render_asset_id'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const timelineItems = pgTable(
  'timeline_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    timelineId: uuid('timeline_id').notNull().references(() => timelines.id, { onDelete: 'cascade' }),
    sceneId: uuid('scene_id').notNull().references(() => scenes.id, { onDelete: 'cascade' }),
    shotId: uuid('shot_id'),
    /** Null means the DM-24 fallback: the shot's hero picture, then its sketch, else skipped. */
    assetId: uuid('asset_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    trimInMs: integer('trim_in_ms').notNull().default(0),
    trimOutMs: integer('trim_out_ms'),
    /** Plan D40: how this item joins the next one. */
    transitionOut: transitionOutEnum('transition_out').notNull().default('fade'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('timeline_items_timeline_idx').on(t.timelineId, t.sortOrder)],
);

export const timelineVoiceovers = pgTable(
  'timeline_voiceovers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'cascade' }),
    timelineId: uuid('timeline_id').notNull().references(() => timelines.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id').notNull(),
    startMs: integer('start_ms').notNull().default(0),
    volume: integer('volume').notNull().default(100),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('timeline_voiceovers_timeline_idx').on(t.timelineId, t.startMs)],
);
