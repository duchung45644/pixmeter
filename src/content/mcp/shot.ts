/**
 * Screenshots for the agent (MCP get_screenshot, get_full_page_screenshot, compare_screenshot).
 * The whole tab, one element or one rectangle (with padding and zoom), the page's full height,
 * with or without the annotation overlay. Every image is kept small enough for one socket frame,
 * and remembered under a `captureId` so a later compare_screenshot can use it as the baseline.
 */
import { isFullyVisible } from '../../lib/capture/capture';
import {
  diffPixels,
  FRAME_DATA_BUDGET,
  outputSize,
  shotRegion,
  SHOT_MAX_SIDE,
  SHOT_MAX_SIDE_ZOOM,
  shrinkFor,
  type Box,
} from '../../lib/capture/shot';
import { sendToBackground } from '../../lib/ext/messaging';
import type { McpPayloads, ShotOptions } from '../../lib/mcp/protocol';
import { hideUi } from '../core/session';
import { state } from '../core/state.svelte';
import { fullPageCanvas } from '../tools/capture/fullpage';
import { innerScroller, stitchElement, stitchInner } from '../tools/capture/element';
import { frames, grabVisible, loadImg, withHiddenUi, withUiMode } from '../tools/capture/session';
import { setAnnotationsHidden } from './annotate';
import { elementOf, fail, type Commands } from './command';

const r2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------- captures kept for compare

interface Kept {
  dataUrl: string;
  width: number;
  height: number;
}
const KEEP = 6;
const kept = new Map<string, Kept>();
let counter = 0;

function remember(shot: Kept): string {
  const id = `shot-${++counter}`;
  kept.set(id, shot);
  if (kept.size > KEEP) kept.delete(kept.keys().next().value!);
  return id;
}

// ---------------------------------------------------------------- pixels

const newCanvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** `src` (a region of an image or canvas) drawn at its output size; zooms stay crisp, shrinks smooth. */
function resample(
  src: CanvasImageSource,
  crop: { sx: number; sy: number; sw: number; sh: number },
  scale: number,
  maxSide: number,
): { canvas: HTMLCanvasElement; limited: boolean } {
  const { width, height, limited } = outputSize(crop.sw, crop.sh, scale, maxSide);
  const c = newCanvas(width, height);
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = width / crop.sw <= 1;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  return { canvas: c, limited };
}

interface Encoded extends Kept {
  mimeType: string;
  /** Shrunk (or made a JPEG) to fit the socket frame. */
  reduced: boolean;
}

/** PNG if it fits one frame; else JPEG at the same size; else smaller and again. */
function encode(canvas: HTMLCanvasElement): Encoded {
  let cur = canvas;
  for (let i = 0; i < 8; i++) {
    const png = cur.toDataURL('image/png');
    if (png.length <= FRAME_DATA_BUDGET)
      return {
        dataUrl: png,
        width: cur.width,
        height: cur.height,
        mimeType: 'image/png',
        reduced: cur !== canvas,
      };
    const jpg = cur.toDataURL('image/jpeg', 0.9);
    if (jpg.length <= FRAME_DATA_BUDGET)
      return {
        dataUrl: jpg,
        width: cur.width,
        height: cur.height,
        mimeType: 'image/jpeg',
        reduced: true,
      };
    const k = shrinkFor(jpg.length, FRAME_DATA_BUDGET);
    cur = resample(cur, { sx: 0, sy: 0, sw: cur.width, sh: cur.height }, k, Infinity).canvas;
  }
  return fail('The image is too large to send; take a smaller region.');
}

// ---------------------------------------------------------------- capturing

/** One capture at a time, and none while the user's own capture is open. */
async function capturing<T>(annotations: boolean, fn: () => Promise<T>): Promise<T> {
  if (state.capturing) return fail('A Pixmeter capture is open on this tab; close it first.');
  state.capturing = true;
  setAnnotationsHidden(!annotations);
  try {
    return await withUiMode('dock', fn); // the inspect state stays in the shot; only the dock hides
  } finally {
    setAnnotationsHidden(false);
    state.capturing = false;
    hideUi(null);
  }
}

