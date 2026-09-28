import { useEffect, useId, useState } from 'react';
import { api, type Project, type Scene } from '../api';
import { director, formatPence, type AccountBudget, type Asset, type GenerationSettings } from '../director-api';
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

  async function saveBudget(account: AccountBudget, field: 'daily_budget_pence' | 'monthly_budget_pence', pounds: string) {
    const value = Math.round(Number.parseFloat(pounds.replace(/[£,\s]/g, '')) * 100);
    if (!Number.isFinite(value) || value < 0 || value === account.allowance[field]) return;
    setSaving(account.id + field); setError(null);
    try {
      const updated = await director.setBudget(account.id, { [field]: value });
      setAccounts((prev) => prev?.map((a) => (a.id === updated.id ? updated : a)) ?? null);
    } catch (err) { setError(err); }
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
              <BudgetRow label="Each day" used={`Used today: ${formatPence(a.allowance.spent_today_pence)}`} value={a.allowance.daily_budget_pence}
                saving={saving === a.id + 'daily_budget_pence'} onSave={(v) => void saveBudget(a, 'daily_budget_pence', v)} />
              <BudgetRow label="Each month" used={`Used this month: ${formatPence(a.allowance.spent_this_month_pence)}`} value={a.allowance.monthly_budget_pence}
                saving={saving === a.id + 'monthly_budget_pence'} onSave={(v) => void saveBudget(a, 'monthly_budget_pence', v)} />
              <p className="hint">
                {a.is_minor ? `${a.display_name} sees this as "about 12 pictures left today" and cannot change it.` : 'Your own allowance.'}{' '}
                Resets at {new Date(a.allowance.resets_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.
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
