import { useEffect, useState, type FormEvent } from 'react';
import { api, auth, type Account } from '../api';
import { ProblemBox } from '../components/ProblemBox';
import { BunnyLogo } from '../components/BunnyLogo';

/** Where deploy/release.mjs places the Android build; served by the API as a static file. */
const APK_PATH = '/downloads/bunny-studios.apk';

export function Login({ onSignedIn }: { onSignedIn: (a: Account) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [apkAvailable, setApkAvailable] = useState(false);

  // The running version, so a screenshot of a problem says which build it came from; and
  // whether this server offers the tablet app for download (only the NAS build ships it).
  useEffect(() => {
    let alive = true;
    fetch('/health').then((r) => r.json()).then((h: { version?: string }) => {
      if (alive && h.version) setVersion(h.version);
    }).catch(() => { /* purely informational */ });
    fetch(APK_PATH, { method: 'HEAD' }).then((r) => {
      if (alive) setApkAvailable(r.ok && (r.headers.get('content-type') ?? '').includes('android'));
    }).catch(() => { /* no download, no link */ });
    return () => { alive = false; };
  }, []);

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
        {version && <p className="hint version-tag">v{version}</p>}
        {apkAvailable && (
          <p className="hint version-tag">
            <a href={APK_PATH} download="bunny-studios.apk">Get the tablet app</a>
          </p>
        )}
      </form>
    </div>
  );
}
