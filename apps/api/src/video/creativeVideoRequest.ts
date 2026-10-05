/**
 * Provider-neutral creative inputs (MG-01). No endpoint IDs, fal field names or arbitrary
 * options. Two layers:
 *
 *   CreativeVideoSnapshot — what a job persists (asset IDs + hashes, versions, intent). Immutable
 *                           once the job exists; a re-run reuses it (MG-05, DF-02).
 *   CreativeVideoRequest  — what an adapter receives after the runner has resolved every asset
 *                           to bytes, checked ownership, approval and the recorded hash.
 */

export const CREATIVE_SNAPSHOT_VERSION = 1;

export type VideoTaskName = 'text-to-video' | 'image-to-video' | 'reference-to-video';
export type GenerationIntent = 'draft' | 'final';

/** CR-03: one picture of one character's approved look, in the order the provider will see it. */
/** The placeholder a style reference carries in a manifest's character fields; the name reads well in a token list. */
export const STYLE_REFERENCE = { id: 'style', name: 'the cartoon’s style picture' } as const;

export interface ReferenceBinding {
  assetId: string;
  contentHash: string;
  modality: 'image';
  /** `style` is the cartoon's style picture (§7.2), always last; its character fields hold the placeholder STYLE_REFERENCE. */
  role: 'character' | 'style';
  characterId: string;
  characterName: string;
  characterVisualVersionId: string;
  view: string;
  /** 0-based position in the provider request; the adapter turns it into @Image<position+1>. */
  position: number;
}

export interface CastBinding {
  characterId: string;
  name: string;
  /** Null: in the shot by words only, with no continuity promise (CR-01, CR-02). */
  visualVersionId: string | null;
  visualVersion: number | null;
  outfitLabel: string | null;
}

export interface FrameBinding {
  assetId: string;
  contentHash: string;
}

export interface CreativeVideoSnapshot {
  schemaVersion: typeof CREATIVE_SNAPSHOT_VERSION;
  shotId: string;
  /** Scene revision used for these instructions; absent on older recipes. */
  sceneVersion?: number;
  task: VideoTaskName;
  intent: GenerationIntent;
  /** Server compiled (CR-05); the browser never supplies it. */
  prompt: string;
  negativePrompt: string;
  compilerVersion: string;
  startFrame: FrameBinding | null;
  endFrame: FrameBinding | null;
  references: ReferenceBinding[];
  characters: CastBinding[];
  output: { durationSeconds: number; resolution: string; aspectRatio: '16:9' | '9:16' | '1:1'; audio: boolean };
  /** §4.3 camera_movement value the prompt was compiled with; absent on older recipes. */
  cameraMovement?: string | null;
  /** V4: the preview's seed, reused by its final on the same endpoint. Null: the provider picks. */
  seed?: number | null;
  /** Endpoint and adapter the snapshot was routed to, and the quote it was reserved at (MG-05). */
  modelId: string;
  adapterVersion: string;
  quotePence: number;
}

/** What an adapter receives: every asset resolved to an image the provider can read. */
export interface CreativeVideoRequest<Image> {
  prompt: string;
  negativePrompt: string;
  referenceImages: Image[];
  referenceNames?: string[];
  startFrame: Image | null;
  endFrame?: Image | null;
  aspectRatio: '16:9' | '9:16' | '1:1';
  durationSeconds: number | null;
  audio: boolean;
  resolution: string;
  strictSafety: boolean;
  /** Sent only where the endpoint has a seed field. */
  seed?: number | null;
  /** The scene's camera_movement value; sent only where the endpoint maps it to its own control. */
  cameraMovement?: string | null;
  /** The video template placed the picture tokens inline, so none are appended (§5.2). */
  tokensInline?: boolean;
}
