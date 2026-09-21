import { useAssetUrl } from '../assetUrl';
import type { Asset } from '../director-api';

interface ImageProps {
  /** An authenticated asset URL (`/api/v1/assets/:id/file`). */
  url: string | null | undefined;
  alt: string;
  className?: string;
  placeholder?: string;
}

/** An image behind the bearer token. Shows a quiet placeholder until the file arrives. */
export function AssetImage({ url, alt, className, placeholder = '' }: ImageProps) {
  const src = useAssetUrl(url);
  if (!url || !src) {
    return <span className={`asset-placeholder${className ? ` ${className}` : ''}`} aria-label={alt} role="img">{placeholder}</span>;
  }
  return <img className={className} src={src} alt={alt} />;
}

/** A take's still: the picture itself, or a video's poster with a play badge. */
export function TakeImage({ asset, alt, className }: { asset: Asset; alt: string; className?: string }) {
  const isVideo = asset.mime_type.startsWith('video/');
  return (
    <span className={`take-still${className ? ` ${className}` : ''}`}>
      <AssetImage url={isVideo ? asset.poster_url : asset.url} alt={alt} placeholder={isVideo ? 'clip' : ''} />
      {isVideo && <span className="play-badge" aria-hidden="true"><PlayIcon /></span>}
    </span>
  );
}

export function AssetVideo({ url, poster, className }: { url: string | null | undefined; poster?: string | null; className?: string }) {
  const src = useAssetUrl(url);
  const posterSrc = useAssetUrl(poster ?? null);
  if (!url) return null;
  if (!src) return <div className={`asset-placeholder video${className ? ` ${className}` : ''}`}>Loading your clip…</div>;
  return <video className={className} src={src} poster={posterSrc ?? undefined} controls playsInline preload="metadata" />;
}

export function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M5 3 L17 10 L5 17 Z" fill="currentColor" />
    </svg>
  );
}
