import { elementCaptureRect, isFullyVisible } from '../../../lib/capture/capture';
import type { Edges } from '../../../lib/responsive/capture-rect';
import { sendToBackground } from '../../../lib/ext/messaging';
import { hideUi } from '../../core/session';
import { state } from '../../core/state.svelte';
import { frameSelectionRect } from '../../responsive/shell.svelte';
import { openCaptureEditor } from './editor';
import { hideFixed } from './fullpage';
import { flash, frames, grabVisible, loadImg, settle, sleep } from './session';

/** Hide our UI, grab the tab cropped to `rect()` (viewport CSS px) and open the editor. */
async function grabRect(rect: () => Edges | null, after: () => void = () => {}): Promise<void> {
  let opened = false;
  try {
    hideUi('all');
    await settle();
    const r0 = rect();
    if (!r0) return;
    const r = await sendToBackground(
      'capture_tab',
      elementCaptureRect([r0], innerWidth, innerHeight, devicePixelRatio || 1, 0),
    ).catch(() => null);
    if (!r?.success || !state.capturing) return;
    await openCaptureEditor(r.dataUrl, false, null, 32); // a bare element looks lost: framed by default
    opened = state.capturing;
    if (opened) flash();
  } finally {
    if (!opened) {
      hideUi(null);
      state.capturing = false;
      after();
    }
  }
}

/** Nearest ancestor that scrolls vertically; null = the window. */
function scrollParent(el: Element): HTMLElement | null {
  for (
    let p = el.parentElement;
    p && p !== document.body && p !== document.documentElement;
    p = p.parentElement
  ) {
    const o = getComputedStyle(p).overflowY;
    if ((o === 'auto' || o === 'scroll' || o === 'overlay') && p.scrollHeight > p.clientHeight)
      return p;
  }
  return null;
}

/** Canvas height limit in Chromium; taller elements are cut there. */
const MAX_CANVAS = 32000;

/**
 * Element taller than the screen: scroll it through the viewport (or its scroll container) and
 * stitch the visible slices. Fixed/sticky bars are hidden after the first slice so they do not repeat.
 */
export async function stitchElement(el: Element): Promise<HTMLCanvasElement | null> {
  const sc = scrollParent(el);
  const x0 = scrollX,
    y0 = scrollY,
    s0 = sc?.scrollTop ?? 0;
  const scrollBy = (dy: number) =>
    sc
      ? sc.scrollTo({ top: sc.scrollTop + dy, behavior: 'instant' })
      : scrollTo({ left: scrollX, top: scrollY + dy, behavior: 'instant' });
  let hidden: [HTMLElement, string, string][] = [];
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    // element top at the top of its viewport
    const clip0 = sc?.getBoundingClientRect();
    scrollBy(el.getBoundingClientRect().top - (clip0 ? clip0.top + sc!.clientTop : 0));
    let covered = 0; // CSS px of the element already drawn, from its top
    for (let i = 0; i < 60 && state.capturing; i++) {
      await frames();
      if (i) await sleep(550); // captureVisibleTab is rate limited (~2/s)
      const img = await loadImg(await grabVisible());
      const k = img.width / innerWidth;
      const r = el.getBoundingClientRect();
      const c = sc?.getBoundingClientRect();
      const top = Math.max(0, c ? c.top + sc!.clientTop : 0);
      const bottom = Math.min(
        innerHeight,
        c ? c.top + sc!.clientTop + sc!.clientHeight : innerHeight,
      );
      const left = Math.max(0, r.left, c?.left ?? 0);
      const right = Math.min(innerWidth, r.right, c?.right ?? innerWidth);
      const total = Math.min(r.height, MAX_CANVAS / k);
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = Math.round((right - left) * k);
        canvas.height = Math.round(total * k);
        ctx = canvas.getContext('2d')!;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      const from = Math.max(top, r.top + covered);
      const to = Math.min(bottom, r.bottom, r.top + total);
      if (to > from) {
        const sx = Math.round(left * k),
          sy = Math.round(from * k),
          sh = Math.round((to - from) * k);
        ctx!.drawImage(
          img,
          sx,
          sy,
          canvas.width,
          sh,
          0,
          Math.round((from - r.top) * k),
          canvas.width,
          sh,
        );
        covered = to - r.top;
      }
      if (i === 0) hidden = hideFixed();
      if (covered >= total - 0.5) break;
      const before = el.getBoundingClientRect().top;
      scrollBy(r.top + covered - top);
      if (el.getBoundingClientRect().top === before) break; // could not scroll further
    }
  } finally {
    hidden.forEach(([e, v, p]) => e.style.setProperty('visibility', v, p));
    if (sc) sc.scrollTop = s0;
    scrollTo({ left: x0, top: y0, behavior: 'instant' });
  }
  return canvas;
}