/** The visible tab as an image, with our UI hidden. k = image px per CSS px. */
const grabTab = () =>
  withHiddenUi(async () => {
    const img = await loadImg(await grabVisible());
    return { img, k: img.width / innerWidth };
  });

const boxOf = (r: DOMRect): Box => ({ x: r.left, y: r.top, width: r.width, height: r.height });

interface Shot {
  canvas: HTMLCanvasElement;
  info: Record<string, unknown>;
}

/** The picture asked for by `o`: the tab, a rect, or an element (stitched when it is taller than the screen). */
async function shootTarget(o: ShotOptions): Promise<Shot> {
  const scale = o.scale ?? 1;
  const padding = o.padding ?? 0;
  const info: Record<string, unknown> = { scale };
  let target: Box | null = o.rect ?? null;
  const x0 = scrollX;
  const y0 = scrollY;
  try {
    if (o.elementId) {
      if (state.responsiveOn)
        fail('In responsive mode pass rect (viewport px) instead of elementId.');
      const el = elementOf(o.elementId);
      if (!isFullyVisible(el.getBoundingClientRect(), innerWidth, innerHeight)) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        await frames();
      }
      const box = boxOf(el.getBoundingClientRect());
      if (!box.width || !box.height) fail('The element has no size on the page (hidden?).');
      const inner = innerScroller(el);
      if (box.height > innerHeight || inner) {
        const stitched = await withHiddenUi(() =>
          box.height > innerHeight ? stitchElement(el) : stitchInner(el, inner!),
        );
        if (!stitched) fail('capture_failed');
        const full = { sx: 0, sy: 0, sw: stitched!.width, sh: stitched!.height };
        const { canvas, limited } = resample(
          stitched!,
          full,
          scale,
          o.scale ? SHOT_MAX_SIDE_ZOOM : SHOT_MAX_SIDE_ZOOM,
        );
        return {
          canvas,
          info: {
            ...info,
            stitched: true,
            element: { width: r2(box.width), height: r2(box.height) },
            ...(padding && {
              note: 'padding is not applied to elements that are stitched from several screens',
            }),
            ...(limited && { limited: true }),
          },
        };
      }
      target = box;
    }
    const { img, k } = await grabTab();
    if (!target) {
      const { canvas, limited } = resample(
        img,
        { sx: 0, sy: 0, sw: img.width, sh: img.height },
        scale,
        o.scale ? SHOT_MAX_SIDE_ZOOM : SHOT_MAX_SIDE,
      );
      return { canvas, info: { ...info, region: 'viewport', ...(limited && { limited: true }) } };
    }
    const region = shotRegion(target, padding, innerWidth, innerHeight);
    if (!region)
      return fail(
        'The area is outside the visible part of the page. Call scroll_into_view first, or pass a rect inside the viewport.',
      );
    const crop = {
      sx: Math.round(region.x * k),
      sy: Math.round(region.y * k),
      sw: Math.max(1, Math.round(region.width * k)),
      sh: Math.max(1, Math.round(region.height * k)),
    };
    const { canvas, limited } = resample(img, crop, scale, SHOT_MAX_SIDE_ZOOM);
    return {
      canvas,
      info: {
        ...info,
        region: {
          x: r2(region.x),
          y: r2(region.y),
          width: r2(region.width),
          height: r2(region.height),
        },
        regionUnit: 'CSS px (viewport coordinates)',
        ...(region.clipped && {
          clipped: true,
          note: 'Part of the area is off screen and was cut.',
        }),
        ...(limited && { limited: true }),
      },
    };
  } finally {
    if (scrollX !== x0 || scrollY !== y0) scrollTo({ left: x0, top: y0, behavior: 'instant' });
  }
}

async function shootFullPage(): Promise<Shot> {
  const { canvas, via, note } = await fullPageCanvas();
  if (!canvas) return fail(`capture_failed${note ? `: ${note}` : ''}`);
  return {
    canvas,
    info: {
      region: 'full page',
      via,
      pageSize: { width: canvas.width, height: canvas.height, unit: 'image px' },
      ...(note && { note: `The fast route failed (${note}); the page was scrolled and stitched.` }),
    },
  };
}

