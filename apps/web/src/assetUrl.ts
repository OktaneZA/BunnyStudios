import { useEffect, useState } from 'react';
import { auth } from './api';

/**
 * `/api/v1/assets/:id/file` needs the bearer token, and a plain <img src> cannot send
 * headers. Files are fetched once, turned into object URLs and cached for the session.
 *
 * Object URLs are kept for the life of the page rather than revoked per component: the
 * same take appears in the takes strip, the step-2 card, the cartoon strip and the cast
 * pile at once, and revoking on one unmount would blank the others. Assets are immutable
 * (a new take is a new id), so the cache never goes stale.
 */
const cache = new Map<string, Promise<string>>();

async function load(url: string): Promise<string> {
  const headers = new Headers();
  const token = auth.token;
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Could not load ${url}: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function assetObjectUrl(url: string): Promise<string> {
  let pending = cache.get(url);
  if (!pending) {
    pending = load(url).catch((err: unknown) => {
      // A failed fetch must not poison the cache; the next mount retries.
      cache.delete(url);
      throw err;
    });
    cache.set(url, pending);
  }
  return pending;
}

/** Resolves an authenticated asset URL to an object URL: null while loading or on failure. */
export function useAssetUrl(url: string | null | undefined): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) { setObjectUrl(null); return; }
    let alive = true;
    setObjectUrl(null);
    assetObjectUrl(url).then((value) => { if (alive) setObjectUrl(value); }).catch(() => { if (alive) setObjectUrl(null); });
    return () => { alive = false; };
  }, [url]);
  return objectUrl;
}
