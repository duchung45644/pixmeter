import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { imageMime, MAX_REFERENCE_BYTES, readReference } from '../src/reference.ts';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const dir = () => mkdtemp(join(tmpdir(), 'pixmeter-ref-'));

it('recognises images by their first bytes', () => {
  expect(imageMime(PNG)).toBe('image/png');
  expect(imageMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]))).toBe('image/jpeg');
  expect(imageMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  expect(imageMime(Buffer.from('<html>not an image</html>'))).toBeNull();
});

it('reads a mockup as a data URL', async () => {
  const p = join(await dir(), 'mock.png');
  await writeFile(p, PNG);
  expect(await readReference(p)).toEqual({
    dataUrl: `data:image/png;base64,${PNG.toString('base64')}`,
  });
});

it('refuses non-images even with an image extension', async () => {
  const p = join(await dir(), 'secrets.png');
  await writeFile(p, 'API_KEY=hunter2');
  expect(await readReference(p)).toEqual({
    error: 'referencePath must be a PNG, JPEG or WebP image.',
  });
});

it('refuses missing paths, directories and oversized files', async () => {
  const d = await dir();
  expect(await readReference(join(d, 'nope.png'))).toMatchObject({
    error: expect.stringContaining('Cannot read'),
  });
  expect(await readReference(d)).toMatchObject({ error: expect.stringContaining('not a file') });
  const big = join(d, 'big.png');
  await writeFile(big, Buffer.concat([PNG, Buffer.alloc(MAX_REFERENCE_BYTES)]));
  expect(await readReference(big)).toMatchObject({ error: expect.stringContaining('KB') });
});