function finish(shot: Shot) {
  const enc = encode(shot.canvas);
  const captureId = remember(enc);
  return {
    dataUrl: enc.dataUrl,
    width: enc.width,
    height: enc.height,
    mimeType: enc.mimeType,
    captureId,
    ...shot.info,
    ...(enc.reduced && { reduced: 'Shrunk or JPEG-compressed to fit the connection limit.' }),
  };
}

const hasOptions = (o: ShotOptions) =>
  !!(o.elementId || o.rect || o.padding !== undefined || o.scale !== undefined || o.annotations);

// ---------------------------------------------------------------- compare

/** RGBA of `src` drawn at w×h (stretched when the sizes differ). */
function pixelsOf(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = newCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(src, 0, 0, w, h);
  return g.getImageData(0, 0, w, h).data;
}

export async function compare(p: McpPayloads['compare_screenshot']) {
  const ref = p.referenceCaptureId
    ? kept.get(p.referenceCaptureId)
    : { dataUrl: p.referenceDataUrl! };
  if (!ref)
    return fail(
      `No capture with id ${p.referenceCaptureId} (only the last ${KEEP} are kept, and they are lost when the page reloads).`,
    );
  const shot = await capturing(!!p.annotations, () =>
    p.fullPage ? shootFullPage() : shootTarget(p),
  );
  const cur = shot.canvas;
  const refImg = await loadImg(ref.dataUrl).catch(() =>
    fail('The reference image could not be read.'),
  );
  const w = cur.width;
  const h = cur.height;
  const a = pixelsOf(refImg, w, h);
  const b = pixelsOf(cur, w, h);
  const d = diffPixels(a, b, w, h, p.threshold);
  const total = w * h;
  const percent = r2((d.differentPixels / total) * 100);
  const sameShape = Math.abs(refImg.width / refImg.height - w / h) <= 0.02 * (w / h);
  const out = {
    width: w,
    height: h,
    differentPixels: d.differentPixels,
    totalPixels: total,
    diffPercent: percent,
    match: percent <= p.tolerancePercent,
    threshold: p.threshold,
    tolerancePercent: p.tolerancePercent,
    differenceBounds: d.bounds,
    reference: { width: refImg.width, height: refImg.height },
    ...(refImg.width !== w || refImg.height !== h
      ? {
          resized: `The reference was resized to ${w}×${h} to match the capture.`,
          ...(!sameShape && {
            aspectMismatch: 'The aspect ratios differ, so the comparison is approximate.',
          }),
        }
      : {}),
    current: { captureId: remember(encode(cur)), ...shot.info },
    unit: 'image px of the capture',
  };
  if (!p.diffImage) return out;
  const g = newCanvas(w, h);
  g.getContext('2d')!.putImageData(
    new ImageData(d.image as Uint8ClampedArray<ArrayBuffer>, w, h),
    0,
    0,
  );
  const enc = encode(g);
  return { dataUrl: enc.dataUrl, mimeType: enc.mimeType, ...out };
}

// ---------------------------------------------------------------- commands

export const shotCommands: Commands = {
  async get_screenshot(p) {
    if (hasOptions(p)) return capturing(!!p.annotations, async () => finish(await shootTarget(p)));
    // plain: the tab as the background grabs it, shrunk to 2000 px
    setAnnotationsHidden(true);
    try {
      const r = await withUiMode('dock', () =>
        withHiddenUi(() => sendToBackground('capture_for_ai')),
      ).catch(() => null);
      if (!r) return fail('capture_failed');
      if (!r.ok) return fail(r.reason);
      const captureId = remember({ dataUrl: r.dataUrl, width: r.width, height: r.height });
      return {
        dataUrl: r.dataUrl,
        width: r.width,
        height: r.height,
        mimeType: 'image/png',
        captureId,
      };
    } finally {
      setAnnotationsHidden(false);
    }
  },
  get_full_page_screenshot: () => capturing(false, async () => finish(await shootFullPage())),
  compare_screenshot: compare,
};
