import { useCallback, useEffect, useState } from 'react';
import { api, type Scene } from '../api';
import { director, type Character, type Shot, type ShotCast } from '../director-api';
import { AssetImage } from './AssetMedia';
import { ProblemBox } from './ProblemBox';

/**
 * Who is in which scene, in one grid: characters down the side, scenes across the top.
 * Tapping a square puts someone in or takes them out of that scene; a scene the story only
 * proposed (not yet saved) shows its suggestion faintly until a tap saves it.
 */
export function CastBoard({ projectId, characters, onPick }: { projectId: string; characters: Character[]; onPick?: (characterId: string) => void }) {
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [shots, setShots] = useState<Map<string, Shot>>(new Map());
  const [casts, setCasts] = useState<Map<string, ShotCast>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loaded, setLoaded] = useState(false);

  const loadScene = useCallback(async (scene: Scene) => {
    const shot = (await director.shots(scene.id)).data[0];
    if (!shot) return;
    const cast = await director.shotCast(shot.id);
    setShots((prev) => new Map(prev).set(scene.id, shot));
    setCasts((prev) => new Map(prev).set(scene.id, cast));
  }, []);

  useEffect(() => {
    let on = true;
    (async () => {
      try {
        const s = (await api.listScenes(projectId)).data;
        if (!on) return;
        setScenes(s);
        await Promise.all(s.map(loadScene));
      } catch (err) { if (on) setError(err); }
      finally { if (on) setLoaded(true); }
    })();
    return () => { on = false; };
  }, [projectId, loadScene]);

  /** Put a character in, or take them out of, one scene; the rest of that scene's list stays as it is. */
  async function toggle(scene: Scene, character: Character) {
    const shot = shots.get(scene.id);
    const cast = casts.get(scene.id);
    if (!shot || !cast || busy) return;
    const inScene = cast.characters.some((c) => c.character_id === character.id);
    const next = inScene
      ? cast.characters.filter((c) => c.character_id !== character.id)
      : [...cast.characters, { character_id: character.id, look_id: null as string | null, outfit_label: null as string | null }];
    setBusy(`${scene.id}:${character.id}`); setError(null);
    try {
      await director.saveShotCast(shot.id, next.map((c) => ({ character_id: c.character_id, look: cast.saved && c.look_id ? c.look_id : 'current', outfit_label: c.outfit_label ?? null })), shot.version);
      await loadScene(scene);
    } catch (err) { setError(err); await loadScene(scene).catch(() => {}); }
    finally { setBusy(null); }
  }

  if (!loaded) return <p className="muted">Loading your scenes…</p>;
  if (scenes.length === 0) return <p className="hint">No scenes yet. Add scenes in Create, then choose who is in each one here.</p>;

  return (
    <div className="cast-board card">
      <ProblemBox error={error} />
      <div className="cast-board-grid" style={{ gridTemplateColumns: `minmax(180px, 240px) repeat(${scenes.length}, minmax(72px, 1fr))` }} role="table" aria-label="Who is in which scene">
        <div role="row" className="cast-board-row">
          <div role="columnheader" className="cast-board-corner" />
          {scenes.map((s) => <div key={s.id} role="columnheader" className="cast-board-head"><b>{s.scene_number}.</b> {s.title}</div>)}
        </div>
        {characters.map((c) => (
          <div key={c.id} role="row" className="cast-board-row">
            <div role="rowheader" className="cast-board-who">
              {c.main_reference ? <AssetImage url={c.main_reference.url} alt="" className="cast-face" /> : <span className="cast-face none" aria-hidden="true" />}
              <span className="cast-board-name">
                <strong>{c.name}</strong>
                <span className={`look-badge look-${c.look_status}`}>{c.look_status === 'approved' ? 'Look chosen' : c.look_status === 'changed' ? 'Look changed' : 'Needs a look'}</span>
                {onPick && <button type="button" className="link-button" onClick={() => onPick(c.id)}>{c.look_status === 'none' ? `Choose ${c.name}’s look` : `Change how ${c.name} looks`}</button>}
              </span>
            </div>
            {scenes.map((s) => {
              const cast = casts.get(s.id);
              const entry = cast?.characters.find((x) => x.character_id === c.id);
              const state = !entry ? 'out' : cast?.saved ? 'in' : 'maybe';
              const label = state === 'out' ? `${c.name} is not in scene ${s.scene_number}. Put them in.` : state === 'maybe' ? `The story suggests ${c.name} is in scene ${s.scene_number}. Tap to keep them in.` : `${c.name} is in scene ${s.scene_number}. Take them out.`;
              return (
                <button key={s.id} type="button" role="cell" className={`cast-cell ${state}`} aria-label={label} aria-pressed={state !== 'out'}
                  disabled={busy !== null || !shots.get(s.id)} onClick={() => void toggle(s, c)}>
                  {state === 'out' ? <span aria-hidden="true">+</span> : <span className="cast-tick" aria-hidden="true">✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <p className="hint">A faint tick is the story’s suggestion; tap it to keep them in. Looks are used automatically when a clip is made.</p>
    </div>
  );
}
