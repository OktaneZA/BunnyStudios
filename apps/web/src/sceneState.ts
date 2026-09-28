/**
 * One vocabulary for a scene's state, used by both Write (the scene list) and Make clips
 * (the film strip), so the same scene always reads the same way.
 */
export type SceneState = 'done' | 'making' | 'nothing' | 'needs-words';

export const SCENE_STATE_WORDS: Record<SceneState, string> = {
  done: 'In the cartoon',
  making: 'Making…',
  nothing: 'No clip yet',
  'needs-words': 'Needs a description',
};

export function sceneState(opts: { hasClip: boolean; making: boolean; hasDescription: boolean }): SceneState {
  if (opts.making) return 'making';
  if (opts.hasClip) return 'done';
  if (!opts.hasDescription) return 'needs-words';
  return 'nothing';
}

/** Where a scene's own page was opened from, so its back link returns there. */
export function sceneLink(projectId: string, sceneId: string, from?: 'make'): string {
  return `/projects/${projectId}/scenes/${sceneId}${from === 'make' ? '?from=make' : ''}`;
}
