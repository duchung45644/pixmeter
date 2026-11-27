/** Geometry and pixel maths of the agent's screenshots (MCP get_screenshot, compare_screenshot). */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Longest side of a shot sent to an agent; a zoomed or cropped shot may go further. */
export const SHOT_MAX_SIDE = 2000;
export const SHOT_MAX_SIDE_ZOOM = 4000;
/**
 * Characters of a `data:` URL that still fit one socket frame (MAX_FRAME_BYTES is 1 MiB, and the
 * frame also carries the JSON around it).
 */
export const FRAME_DATA_BUDGET = 900_000;

/**
 * The part of the viewport to grab: `box` grown by `padding`, cut to the viewport. `clipped` says
 * the wanted area reached outside the screen; null when none of it is on screen.
 */
export function shotRegion(
  box: Box,
  padding: number,
  vw: number,
  vh: number,
): { x: number; y: number; width: number; height: number; clipped: boolean } | null {
  const left = box.x - padding;
  const top = box.y - padding;
  const right = box.x + box.width + padding;
  const bottom = box.y + box.height + padding;
  const x = Math.max(0, left);
  const y = Math.max(0, top);
  const width = Math.min(vw, right) - x;
  const height = Math.min(vh, bottom) - y;
  if (!(width > 0) || !(height > 0)) return null;
  const clipped = x > left || y > top || x + width < right || y + height < bottom;
  return { x, y, width, height, clipped };
}

/** Output size of a crop zoomed by `scale`, shrunk (aspect kept) to fit `maxSide`. */
export function outputSize(
  w: number,
  h: number,
  scale: number,
  maxSide: number,
): { width: number; height: number; limited: boolean } {
  const k = Math.min(1, maxSide / Math.max(w * scale, h * scale, 1));
  return {
    width: Math.max(1, Math.round(w * scale * k)),
    height: Math.max(1, Math.round(h * scale * k)),
    limited: k < 1,
  };
}

/** Next size to try when an encoded image is over budget: area follows the size ratio. */
export function shrinkFor(size: number, budget: number): number {
  return Math.min(0.9, Math.sqrt(budget / size) * 0.9);
}

export interface DiffResult {
  differentPixels: number;
  /** Smallest box holding every different pixel, in output px; null when identical. */
  bounds: Box | null;
  /** RGBA of the diff picture: the current image faded, differences in red. */
  image: Uint8ClampedArray;
}

/**
 * Pixel by pixel: a pixel differs when any colour channel (alpha blended over white first) moves
 * by more than `threshold` × 255.
 */
export function diffPixels(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  width: number,
  height: number,
  threshold: number,
): DiffResult {
  const limit = threshold * 255;
  const image = new Uint8ClampedArray(width * height * 4);
  const over = (c: number, alpha: number) => 255 + ((c - 255) * alpha) / 255;
  let count = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let i = 0, p = 0; p < width * height; p++, i += 4) {
    const aa = a[i + 3]!;
    const ba = b[i + 3]!;
    let delta = 0;
    for (let c = 0; c < 3; c++)
      delta = Math.max(delta, Math.abs(over(a[i + c]!, aa) - over(b[i + c]!, ba)));
    if (delta > limit) {
      count++;
      const x = p % width;
      const y = (p - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      image[i] = 255;
      image[i + 1] = 0;
      image[i + 2] = 0;
      image[i + 3] = 255;
    } else {
      // faded copy of the current picture, so the red reads against what it is on
      for (let c = 0; c < 3; c++) image[i + c] = 255 - (255 - over(b[i + c]!, ba)) * 0.25;
      image[i + 3] = 255;
    }
  }
  return {
    differentPixels: count,
    bounds: count ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 } : null,
    image,
  };
}
