export function sceneDescription(scene: {
  description: string | null;
  sceneIntent: string;
  actionDescription: string;
  sceneryDescription: string;
}): string {
  if (scene.description !== null) return scene.description;
  return [...new Set([scene.sceneIntent, scene.actionDescription, scene.sceneryDescription]
    .map((text) => text.trim()).filter(Boolean))].join('\n\n');
}
