import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, type Account, type Project, type Scene } from '../api';
import { director, isActiveJob, type Asset, type CartoonStyle, type CastList, type GenerationSettings, type Job, type Shot, type ShotCast } from '../director-api';
import { useJobs } from '../useJobs';
import { ProblemBox } from '../components/ProblemBox';
import { SceneComposer } from '../components/SceneComposer';
import { StoryCover } from '../components/StoryCover';
import { StoryPage } from '../components/StoryPage';
import { CastSheet } from '../components/CastSheet';
import { CastBoard } from '../components/CastBoard';

/**
 * The Storybook (docs/storybook-rebuild-requirements.md): one document for a cartoon. A cover,
 * then one page per scene, each opening its editor in place. Characters are a sheet over the
 * document; Watch is its own view and comes back to the same page.
 */
export function Storybook({ account }: { account: Account }) {
  const { projectId } = useParams<{ projectId: string }>();
  const [search, setSearch] = useSearchParams();
  const [project, setProject] = useState<Project | null>(null);
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [shots, setShots] = useState<Map<string, Shot>>(new Map());
  const [casts, setCasts] = useState<Map<string, ShotCast>>(new Map());
  const [settings, setSettings] = useState<GenerationSettings | null>(null);
  const [cast, setCast] = useState<CastList | null>(null);
  const [style, setStyle] = useState<CartoonStyle | null>(null);
  const [media, setMedia] = useState<Asset[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [adding, setAdding] = useState(false);
  const [saveState, setSaveState] = useState('');
  const [coverOpen, setCoverOpen] = useState<boolean | null>(null);
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('director.theme') === 'white' ? 'white' : 'black'; } catch { return 'black'; }
  });
  useEffect(() => {
    document.documentElement.dataset.directorTheme = theme;
    try { localStorage.setItem('director.theme', theme); } catch { /* Private browsing. */ }
    return () => { delete document.documentElement.dataset.directorTheme; };
  }, [theme]);

  const advanced = (project?.editor_mode ?? account.default_editor_mode) === 'advanced';
  const sheet = search.get('sheet') === 'characters';
  const sheetCharacter = search.get('character');

  const refreshSettings = useCallback(() => director.settings().then(setSettings).catch(setError), []);
  const refreshCast = useCallback(async () => { if (projectId) setCast(await director.cast(projectId)); }, [projectId]);
  const refreshStyle = useCallback(async () => { if (projectId) setStyle(await director.cartoonStyle(projectId)); }, [projectId]);
  const refreshMedia = useCallback(async () => { if (projectId) setMedia((await director.media(projectId)).data); }, [projectId]);
  const refreshShot = useCallback(async (sceneId: string) => {
    const shot = (await director.shots(sceneId)).data[0];
    if (!shot) return;
    setShots((prev) => new Map(prev).set(sceneId, shot));
    const c = await director.shotCast(shot.id).catch(() => null);
    if (c) setCasts((prev) => new Map(prev).set(sceneId, c));
  }, []);
  /** Every page's shot and cast in one request (review 2 Oct, P2); a 30-page cartoon costs one round trip. */
  const loadShots = useCallback(async (_list: Scene[]) => {
    if (!projectId) return;
    const rows = (await director.projectShots(projectId)).data;
    setShots(new Map(rows.map((r) => [r.scene_id, r.shot])));
    setCasts(new Map(rows.map((r) => [r.scene_id, r.cast])));
  }, [projectId]);
  const reloadScenes = useCallback(async () => {
    if (!projectId) return [] as Scene[];
    const s = (await api.listScenes(projectId)).data;
    setScenes(s);
    return s;
  }, [projectId]);

  const onSettled = useCallback((job: Job) => {
    if (job.target_entity_type === 'shot') {
      const entry = [...shots.entries()].find(([, s]) => s.id === job.target_entity_id);
      if (entry) void refreshShot(entry[0]).catch(() => {});
    }
    if (job.target_entity_type === 'character') void refreshCast().catch(() => {});
    void refreshMedia().catch(() => {});
    void refreshSettings();
  }, [shots, refreshShot, refreshCast, refreshMedia, refreshSettings]);
  const { jobs, loaded: jobsLoaded, add: addJob } = useJobs(projectId, onSettled);

  useEffect(() => {
    if (!projectId) return;
    setError(null);
    Promise.all([api.getProject(projectId), api.listScenes(projectId)])
      .then(([p, s]) => { setProject(p); setScenes(s.data); void loadShots(s.data); })
      .catch(setError);
    void refreshSettings();
    refreshCast().catch(setError);
    refreshStyle().catch(setError);
    refreshMedia().catch(() => {});
  }, [projectId, refreshSettings, refreshCast, refreshStyle, refreshMedia, loadShots]);

  const selected = scenes?.find((s) => s.id === search.get('scene')) ?? null;
  // The cover starts open on an empty cartoon and folded once there is a page to work on.
  useEffect(() => { if (scenes && coverOpen === null) setCoverOpen(scenes.length === 0 || !search.get('scene')); }, [scenes, coverOpen, search]);
  const assetsById = useMemo(() => {
    const map = new Map<string, Asset>();
    for (const a of media) map.set(a.id, a);
    for (const j of jobs) for (const a of j.results) map.set(a.id, a);
    return map;
  }, [media, jobs]);

  /** Open a page; the index and the pages both use this, and the URL remembers it (SB-06). */
  const scrolled = useRef<string | null>(null);
  const select = useCallback((sceneId: string | null) => {
    setSearch((prev) => { const next = new URLSearchParams(prev); if (sceneId) next.set('scene', sceneId); else next.delete('scene'); return next; }, { replace: false });
    if (sceneId) setCoverOpen(false);
  }, [setSearch]);
  useEffect(() => {
    if (!selected || scrolled.current === selected.id) return;
    scrolled.current = selected.id;
    // Let the page open first, then bring its editor to the top so the words and the make button are in view (SB-12).
    requestAnimationFrame(() => document.getElementById(`page-${selected.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }, [selected]);

  const openSheet = useCallback((characterId?: string) => {
    setSearch((prev) => { const next = new URLSearchParams(prev); next.set('sheet', 'characters'); if (characterId) next.set('character', characterId); else next.delete('character'); return next; });
  }, [setSearch]);
  const closeSheet = useCallback(() => {
    setSearch((prev) => { const next = new URLSearchParams(prev); next.delete('sheet'); next.delete('character'); return next; });
    // Looks may have changed: pages show the new faces.
    if (scenes) void loadShots(scenes);
  }, [setSearch, scenes, loadShots]);

  async function addPage(afterIndex: number | null) {
    if (!project || !scenes) return;
    setAdding(true); setError(null);
    try {
      const created = await api.createScene(project.id, { title: `Scene ${scenes.length + 1}` });
      if (afterIndex !== null && afterIndex < scenes.length - 1) {
        const ids = scenes.map((s) => s.id); ids.splice(afterIndex + 1, 0, created.id);
        setScenes((await api.reorderScenes(project.id, ids)).data);
      } else {
        // A functional update: a page's autosave may have landed while the new page was being made (SB-15).
        setScenes((prev) => [...(prev ?? []), created]);
      }
      await refreshShot(created.id);
      select(created.id);
    } catch (err) { setError(err); }
    finally { setAdding(false); }
  }
  async function movePage(scene: Scene, direction: -1 | 1) {
    if (!project || !scenes) return;
    const from = scenes.findIndex((s) => s.id === scene.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= scenes.length) return;
    setAdding(true); setError(null);
    try {
      const ids = scenes.map((s) => s.id); ids.splice(from, 1); ids.splice(to, 0, scene.id);
      setScenes((await api.reorderScenes(project.id, ids)).data);
    } catch (err) { setError(err); }
    finally { setAdding(false); }
  }
  async function removePage(scene: Scene) {
    if (!confirm(`Move page ${scene.scene_number}, "${scene.title}", to the bin? You can put it back later from Manage scenes.`)) return;
    setError(null);
    try {
      await api.deleteScene(scene.id);
      const s = await reloadScenes();
      if (selected?.id === scene.id) { const next = s.find((x) => x.sort_order >= scene.sort_order) ?? s[s.length - 1]; select(next?.id ?? null); }
    } catch (err) { setError(err); }
  }

  if (error && !project) return <ProblemBox error={error} />;
  if (!project || !scenes) return <p className="muted">Loading…</p>;

  const anyMaking = jobs.some((j) => j.kind === 'video' && isActiveJob(j));
  const watchHref = `/projects/${project.id}/watch${selected ? `?scene=${selected.id}` : ''}`;

  return (
    <div className="storybook">
      {/* SB-04: one compact toolbar; preferences live in the menu. */}
      <header className="story-toolbar" aria-label="Cartoon toolbar">
        <Link to="/" className="toolbar-home">← My cartoons</Link>
        <h2 className="toolbar-title">{project.title}</h2>
        <span className="save-state toolbar-save" aria-live="polite">{saveState}</span>
        {settings?.test_mode && <span className="test-mode-pill" title="Pictures and clips are coloured placeholders, not AI-generated. Nothing is spent.">Test mode</span>}
        <Link className="btn watch-button" to={watchHref}>▶ Watch cartoon</Link>
        <details className="view-menu toolbar-menu">
          <summary role="button" aria-label="More" aria-haspopup="menu">⋯</summary>
          <div className="view-menu-body">
            <div className="segmented theme-picker" role="group" aria-label="Colour mode">
              <button type="button" className={theme === 'white' ? 'on' : ''} aria-pressed={theme === 'white'} onClick={() => setTheme('white')}>☀ White</button>
              <button type="button" className={theme === 'black' ? 'on' : ''} aria-pressed={theme === 'black'} onClick={() => setTheme('black')}>☾ Black</button>
            </div>
            <Link className="btn secondary" to={`/projects/${project.id}/scenes`}>Manage scenes and the bin</Link>
            {!account.is_minor && <Link className="btn secondary" to="/grownups">Grown-ups</Link>}
          </div>
        </details>
      </header>
      <ProblemBox error={error} />

      <div className="story-layout">
        <nav className="page-index" aria-label="Story pages">
          <p className="eyebrow">In this story</p>
          <ol>
            <li><button type="button" className={!selected && coverOpen ? 'on' : ''} onClick={() => { setCoverOpen(true); select(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>Cover</button></li>
            {scenes.map((s, i) => {
              const shot = shots.get(s.id);
              const hero = shot?.hero_video_asset_id ? assetsById.get(shot.hero_video_asset_id) : null;
              const making = jobs.some((j) => j.target_entity_id === shot?.id && j.kind === 'video' && isActiveJob(j));
              return <li key={s.id}><button type="button" className={selected?.id === s.id ? 'on' : ''} aria-current={selected?.id === s.id ? 'page' : undefined} onClick={() => select(s.id)}>
                <span className="index-n">{String(i + 1).padStart(2, '0')}</span><span className="index-title">{s.title}</span>
                <span className={`index-dot ${making ? 'state-making' : hero ? 'state-set' : shot?.hero_asset_id ? 'state-picture' : 'state-empty'}`} aria-hidden="true" />
              </button></li>;
            })}
            <li><button type="button" className="index-add" disabled={adding} onClick={() => void addPage(null)}>{adding ? 'Adding…' : '+ Add a page'}</button></li>
          </ol>
        </nav>

        <div className="story-pages">
          <StoryCover project={project} characters={cast?.data ?? []} style={style} open={coverOpen ?? true} onToggle={setCoverOpen}
            onProject={setProject} onStyle={async (s) => { setStyle(s); await reloadScenes().then(loadShots); }} onCharacter={(id) => openSheet(id)} onAddCharacter={() => openSheet()} busyScene={anyMaking} />

          {scenes.length === 0 && (
            <section className="card empty-story">
              <h3>Your first page</h3>
              <p>Write what happens first. You can add characters and pictures as you go.</p>
              <button type="button" disabled={adding} onClick={() => void addPage(null)}>{adding ? 'Adding…' : '+ Add your first page'}</button>
            </section>
          )}

          {scenes.map((scene, i) => {
            const shot = shots.get(scene.id);
            const hero = shot?.hero_video_asset_id ? assetsById.get(shot.hero_video_asset_id) ?? null : shot?.hero_asset_id ? assetsById.get(shot.hero_asset_id) ?? null : null;
            const videoJobs = jobs.filter((j) => j.target_entity_id === shot?.id && j.kind === 'video');
            const activeJob = videoJobs.find(isActiveJob);
            const failed = videoJobs[0]?.status === 'failed';
            const isSelected = selected?.id === scene.id;
            return (
              <StoryPage key={scene.id} scene={scene} index={i} count={scenes.length} shot={shot} hero={hero} activeJob={activeJob} failed={failed}
                cast={casts.get(scene.id) ?? null} selected={isSelected} adding={adding}
                onSelect={() => select(scene.id)} onMove={(d) => void movePage(scene, d)} onRemove={() => void removePage(scene)} onAddAfter={() => void addPage(i)}>
                {isSelected && (
                  <div inert={adding || undefined} aria-busy={adding}>
                    <SceneComposer key={scene.id} scene={scene} projectId={project.id} shot={shot} settings={settings}
                      jobs={jobs} jobsLoaded={jobsLoaded} assetsById={assetsById} advanced={advanced} movable={false} layoutReset={0}
                      castList={(cast?.data ?? []).map((c) => ({ id: c.id, name: c.name, lookId: c.look?.id ?? null }))}
                      addJob={addJob} onShot={(s) => { setShots((prev) => new Map(prev).set(scene.id, s)); void director.shotCast(s.id).then((c) => setCasts((prev) => new Map(prev).set(scene.id, c))).catch(() => {}); }}
                      onScene={(updated) => setScenes((prev) => prev?.map((s) => s.id === updated.id ? updated : s) ?? null)}
                      afterHero={() => { void refreshMedia().catch(() => {}); }} refreshSettings={refreshSettings} openStudio={(id) => openSheet(id)}
                      onDeleted={async () => { const s = await reloadScenes(); const next = s.find((x) => x.sort_order >= scene.sort_order) ?? s[s.length - 1]; select(next?.id ?? null); }}
                      onCartoonChanged={async () => { await refreshStyle(); await reloadScenes().then(loadShots); }}
                      onSaveState={setSaveState} />
                  </div>
                )}
              </StoryPage>
            );
          })}
        </div>
      </div>

      {sheet && (
        <CastSheet projectId={project.id} cast={cast} models={settings?.models ?? []} jobs={jobs} onJob={addJob} refreshCast={refreshCast}
          onClose={closeSheet} advanced={advanced} settingsMessage={settings?.message ?? null} testMode={settings?.test_mode}
          initialCharacterId={sheetCharacter} focusKey={sheetCharacter}
          returnToScene={selected ? selected.title : null}
          lead={<CastBoard projectId={project.id} characters={cast?.data ?? []} onPick={(id) => openSheet(id)} compact />} />
      )}
    </div>
  );
}
