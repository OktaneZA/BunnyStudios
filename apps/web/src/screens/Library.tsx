import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Project } from '../api';
import { director, type LibraryCharacter } from '../director-api';
import { AssetImage } from '../components/AssetMedia';
import { ProblemBox } from '../components/ProblemBox';

const key = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * Your characters (docs/character-library-requirements.md, CL-02): every character with a
 * chosen look, from every cartoon, grouped by name. "Use in…" copies one into another cartoon.
 */
export function Library() {
  const [entries, setEntries] = useState<LibraryCharacter[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [using, setUsing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const [lib, list] = await Promise.all([director.library(), api.listProjects()]);
        setEntries(lib.data); setProjects(list.data);
      } catch (err) { setError(err); setEntries([]); }
    })();
  }, []);

  // One card per name, newest look first; the other cartoons with that name are listed on it.
  const groups = useMemo(() => {
    const out: { name: string; first: LibraryCharacter; all: LibraryCharacter[] }[] = [];
    for (const e of entries ?? []) {
      const g = out.find((x) => key(x.name) === key(e.name));
      if (g) g.all.push(e); else out.push({ name: e.name, first: e, all: [e] });
    }
    return out;
  }, [entries]);

  async function useIn(entry: LibraryCharacter, projectId: string) {
    setBusy(true); setError(null); setNote('');
    try {
      await director.addFromLibrary(projectId, entry.character_id);
      const title = projects.find((p) => p.id === projectId)?.title ?? 'that cartoon';
      setNote(`${entry.name} is now in ${title}, with the same look.`); setUsing(null);
    } catch (err) { setError(err); }
    finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="section-head">
        <h2>Your characters</h2>
        {entries && <span className="muted">{groups.length} {groups.length === 1 ? 'character' : 'characters'} with a chosen look</span>}
      </div>
      <p className="hint">Everyone you have chosen a look for, from every cartoon. Use them again in another cartoon and they keep the same look and pictures. Changing them in one cartoon never changes them in another.</p>
      <ProblemBox error={error} />
      {note && <p className="notice" role="status">{note}</p>}
      {entries === null ? <p className="muted">Finding your characters…</p> : groups.length === 0 ? (
        <div className="empty card">
          <h3>Nobody here yet</h3>
          <p>Make a character in a cartoon and choose their look. They will be here for your next story.</p>
          <Link className="btn" to="/">My cartoons</Link>
        </div>
      ) : (
        <div className="grid">
          {groups.map((g) => {
            const cartoons = [...new Set(g.all.map((e) => e.project_title))];
            const open = using === g.first.character_id;
            const targets = projects.filter((p) => !g.all.some((e) => e.project_id === p.id));
            return (
              <article key={g.first.character_id} className="card library-card">
                {g.first.main_picture ? <AssetImage url={g.first.main_picture.url} alt="" className="library-face" /> : <span className="library-face none" aria-hidden="true">{g.name.slice(0, 1)}</span>}
                <h3>{g.name}</h3>
                <p className="muted">In {cartoons.length === 1 ? cartoons[0] : `${cartoons.slice(0, -1).join(', ')} and ${cartoons.at(-1)}`}</p>
                <span className="pill look-approved">Look chosen{g.first.art_style ? ` · ${g.first.art_style_label}` : ''}</span>
                <button type="button" className="secondary" aria-expanded={open} disabled={busy || targets.length === 0} onClick={() => setUsing(open ? null : g.first.character_id)}>
                  {targets.length === 0 ? 'In every cartoon already' : 'Use in…'}
                </button>
                {open && (
                  <ul className="library-targets" aria-label={`Use ${g.name} in`}>
                    {targets.map((p) => <li key={p.id}><button type="button" className="link-button" disabled={busy} onClick={() => void useIn(g.first, p.id)}>{p.title}</button></li>)}
                  </ul>
                )}
                {g.all.length > 1 && <p className="hint">{g.all.length} versions: the newest look is used. Open a cartoon to pick a different one.</p>}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
