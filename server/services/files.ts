import type { Queryable } from '../db';
import { badRequest } from '../lib/errors';
import { sha256 } from '../lib/security';

const MAX_LOGO_BYTES = 1_000_000;

/** Decodes a data URL uploaded by the client and verifies it is a PNG or JPEG by its magic bytes. */
export function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; mimeType: string } {
  const m = /^data:(image\/(?:png|jpeg|jpg));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!m) throw badRequest('Logo must be a PNG or JPEG image');
  const bytes = new Uint8Array(Buffer.from(m[2], 'base64'));
  if (bytes.length > MAX_LOGO_BYTES) throw badRequest('Logo must be smaller than 1 MB');
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!png && !jpeg) throw badRequest('Logo must be a PNG or JPEG image');
  return { bytes, mimeType: png ? 'image/png' : 'image/jpeg' };
}

/** Files are immutable: replacing a logo stores a new row so previously issued certificates keep theirs. */
export async function storeFile(
  q: Queryable,
  f: { dealerId: string | null; kind: string; mimeType: string; bytes: Uint8Array; userId: string | null },
): Promise<string> {
  const { rows } = await q.query<{ id: string }>(
    `INSERT INTO files (dealer_id, kind, mime_type, size_bytes, sha256, content, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [f.dealerId, f.kind, f.mimeType, f.bytes.length, sha256(f.bytes), Buffer.from(f.bytes), f.userId],
  );
  return rows[0].id;
}

export async function getFile(q: Queryable, id: string) {
  const { rows } = await q.query<{ id: string; kind: string; mime_type: string; content: Uint8Array; dealer_id: string | null }>(
    'SELECT id, kind, mime_type, content, dealer_id FROM files WHERE id = $1',
    [id],
  );
  const f = rows[0];
  return f ? { ...f, content: new Uint8Array(f.content) } : null;
}

export const fileUrl = (id: string | null | undefined) => (id ? `/api/files/${id}` : null);
