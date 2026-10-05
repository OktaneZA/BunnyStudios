import { useEffect, useId, useState } from 'react';
import { api, type Project, type Scene } from '../api';
import { director, formatPence, type AccountBudget, type Asset, type GenerationSettings, type TopUp } from '../director-api';
import { ProblemBox } from '../components/ProblemBox';
import { AssetImage } from '../components/AssetMedia';
import { ClipLog } from '../components/ClipLog';

/**
 * Grown-ups (plan §6): adult-only. Budgets per account, which picture makers are on, and
 * the held-back takes with the checker's reasons. The route is only mounted for the adult
 * and the API 404s the teen, so there is nothing to hide here beyond the link.
 */
export function Grownups() {
  const [accounts, setAccounts] = useState<AccountBudget[] | null>(null);
  const [settings, setSettings] = useState<GenerationSettings | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState<string>('');
  const [held, setHeld] = useState<Asset[] | null>(null);
  const [labels, setLabels] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<unknown>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    director.accounts().then((r) => setAccounts(r.data)).catch(setError);
    director.settings().then(setSettings).catch(setError);
    api.listProjects().then((r) => { setProjects(r.data); if (r.data[0]) setProjectId(r.data[0].id); }).catch(setError);
  }, []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    setHeld(null);
    (async () => {
      try {
        const [list, scenes, cast] = await Promise.all([director.heldBack(projectId), api.listScenes(projectId), director.cast(projectId)]);
        if (!alive) return;
        // Held-back rows name a shot or a character; turn those ids into words.
        const map = new Map<string, string>();
        for (const c of cast.data) map.set(c.id, c.name);
        await Promise.all(scenes.data.map(async (s: Scene) => {
          const shots = await director.shots(s.id).catch(() => ({ data: [] }));
          for (const shot of shots.data) map.set(shot.id, `Scene ${s.scene_number}, ${s.title}`);
        }));
        if (!alive) return;
        setLabels(map);
        setHeld(list.data);
      } catch (err) { if (alive) setError(err); }
    })();
    return () => { alive = false; };
  }, [projectId]);

  async function saveBudget(account: AccountBudget, pounds: string) {
    const value = Math.round(Number.parseFloat(pounds.replace(/[£,\s]/g, '')) * 100);
    if (!Number.isFinite(value) || value < 0 || value === account.allowance.daily_budget_pence) return;
    setSaving(account.id + 'daily'); setError(null);
    try {
      const updated = await director.setBudget(account.id, { daily_budget_pence: value });
      setAccounts((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? null);
    } catch (err) { setError(err); }
    finally { setSaving(null); }
  }

  /** Pre-paid: money goes into the pot once, and every picture or clip takes from it. */
  async function addMoney(account: AccountBudget, pounds: string, note: string) {
    const value = Math.round(Number.parseFloat(pounds.replace(/[£,\s]/g, '')) * 100);
    if (!Number.isFinite(value) || value <= 0) { setError(new Error('Enter an amount to add, in pounds.')); return false; }
    setSaving(account.id + 'pot'); setError(null);
    try {
      const added = await director.addTopUp(account.id, { pence: value, note });
      setAccounts((prev) => prev?.map((a) => (a.id === account.id ? { ...a, allowance: added.allowance } : a)) ?? null);
      return true;
    } catch (err) { setError(err); return false; }
    finally { setSaving(null); }
  }

  return (
    <>
      <header className="project-head">
        <h2>Grown-ups</h2>
        <p className="lede">Picture money, which picture makers are on, and anything the safety checker held back.</p>
      </header>
      <ProblemBox error={error} />

      <div className="grownups-grid">
        <div className="stack">
          {accounts?.map((a) => (
            <section key={a.id} className="card stack" aria-labelledby={`budget-${a.id}`}>
              <h3 id={`budget-${a.id}`}>{a.display_name}'s picture money</h3>
              <PotRow account={a} saving={saving === a.id + 'pot'} onAdd={(pounds, note) => addMoney(a, pounds, note)} />
              <BudgetRow label="Each day, at most" used={`Used today: ${formatPence(a.allowance.spent_today_pence)}`} value={a.allowance.daily_budget_pence}
                saving={saving === a.id + 'daily'} onSave={(v) => void saveBudget(a, v)} />
              <p className="hint">
                {a.is_minor ? `${a.display_name} sees "£ in your pot" and "left today", and cannot change either.` : 'Your own pot and daily limit.'}{' '}
                The daily limit resets at {new Date(a.allowance.resets_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}; the pot only grows when you add to it.
              </p>
            </section>
          ))}
          {accounts === null && !error && <p className="muted">Loading…</p>}

          <section className="card stack">
            <h3>Picture makers</h3>
            {settings?.message && <p className="hint">{settings.message}</p>}
            {settings && settings.models.length === 0 && <p className="muted">None are on. Add a provider key to the API environment (FAL_KEY) and restart.</p>}
            <ul className="maker-list">
              {settings?.models.map((m) => (
                <li key={m.id}>
                  <span className={`state-dot on`} aria-hidden="true" />
                  <span className="maker-name">{m.friendly_label}</span>
                  <span className="muted">{m.label ?? m.id}{m.provider ? ` (${m.provider})` : ''}</span>
                  <span className="muted">{formatPence(m.unit_cost_pence)} {m.unit === 'image' ? 'a picture' : 'a second'} · on</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="stack">
          {accounts && accounts.length > 0 && <ClipLog accounts={accounts} />}
          <section className="card stack">
            <h3>Held back</h3>
            <p className="hint">Pictures the checker didn't allow. The child never sees these.</p>
            <label htmlFor="held-project">Cartoon</label>
            <select id="held-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
            {projects.length === 0 && <p className="muted">No cartoons yet.</p>}
            {held && held.length === 0 && <p className="muted">Nothing has been held back for this cartoon.</p>}
            <ul className="held-list">
              {held?.map((a) => (
                <li key={a.id}>
                  <AssetImage url={a.mime_type.startsWith('video/') ? a.poster_url : a.url} alt="Held-back picture" className="held-thumb" />
                  <div>
                    <b>{(a.owner_entity_id && labels.get(a.owner_entity_id)) ?? (a.owner_entity_type === 'character' ? 'A cast picture' : 'A take')}</b>
                    <br /><span className="muted">Reason: {a.review_reason ?? 'not given'}. Not charged.</span>
                    <br /><span className="muted">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}

/** The pre-paid pot: what is left, a way to add more, and what was added before. */
function PotRow({ account, saving, onAdd }: { account: AccountBudget; saving: boolean; onAdd: (pounds: string, note: string) => Promise<boolean> }) {
  const id = useId();
  const [pounds, setPounds] = useState('');
  const [note, setNote] = useState('');
  const [history, setHistory] = useState<TopUp[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  useEffect(() => {
    if (!showHistory) return;
    let on = true;
    director.topUps(account.id).then((r) => { if (on) setHistory(r.data); }).catch(() => { if (on) setHistory([]); });
    return () => { on = false; };
  }, [showHistory, account.id, account.allowance.topped_up_pence]);
  return (
    <div className="pot-row stack">
      <div className="budget-row">
        <span className="label-text">In the pot</span>
        <b className="pot-amount">{formatPence(account.allowance.pot_pence)}</b>
        <span className="muted">Added {formatPence(account.allowance.topped_up_pence)} in all · spent {formatPence(account.allowance.spent_all_time_pence)}</span>
      </div>
      <form className="row" onSubmit={(e) => { e.preventDefault(); void onAdd(pounds, note).then((ok) => { if (ok) { setPounds(''); setNote(''); } }); }}>
        <label htmlFor={`${id}-amount`}>Add money</label>
        <input id={`${id}-amount`} inputMode="decimal" placeholder="£10" value={pounds} onChange={(e) => setPounds(e.target.value)} aria-label={`Add to ${account.display_name}'s pot, in pounds`} />
        <input placeholder="Note (optional)" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note for this top-up" />
        <button type="submit" disabled={saving}>Add to the pot</button>
      </form>
      <button type="button" className="link-button" aria-expanded={showHistory} onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Hide what was added' : 'See what was added'}</button>
      {showHistory && (
        <ul className="topup-list">
          {history === null && <li className="muted">Loading…</li>}
          {history?.length === 0 && <li className="muted">Nothing added yet.</li>}
          {history?.map((t) => <li key={t.id}><b>{formatPence(t.pence)}</b> · {new Date(t.created_at).toLocaleDateString()}{t.added_by ? ` · ${t.added_by}` : ''}{t.note ? ` · ${t.note}` : ''}</li>)}
        </ul>
      )}
    </div>
  );
}

function BudgetRow({ label, used, value, saving, onSave }: { label: string; used: string; value: number; saving: boolean; onSave: (v: string) => void }) {
  const [text, setText] = useState((value / 100).toFixed(2));
  useEffect(() => { setText((value / 100).toFixed(2)); }, [value]);
  const id = useId();
  return (
    <div className="budget-row">
      <label htmlFor={id}>{label}</label>
      <span className="money-input"><span aria-hidden="true">£</span>
        <input id={id} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} onBlur={() => onSave(text)} aria-label={`${label} budget in pounds`} />
      </span>
      <span className="hint">{saving ? 'Saving…' : used}</span>
    </div>
  );
}
