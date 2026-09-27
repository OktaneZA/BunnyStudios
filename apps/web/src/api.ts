/**
 * Thin API client. Every error the server returns is RFC 7807 problem+json (§10),
 * so it is surfaced as a typed Problem rather than a bare string — the UI needs
 * `detail` and `field_errors` to say something useful to a young user.
 */
export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  field_errors?: Record<string, string[]>;
  /** A 409 carries the server's record; a 402 carries `resets_at`. */
  current_state?: unknown;
}

export class ApiProblem extends Error {
  problem: Problem;
  constructor(problem: Problem) {
    super(problem.detail);
    this.name = 'ApiProblem';
    this.problem = problem;
  }
}

const TOKEN_KEY = 'storyboard.token';

export const auth = {
  get token(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
    } catch {
      /* private mode — the session simply won't persist */
    }
  },
  clear() {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  },
};

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  // FormData sets its own multipart boundary; forcing a JSON type would break uploads.
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = auth.token;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`/api/v1${path}`, { ...init, headers });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const body: unknown = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const p = body as Partial<Problem> | null;
    throw new ApiProblem({
      type: p?.type ?? 'about:blank',
      title: p?.title ?? 'Something went wrong',
      status: res.status,
      detail: p?.detail ?? `The server returned ${res.status}.`,
      ...(p?.field_errors ? { field_errors: p.field_errors } : {}),
      ...(p?.current_state !== undefined ? { current_state: p.current_state } : {}),
    });
  }

  return body as T;
}

export interface Account {
  id: string;
  email: string;
  display_name: string;
  default_editor_mode: 'simple' | 'advanced';
  is_minor: boolean;
}

export interface Project {
  series_number: number | null;
  created_at: string;
  id: string;
  title: string;
  logline: string;
  editor_mode: 'simple' | 'advanced';
  status: string;
  updated_at: string;
  episode_count?: number;
  scene_count?: number;
  /** Set when the cartoon is in the bin. Never present in the normal list. */
  deleted_at?: string | null;
}

export interface Scene {
  art_style?: string | null;
  id: string;
  scene_number: number;
  sort_order: number;
  slugline: string;
  title: string;
  description: string;
  camera_angle: string | null;
  location_id: string | null;
  time_of_day: string;
  mood_atmosphere: string | null;
  emotional_beat: string;
  /** Never exported to prompts (§3.10). */
  director_notes: string;
  scene_intent: string;
  action_description: string;
  scenery_description: string;
  is_locked: boolean;
  version: number;
  updated_at: string;
  thumbnail: { src: string; description: string; stale: boolean } | null;
  thumbnail_preview?: { src: string; description: string } | null;
  /** Set when the scene is in the bin. Never present on the board. */
  deleted_at?: string | null;
}

export interface ThumbnailProposal {
  id: string;
  status: 'generating' | 'ready' | 'failed' | 'accepted' | 'cancelled' | 'expired' | 'rejected';
  preview: { src: string; description: string } | null;
  error: string | null;
  text?: string | null;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; account: Account }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<Account>('/me'),
  aiSettings: () => request<{ thumbnails_enabled: boolean; improve_enabled: boolean; daily_limit: number; message: string | null }>('/settings/ai'),
  improveScene: (sceneId: string, requestId: string) => request<ThumbnailProposal>(`/scenes/${sceneId}/description-proposals`, {
    method: 'POST', headers: { 'Idempotency-Key': requestId },
  }),
  latestImprovement: (sceneId: string) => request<{ proposal: ThumbnailProposal | null }>(`/scenes/${sceneId}/description-proposals`),
  improvement: (sceneId: string, proposalId: string) => request<ThumbnailProposal>(`/scenes/${sceneId}/description-proposals/${proposalId}`),
  resolveImprovement: (sceneId: string, proposalId: string, action: 'accept' | 'cancel') => request(`/scenes/${sceneId}/description-proposals/${proposalId}/${action}`, { method: 'POST' }),
  makeThumbnail: (sceneId: string, requestId: string) => request<ThumbnailProposal>(`/scenes/${sceneId}/thumbnail-proposals`, {
    method: 'POST', headers: { 'Idempotency-Key': requestId },
  }),
  thumbnailProposal: (sceneId: string, proposalId: string) => request<ThumbnailProposal>(`/scenes/${sceneId}/thumbnail-proposals/${proposalId}`),
  latestThumbnailProposal: (sceneId: string) => request<{ proposal: ThumbnailProposal | null }>(`/scenes/${sceneId}/thumbnail-proposals`),
  resolveThumbnail: (sceneId: string, proposalId: string, action: 'accept' | 'cancel') => request(`/scenes/${sceneId}/thumbnail-proposals/${proposalId}/${action}`, { method: 'POST' }),
  removeThumbnail: (sceneId: string, version: number) => request<void>(`/scenes/${sceneId}/thumbnail`, { method: 'DELETE', headers: { 'If-Match': String(version) } }),

  listProjects: async () => {
    const data: Project[] = [];
    let total = 0;
    for (let page = 1; ; page++) {
      const result = await request<{ data: Project[]; total: number }>(`/projects?per_page=100&page=${page}`);
      data.push(...result.data); total = result.total;
      if (data.length >= total || !result.data.length) break;
    }
    return { data, total };
  },
  reorderProjects: (project_ids: string[]) => request('/projects/reorder', { method: 'POST', body: JSON.stringify({ project_ids }) }),
  updateProject: (id: string, patch: { series_number?: number | null; status?: string }) => request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (body: { title: string; logline: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  /** Logical delete: the cartoon moves to the bin and can be put back. */
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
  listDeletedProjects: () => request<{ data: Project[]; total: number }>('/projects?deleted=true&per_page=100'),
  restoreProject: (id: string) => request<Project>(`/projects/${id}/restore`, { method: 'POST' }),

  getScene: (id: string) => request<Scene>(`/scenes/${id}`),
  listScenes: (projectId: string) =>
    request<{ data: Scene[] }>(`/projects/${projectId}/scenes`),
  createScene: (projectId: string, body: { title: string; scene_intent?: string }) =>
    request<Scene>(`/projects/${projectId}/scenes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateScene: (id: string, body: Partial<Scene>, version?: number) =>
    request<Scene>(`/scenes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      ...(version !== undefined ? { headers: { 'If-Match': String(version) } } : {}),
    }),
  /** Logical delete: the scene moves to the cartoon's bin and can be put back. */
  deleteScene: (id: string) => request<void>(`/scenes/${id}`, { method: 'DELETE' }),
  listDeletedScenes: (projectId: string) => request<{ data: Scene[] }>(`/projects/${projectId}/scenes?deleted=true`),
  restoreScene: (id: string) => request<Scene>(`/scenes/${id}/restore`, { method: 'POST' }),
  /** Sends the complete intended order, so the call is idempotent and safe to retry. */
  reorderScenes: (projectId: string, sceneIds: string[]) =>
    request<{ data: Scene[] }>(`/projects/${projectId}/scenes/reorder`, {
      method: 'POST',
      body: JSON.stringify({ scene_ids: sceneIds }),
    }),
};
export * from './director-api';
