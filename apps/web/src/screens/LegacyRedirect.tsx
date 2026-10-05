import { Navigate, useParams, useSearchParams } from 'react-router-dom';

/** An old link (the cartoon, Characters, Put it together) opens the storybook with its ids intact (SB-06). */
export function LegacyRedirect({ to, sheet = false }: { to: 'director' | 'watch'; sheet?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const [search] = useSearchParams();
  const next = new URLSearchParams();
  if (search.get('scene')) next.set('scene', search.get('scene')!);
  if (sheet) { next.set('sheet', 'characters'); if (search.get('character')) next.set('character', search.get('character')!); }
  const query = next.toString();
  return <Navigate to={`/projects/${projectId}/${to}${query ? `?${query}` : ''}`} replace />;
}
