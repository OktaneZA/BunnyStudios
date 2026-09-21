import { useEffect, useState } from 'react';
import { Routes, Route, Link, Navigate, useMatch } from 'react-router-dom';
import { BunnyLogo } from './components/BunnyLogo';
import { api, auth, type Account } from './api';
import { Login } from './screens/Login';
import { ProjectList } from './screens/ProjectList';
import { NewProject } from './screens/NewProject';
import { ProjectDetail } from './screens/ProjectDetail';
import { SceneDetail } from './screens/SceneDetail';
import { Director } from './screens/Director';
import { Together } from './screens/Together';
import { Grownups } from './screens/Grownups';

export default function App() {
  const sceneRoute = useMatch('/projects/:projectId/scenes/:sceneId');
  const togetherRoute = useMatch('/projects/:projectId/together');
  const directorRoute = useMatch('/projects/:projectId/director');
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
          {!account.is_minor && (
            <Link className="btn secondary" to="/grownups">
              Grown-ups
            </Link>
          )}
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
          {togetherRoute && <Link to={`/projects/${togetherRoute.params.projectId}/director`}>← Director</Link>}
          {!directorRoute && !togetherRoute && <Link to="/">← Back to Cartoons</Link>}
          {directorRoute && <Link to="/">← All cartoons</Link>}
        </nav>
        <Routes>
          <Route path="/" element={<ProjectList />} />
          <Route path="/projects/new" element={<NewProject />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route
            path="/projects/:projectId/scenes/:sceneId"
            element={<SceneDetail account={account} />}
          />
          <Route path="/projects/:projectId/director" element={<Director account={account} />} />
          <Route path="/projects/:projectId/together" element={<Together />} />
          {!account.is_minor && <Route path="/grownups" element={<Grownups />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
