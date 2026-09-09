import type { Scene } from './api';
import { PROMPT_VOCABULARIES, type PromptVocabularyName } from '@storyboard/vocabularies';

function label(vocabulary: PromptVocabularyName, value: string | null) {
  return PROMPT_VOCABULARIES[vocabulary].find((option) => option.value === value)?.label ?? 'Not specified';
}

/** Plain text handoff uses current scene content, never unaccepted AI previews. */
export function sceneText(scene: Scene): string {
  return [
    `Scene ${scene.scene_number}: ${scene.title}`,
    scene.description,
    `Camera angle: ${label('camera_angle', scene.camera_angle ?? 'eye_level')}`,
    `Time of day: ${label('time_of_day', scene.time_of_day)}`,
    `Mood: ${label('mood_atmosphere', scene.mood_atmosphere)}`,
    scene.location_id ? `Location: ${scene.slugline}` : '',
    scene.director_notes ? `Notes to yourself:\n${scene.director_notes}` : '',
  ].filter(Boolean).join('\n\n');
}

export function storyText(title: string, logline: string, scenes: Scene[]): string {
  return [title, logline, ...[...scenes].sort((a, b) => a.scene_number - b.scene_number).map(sceneText)].filter(Boolean).join('\n\n---\n\n');
}
