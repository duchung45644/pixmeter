/**
 * compare_screenshot's `referencePath`: a mockup file on this machine, read by the server and sent
 * to the extension as a data URL. Only real PNG / JPEG / WebP files are read (checked by their
 * first bytes, not the extension), and only as large as one socket frame allows, so a path can
 * never be used to move an arbitrary file.
 */
import { readFile, stat } from 'node:fs/promises';
import { LIMITS } from './protocol.gen.ts';

/** Raw bytes that fit LIMITS.referenceDataUrl once base64-encoded. */
export const MAX_REFERENCE_BYTES = Math.floor(((LIMITS.referenceDataUrl - 30) * 3) / 4);

export function imageMime(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length > 12 &&
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...b.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return null;
}

/** The file as a data URL, or an error message the agent can act on. */
export async function readReference(
  path: string,
): Promise<{ dataUrl: string } | { error: string }> {
  let size: number;
  try {
    const s = await stat(path);
    if (!s.isFile()) return { error: `referencePath is not a file: ${path}` };
    size = s.size;
  } catch {
    return { error: `Cannot read referencePath: ${path}` };
  }
  if (size > MAX_REFERENCE_BYTES)
    return {
      error:
        `The reference image is ${Math.round(size / 1024)} KB; the limit is ${Math.floor(MAX_REFERENCE_BYTES / 1024)} KB ` +
        '(it travels in one message to the browser). Export it smaller, or crop it to the area you compare.',
    };
  const bytes = await readFile(path);
  const mime = imageMime(bytes);
  if (!mime) return { error: 'referencePath must be a PNG, JPEG or WebP image.' };
  return { dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
}
