import { useEffect, useState } from 'react';
import { api, type Project } from '../api';
import { director, type Asset, type CartoonStyle, type Character } from '../director-api';
import { ART_STYLE } from '@storyboard/vocabularies';
import { AssetImage } from './AssetMedia';
import { ProblemBox } from './ProblemBox';

/** The looks Simple mode offers; the words come from the vocabulary, never from here (CV-1). */
const COVER_STYLES = ['2d_flat_vector', '3d_pixar_style', 'anime_ghibli_soft', 'watercolour_storybook', 'claymation_look'] as const;
const LOOK_WORDS: Record<Character['look_status'], string> = { approved: 'Look chosen', changed: 'Look changed', none: 'Needs a look' };

/**
 * The cover (SB-07–SB-10): title, a short summary, who is in the cartoon, and the cartoon's
 * look and setting. Folds to one line once the child starts editing pages, so the editor is
 * never pushed down by it.
 */
export function StoryCover({ project, characters, style, open, onToggle, onProject, onStyle, onCharacter, onAddCharacter, busyScene }: {
  project: Project; characters: Character[]; style: CartoonStyle | null; open: boolean; onToggle: (open: boolean) => void;
  onProject: (p: Project) => void; onStyle: (s: CartoonStyle) => Promise<void>; onCharacter: (id: string) => void; onAddCharacter: () => void;
  /** A clip is being made somewhere: the look and setting are kept still until it is done. */
  busyScene: boolean;
}) {
  const [title, setTitle] = useState(project.title);
  const [summary, setSummary] = useState(project.logline);
  const [setting, setSetting] = useState(style?.setting ?? '');
  const [changingStyle, setChangingStyle] = useState(false);
  const [choosingPicture, setChoosingPicture] = useState(false);
  const [pictures, setPictures] = useState<Asset[] | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { setTitle(project.title); setSummary(project.logline); }, [project.title, project.logline]);
  useEffect(() => { setSetting(style?.setting ?? ''); }, [style?.setting]);

  async function saveWords() {
    const patch: { title?: string; logline?: string } = {};
    if (title.trim() && title.trim() !== project.title) patch.title = title.trim();
    if (summary.trim() !== project.logline) patch.logline = summary.trim();
    if (!Object.keys(patch).length) { setTitle(project.title); return; }
    setNote('Saving…'); setError(null);
    try { onProject(await api.updateProject(project.id, patch)); setNote('Saved'); }
    catch (err) { setError(err); setNote(''); }
  }
  async function saveSetting() {
    if (!style || setting.trim() === style.setting) return;
    setNote('Saving…'); setError(null);
    try { await onStyle(await director.setCartoonSetting(project.id, setting.trim())); setNote('Saved for the whole cartoon'); }
    catch (err) { setError(err); setNote(''); }
  }
  async function chooseStyle(value: string) {
    setNote('Saving…'); setError(null);
    try { await onStyle(await director.setCartoonStyle(project.id, value)); setNote('Look saved for the whole cartoon'); setChangingStyle(false); }
    catch (err) { setError(err); setNote(''); }
  }
  /** The cartoon's finished pictures: scene pictures and character pictures, newest first. */
  async function openPictures() {
    setChoosingPicture(true); setError(null);
    if (pictures) return;
    try {
      const [scenes, people] = await Promise.all([director.media(project.id, { kind: 'generated_output' }), director.media(project.id, { kind: 'character_ref' })]);
      setPictures([...scenes.data, ...people.data].filter((a) => a.mime_type.startsWith('image/') && a.review_status !== 'rejected' && a.review_status !== 'pending'));
    } catch (err) { setError(err); setPictures([]); }
  }
  async function chooseStylePicture(assetId: string | null) {
    setNote('Saving…'); setError(null);
    try { await onStyle(await director.setStylePicture(project.id, assetId)); setNote(assetId ? 'Style picture saved for the whole cartoon' : 'Style picture removed'); setChoosingPicture(false); }
    catch (err) { setError(err); setNote(''); }
  }

  const styleName = ART_STYLE.find((s) => s.value === style?.art_style)?.friendlyLabel ?? '…';
  const needLooks = characters.filter((c) => c.look_status === 'none').length;

  if (!open) {
    return (
      <section className="cover cover-folded card" aria-label="Cover">
        <button type="button" className="cover-unfold" onClick={() => onToggle(true)} aria-expanded="false">
          <span className="cover-pile" aria-hidden="true">{characters.slice(0, 4).map((c) => c.main_reference ? <AssetImage key={c.id} url={c.main_reference.url} alt="" className="cast-face" /> : <span key={c.id} className="cast-face none" />)}</span>
          <span><b>Cover</b> · {characters.length ? `${characters.length} ${characters.length === 1 ? 'character' : 'characters'}${needLooks ? `, ${needLooks} ${needLooks === 1 ? 'needs' : 'need'} a look` : ''}` : 'no characters yet'} · {styleName}{style?.setting ? ` · ${style.setting}` : ''}</span>
          <span className="muted">Open</span>
        </button>
      </section>
    );
  }

  return (
    <section className="cover card stack" aria-label="Cover">
      <ProblemBox error={error} />
      <div className="cover-head">
        <label className="sr-only" htmlFor="cover-title">Cartoon name</label>
        <input id="cover-title" className="cover-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onBlur={() => void saveWords()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        <button type="button" className="link-button" onClick={() => onToggle(false)} aria-expanded="true">Fold the cover</button>
      </div>
      <label className="sr-only" htmlFor="cover-summary">What is your cartoon about?</label>
      <textarea id="cover-summary" className="cover-summary" rows={2} maxLength={500} placeholder="What is your cartoon about? (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} onBlur={() => void saveWords()} />

      <div className="cover-row">
        <span className="label-text">Who is in it</span>
        <div className="cover-people">
          {characters.map((c) => (
            <button key={c.id} type="button" className={`cover-person look-${c.look_status}`} onClick={() => onCharacter(c.id)} aria-label={`${c.name}: ${LOOK_WORDS[c.look_status]}. Open ${c.name}’s sheet`}>
              {c.main_reference && c.look_status !== 'none' ? <AssetImage url={c.main_reference.url} alt="" className="cover-face" /> : <span className="cover-face none" aria-hidden="true">{c.name.slice(0, 1)}</span>}
              <span className="cover-person-name">{c.name}</span>
              <span className={`look-badge look-${c.look_status}`}>{LOOK_WORDS[c.look_status]}</span>
            </button>
          ))}
          <button type="button" className="secondary" onClick={onAddCharacter}>+ Add a character</button>
        </div>
      </div>

      <div className="cover-row">
        <span className="label-text">Cartoon look</span>
        <span>{styleName}</span>
        <button type="button" className="secondary" aria-expanded={changingStyle} disabled={busyScene} onClick={() => setChangingStyle((v) => !v)}>Change</button>
        <span className="save-state" aria-live="polite">{note}</span>
      </div>
      {changingStyle && (
        <div className="clip-styles" role="group" aria-label="Look for the whole cartoon">
          {COVER_STYLES.map((value) => {
            const option = ART_STYLE.find((s) => s.value === value)!;
            return <button key={value} type="button" className={`style-card style-${value}`} aria-pressed={style?.art_style === value} disabled={busyScene} onClick={() => void chooseStyle(value)}>
              <span className="style-swatch" aria-hidden="true">●</span><span>{option.friendlyLabel}</span>
            </button>;
          })}
          <p className="hint">Every new clip in this cartoon uses this look. Clips already made do not change, and character pictures do not change by themselves: make new ones from a character’s sheet if they look different.</p>
        </div>
      )}
      <div className="cover-row">
        <span className="label-text" id="style-picture-label">Style picture</span>
        {style?.style_picture
          ? <AssetImage url={style.style_picture.url} alt="The cartoon’s style picture" className="style-picture-thumb" />
          : <span className="muted">{style?.style_picture_unusable ? 'The chosen picture can’t be used any more. Choose another.' : 'None yet (optional)'}</span>}
        <button type="button" className="secondary" aria-expanded={choosingPicture} aria-describedby="style-picture-label" disabled={!style || busyScene} onClick={() => (choosingPicture ? setChoosingPicture(false) : void openPictures())}>{style?.style_picture ? 'Change' : 'Choose'}</button>
        {style?.style_picture && <button type="button" className="link-button" disabled={busyScene} onClick={() => void chooseStylePicture(null)}>Remove</button>}
      </div>
      {choosingPicture && (
        <div className="style-pictures" role="group" aria-label="Pictures for the cartoon’s style">
          <p className="hint">Pick one finished picture that shows the look you want. Clip makers that use pictures get it as a guide for the colours and lines, after everyone’s own pictures. Clips already made do not change.</p>
          {pictures === null ? <p className="muted">Finding your pictures…</p> : pictures.length === 0 ? <p className="muted">No finished pictures yet. Make a picture on a page or a character first.</p> : (
            <div className="style-picture-grid">
              {pictures.map((a) => (
                <button key={a.id} type="button" className="style-picture-choice" aria-pressed={style?.style_picture?.id === a.id} disabled={busyScene} onClick={() => void chooseStylePicture(a.id)} aria-label={a.kind === 'character_ref' ? 'A character picture' : 'A scene picture'}>
                  <AssetImage url={a.url} alt="" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="cover-row">
        <label className="label-text" htmlFor="cover-setting">Where</label>
        <input id="cover-setting" className="setting-input" maxLength={300} placeholder="Where does your cartoon happen? e.g. a sunny beach by the sea" value={setting} disabled={!style || busyScene}
          onChange={(e) => setSetting(e.target.value)} onBlur={() => void saveSetting()} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </div>
    </section>
  );
}
