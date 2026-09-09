import { useEffect, useState } from 'react';
import { Routes, Route, Link, Navigate, useMatch } from 'react-router-dom';
import { BunnyLogo } from './components/BunnyLogo';
import { api, auth, type Account } from './api';
import { Login } from './screens/Login';
import { ProjectList } from './screens/ProjectList';
import { NewProject } from './screens/NewProject';
import { ProjectDetail } from './screens/ProjectDetail';
import { SceneDetail } from './screens/SceneDetail';

export default function App() {
  const sceneRoute = useMatch('/projects/:projectId/scenes/:sceneId');
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth.token) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then(setAccount)
      .catch(() => auth.clear())
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="shell muted">Loading…</div>;
  if (!account) return <Login onSignedIn={setAccount} />;

  function signOut() {
    auth.clear();
    setAccount(null);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <Link to="/" className="wordmark">
            <BunnyLogo />
            Bunny Studio Storyboards
          </Link>
          <p className="who">
            Signed in as <strong>{account.display_name}</strong>{' '}
            <span className="badge">
              {account.default_editor_mode === 'simple' ? 'Simple mode' : 'Advanced mode'}
            </span>
          </p>
        </div>

        <nav className="menu">
          <Link className="btn" to="/projects/new">
            + New cartoon
          </Link>
          <button className="secondary" onClick={signOut}>
            Sign out
          </button>
        </nav>
      </header>

      <main>
        <nav className="crumbs" aria-label="Back navigation">
          {sceneRoute && <Link to={`/projects/${sceneRoute.params.projectId}`}>← Back to scenes</Link>}
          <Link to="/">← Back to Cartoons</Link>
        </nav>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route
            path="/projects/:projectId/scenes/:sceneId"
            element={<SceneDetail account={account} />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
