/**
 * Upload validation (NF-19): magic bytes decide the type, never the filename or the
 * declared content type, and EXIF is stripped from JPEGs and PNGs before storage.
 */
import { ApiError } from '../errors.ts';

export type UploadClass = 'image' | 'audio';

export interface SniffedFile {
  mimeType: string;
  extension: string;
}

const LIMITS: Record<UploadClass, number> = { image: 10 * 1024 * 1024, audio: 20 * 1024 * 1024 };

export function sniff(bytes: Buffer): SniffedFile | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mimeType: 'image/png', extension: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: 'image/jpeg', extension: 'jpg' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return { mimeType: 'image/webp', extension: 'webp' };
  if (bytes.length >= 3 && bytes.subarray(0, 3).toString('ascii') === 'ID3') return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0) return { mimeType: 'audio/mpeg', extension: 'mp3' };
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') return { mimeType: 'audio/wav', extension: 'wav' };
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = bytes.subarray(8, 12).toString('ascii');
    if (brand.startsWith('M4A') || brand === 'mp42' || brand === 'isom' || brand === 'M4B ') return { mimeType: 'audio/mp4', extension: 'm4a' };
  }
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('ascii') === 'OggS') return { mimeType: 'audio/ogg', extension: 'ogg' };
  if (bytes.length >= 4 && bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mimeType: 'audio/webm', extension: 'webm' };
  return null;
}

export function validateUpload(bytes: Buffer, expected: UploadClass): SniffedFile & { bytes: Buffer } {
  if (bytes.length > LIMITS[expected]) throw ApiError.validation(expected === 'image' ? 'That picture is too big. Keep it under 10 MB.' : 'That sound file is too big. Keep it under 20 MB.');
  const kind = sniff(bytes);
  const ok = kind && (expected === 'image' ? kind.mimeType.startsWith('image/') : kind.mimeType.startsWith('audio/'));
  if (!kind || !ok) throw ApiError.validation(expected === 'image' ? 'Use a JPEG, PNG or WEBP picture.' : 'Use an MP3, M4A, WAV, OGG or WEBM sound file.');
  const cleaned = kind.mimeType === 'image/jpeg' ? stripJpegMetadata(bytes) : kind.mimeType === 'image/png' ? stripPngMetadata(bytes) : bytes;
  return { ...kind, bytes: cleaned };
}

/** Drop APP1..APP15 and COM segments (EXIF, XMP, comments); keep APP0 (JFIF) and the image data. */
export function stripJpegMetadata(bytes: Buffer): Buffer {
  const out: Buffer[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1]!;
    if (marker === 0xda) { out.push(bytes.subarray(i)); return Buffer.concat(out); } // start of scan: the rest is image data
    const length = bytes.readUInt16BE(i + 2);
    const segment = bytes.subarray(i, i + 2 + length);
    const isMetadata = (marker >= 0xe1 && marker <= 0xef) || marker === 0xfe;
    if (!isMetadata) out.push(segment);
    i += 2 + length;
  }
  out.push(bytes.subarray(i));
  return Buffer.concat(out);
}

/** Drop ancillary text/metadata chunks; keep everything the image needs. */
export function stripPngMetadata(bytes: Buffer): Buffer {
  const drop = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);
  const out: Buffer[] = [bytes.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(i);
    const type = bytes.subarray(i + 4, i + 8).toString('ascii');
    const chunk = bytes.subarray(i, i + 12 + length);
    if (!drop.has(type)) out.push(chunk);
    i += 12 + length;
    if (type === 'IEND') break;
  }
  return Buffer.concat(out);
}
