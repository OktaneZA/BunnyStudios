/**
 * RFC 4122 v4 id for Idempotency-Key headers.
 *
 * `crypto.randomUUID()` exists only in secure contexts (https, localhost). The app is also
 * served over plain http on a LAN address (the Synology deployment), where calling it throws
 * and the AI buttons fail with a generic error. `getRandomValues` works everywhere.
 */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
