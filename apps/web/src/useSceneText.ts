import { useEffect, useRef, useState } from 'react';
import { api, ApiProblem, type Scene } from './api';

type Text = Pick<Scene, 'title' | 'description' | 'camera_angle' | 'time_of_day' | 'mood_atmosphere'>;
const fields = ['title', 'description', 'camera_angle', 'time_of_day', 'mood_atmosphere'] as const;
const pick = (s: Text): Text => ({ title: s.title, description: s.description, camera_angle: s.camera_angle, time_of_day: s.time_of_day, mood_atmosphere: s.mood_atmosphere });
const same = (a: Text, b: Text) => fields.every((field) => a[field] === b[field]);

/** Serial autosaves. Keep a local draft across scene switches and failed requests. */
export function useSceneText(scene: Scene, onSaved: (scene: Scene) => Promise<void>) {
  const key = `scene-text:${scene.id}`;
  const [restored] = useState(() => {
    try {
      const draft = JSON.parse(sessionStorage.getItem(key) ?? 'null');
      if (draft && typeof draft.title === 'string' && typeof draft.description === 'string') return { ...pick(scene), ...draft } as Text & { version: number };
    } catch { /* Storage may be unavailable. */ }
    return null;
  });
  const initialConflict = Boolean(restored && restored.version !== scene.version && !same(restored, scene));
  const committed = useRef(scene);
  const [text, setText] = useState<Text>(restored ?? pick(scene));
  const live = useRef(text);
  const saving = useRef<Promise<void> | null>(null);
  const halted = useRef(initialConflict);
  const mounted = useRef(true);
  const notify = useRef(onSaved); notify.current = onSaved;
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<unknown>(initialConflict ? new ApiProblem({ status: 409, type: 'about:blank', title: 'Choose which scene to keep', detail: 'This scene changed while your draft was waiting. Your words are still here.' }) : null);
  const [conflict, setConflict] = useState(initialConflict);
  const [saved, setSaved] = useState(false);
  const dirty = !same(text, scene);

  function backup() {
    try { sessionStorage.setItem(key, JSON.stringify({ ...live.current, version: committed.current.version })); } catch { /* Best effort. */ }
  }
  useEffect(() => {
    if (scene.version < committed.current.version) return;
    const wasClean = same(live.current, committed.current);
    committed.current = scene;
    if (wasClean) { live.current = pick(scene); setText(live.current); }
  }, [scene]);

  function edit<K extends keyof Text>(field: K, value: Text[K]) {
    live.current = { ...live.current, [field]: value };
    setText(live.current); setSaved(false); backup();
  }

  function flush(): Promise<void> {
    if (saving.current) return saving.current;
    if (halted.current || !live.current.title.trim()) return Promise.resolve();
    const operation = async () => {
      if (mounted.current) setWorking(true);
      try {
        while (!same(live.current, committed.current)) {
          const sent = pick(live.current);
          if (!sent.title.trim()) break;
          const updated = await api.updateScene(scene.id, sent, committed.current.version);
          committed.current = updated; backup();
          await notify.current(updated);
          if (same(live.current, sent)) {
            try { sessionStorage.removeItem(key); } catch { /* Best effort. */ }
            if (mounted.current) setSaved(true);
          }
        }
        if (mounted.current) setError(null);
      } catch (err) {
        halted.current = true;
        if (mounted.current) { setError(err); setConflict(err instanceof ApiProblem && err.problem.status === 409); }
      } finally {
        saving.current = null;
        if (mounted.current) setWorking(false);
      }
    };
    saving.current = Promise.resolve().then(operation);
    return saving.current;
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    if (!dirty || error) return;
    const timer = setTimeout(() => void flushRef.current(), 650);
    return () => clearTimeout(timer);
  }, [text, dirty, error]);
  useEffect(() => {
    mounted.current = true;
    const warn = (event: BeforeUnloadEvent) => {
      if (!same(live.current, committed.current) || saving.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warn);
    return () => { mounted.current = false; window.removeEventListener('beforeunload', warn); void flushRef.current(); };
  }, []);

  async function retry(keepMine = true) {
    try {
      if (conflict) {
        const latest = await api.getScene(scene.id);
        committed.current = latest;
        if (!keepMine) {
          live.current = pick(latest); setText(live.current);
          try { sessionStorage.removeItem(key); } catch { /* Best effort. */ }
        }
        await notify.current(latest);
      } else await notify.current(committed.current);
      halted.current = false; setError(null); setConflict(false);
      await flush();
    } catch (err) { setError(err); }
  }
  /** Save now, and refuse to continue unless the words on screen are the saved words. */
  async function settle() {
    await flush();
    if (halted.current || !same(live.current, committed.current)) {
      throw new ApiProblem({ status: 409, type: 'about:blank', title: 'Save your scene first', detail: 'Your words are not saved yet. Fix the save problem above, then try again. Your text is still here.' });
    }
  }
  return { text, edit, flush, settle, retry, conflict, error, pending: dirty || working || Boolean(error),
    status: error ? 'Not saved — your text is kept here.' : !text.title.trim() ? 'Give this scene a name.' : dirty || working ? 'Saving…' : saved ? 'Saved' : '' };
}
