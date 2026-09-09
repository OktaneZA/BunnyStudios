import { useState, type FormEvent } from 'react';
import { api, auth, type Account } from '../api';
import { ProblemBox } from '../components/ProblemBox';
import { BunnyLogo } from '../components/BunnyLogo';

export function Login({ onSignedIn }: { onSignedIn: (a: Account) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, account } = await api.login(email, password);
      auth.set(token);
      onSignedIn(account);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell">
      <form className="login card stack" onSubmit={submit}>
        <div>
          <h1 className="wordmark"><BunnyLogo />Bunny Studio Storyboards</h1>
          <p className="lede">Plan a cartoon, shot by shot.</p>
        </div>

        <ProblemBox error={error} />

        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        <button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
