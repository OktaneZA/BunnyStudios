import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api';
import { ProblemBox } from '../components/ProblemBox';

export function NewProject() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [logline, setLogline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({ title, logline });
      // Straight into the new cartoon — the next thing to do is add a scene.
      navigate(`/projects/${project.id}`, { replace: true });
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <>


      <form className="card stack narrow" onSubmit={submit}>
        <h2>Start a new cartoon</h2>
        <ProblemBox error={error} />

        <div className="field">
          <label htmlFor="title">What's it called?</label>
          <p className="hint">You can change this later. Example: "Milo and the Parcel".</p>
          <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>

        <div className="field">
          <label htmlFor="logline">What happens, in one sentence?</label>
          <p className="hint">
            Example: "A boy refuses to hand back a parcel that was never his."
          </p>
          <textarea id="logline" value={logline} onChange={(e) => setLogline(e.target.value)} />
        </div>

        <div className="row">
          <button type="submit" disabled={busy || !title.trim()}>
            {busy ? 'Creating…' : 'Create cartoon'}
          </button>
          <Link className="btn secondary" to="/">
            Cancel
          </Link>
        </div>
      </form>
    </>
  );
}
