/** Provider-neutral creative inputs. No endpoint IDs, fal field names or arbitrary options. */
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
}