/** The descendant (or the element itself) that hides the most content in its own vertical scroll. */
export function innerScroller(el: Element): HTMLElement | null {
  let best: HTMLElement | null = null,
    most = 1;
  for (const n of [el, ...el.querySelectorAll('*')] as HTMLElement[]) {
    const hidden = n.scrollHeight - n.clientHeight;
    if (hidden <= most) continue;
    const o = getComputedStyle(n).overflowY;
    if (o === 'auto' || o === 'scroll' || o === 'overlay') {
      best = n;
      most = hidden;
    }
  }
  return best;
}

/** Hides sticky/fixed boxes inside `root`: a sticky table head would repeat in every slice. */
function hideStickyIn(root: HTMLElement): [HTMLElement, string, string][] {
  const hits = [...root.getElementsByTagName('*')].filter((n) => {
    const p = getComputedStyle(n).position;
    return p === 'sticky' || p === 'fixed';
  }) as HTMLElement[];
  return hits.map((n) => {
    const saved: [HTMLElement, string, string] = [
      n,
      n.style.getPropertyValue('visibility'),
      n.style.getPropertyPriority('visibility'),
    ];
    n.style.setProperty('visibility', 'hidden', 'important');
    return saved;
  });
}

/**
 * Element that fits the screen but scrolls inside (a list, a table body): the parts above and
 * below the scroller as they are, the scroller's whole content stitched in between.
 */
export async function stitchInner(el: Element, sc: HTMLElement): Promise<HTMLCanvasElement | null> {
  const s0 = sc.scrollTop;
  let hidden: [HTMLElement, string, string][] = [];
  try {
    sc.scrollTo({ top: 0, behavior: 'instant' });
    await frames();
    let img = await loadImg(await grabVisible());
    const k = img.width / innerWidth;
    const r = el.getBoundingClientRect();
    const c = sc.getBoundingClientRect();
    const cTop = c.top + sc.clientTop,
      ch = sc.clientHeight;
    const full = Math.min(sc.scrollHeight, MAX_CANVAS / k - r.height + ch);
    const left = Math.max(0, r.left),
      right = Math.min(innerWidth, r.right);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((right - left) * k);
    canvas.height = Math.round((r.height - ch + full) * k);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const sx = Math.round(left * k);
    const copy = (srcY: number, h: number, dstY: number) => {
      if (h > 0)
        ctx.drawImage(
          img,
          sx,
          Math.round(srcY * k),
          canvas.width,
          Math.round(h * k),
          0,
          Math.round(dstY * k),
          canvas.width,
          Math.round(h * k),
        );
    };
    copy(r.top, cTop + ch - r.top, 0); // above the scroller + its first screen
    let covered = ch;
    hidden = hideStickyIn(sc);
    for (let i = 0; i < 60 && covered < full && state.capturing; i++) {
      sc.scrollTo({ top: covered, behavior: 'instant' });
      await frames();
      await sleep(550); // captureVisibleTab is rate limited (~2/s)
      const at = sc.scrollTop; // clamped at the end
      img = await loadImg(await grabVisible());
      const skip = covered - at;
      const h = Math.min(ch - skip, full - covered);
      if (h <= 0) break;
      copy(cTop + skip, h, cTop - r.top + covered);
      covered += h;
    }
    copy(cTop + ch, r.bottom - cTop - ch, cTop - r.top + full); // below the scroller
    return canvas;
  } finally {
    hidden.forEach(([n, v, p]) => n.style.setProperty('visibility', v, p));
    sc.scrollTop = s0;
  }
}

/**
 * Selected-element capture, after saveScreenshot (legacy-src/content.js:46700). Unlike legacy
 * (+50px, highlight kept), the owner wants only the element: all our UI hidden, cropped to its box.
 */
export async function captureElement(el: Element): Promise<void> {
  state.capturing = true;
  if (el.getBoundingClientRect().height > innerHeight)
    return captureStitched(() => stitchElement(el));
  const inner = innerScroller(el);
  if (inner) {
    if (!isFullyVisible(el.getBoundingClientRect(), innerWidth, innerHeight))
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    return captureStitched(() => stitchInner(el, inner));
  }
  const x0 = scrollX,
    y0 = scrollY;
  if (!isFullyVisible(el.getBoundingClientRect(), innerWidth, innerHeight)) {
    try {
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
    } catch {
      el.scrollIntoView();
    }
  }
  await grabRect(
    () => el.getBoundingClientRect(),
    () => {
      if (scrollX !== x0 || scrollY !== y0) scrollTo({ left: x0, top: y0, behavior: 'instant' });
    },
  );
}

/** Responsive (Q6): the selected element lives in a frame; the parent grabs and crops to it. */
export async function captureFrameElement(): Promise<void> {
  state.capturing = true;
  const rect = await frameSelectionRect().catch(() => null);
  if (!state.capturing) return;
  await grabRect(() => rect);
}

async function captureStitched(stitch: () => Promise<HTMLCanvasElement | null>): Promise<void> {
  let opened = false;
  try {
    hideUi('all');
    await settle();
    const c = await stitch().catch(() => null);
    if (!c || !state.capturing) return;
    await openCaptureEditor(c, false, null, 32);
    opened = state.capturing;
    if (opened) flash();
  } finally {
    if (!opened) {
      hideUi(null);
      state.capturing = false;
    }
  }
}
