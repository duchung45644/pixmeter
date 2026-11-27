/**
 * The annotation overlay for the agent (MCP draw_annotations, clear_annotations): measuring
 * arrows, element frames and labels drawn over the page. It lives in its own shadow host, so the
 * page's DOM and styles are untouched, and it never takes a pointer event. Shapes tied to an
 * element follow it when the page scrolls or resizes.
 */
import type { McpAnnotation, McpPoint } from '../../lib/mcp/protocol';
import { ownNodes } from '../core/events';
import { onStop } from '../core/session';
import { elementOf, fail, type Commands } from './command';
import { distanceBetween } from './measure';

const NS = 'http://www.w3.org/2000/svg';
const FONT = '11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const COLORS = { box: '#ff3b30', distance: '#0a84ff', arrow: '#ff9f0a', label: '#ff3b30' } as const;

export type Shape =
  | {
      kind: 'rect';
      x: number;
      y: number;
      w: number;
      h: number;
      color: string;
      dashed?: boolean;
      fill?: boolean;
    }
  | {
      kind: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      color: string;
      ends: 'end' | 'both' | 'none';
    }
  | { kind: 'text'; x: number; y: number; text: string; color: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const tag = (label: string | undefined, text: string) => (label ? `${label}: ${text}` : text);

/** What a shape list needs from the page: the box of an element id (throws when it is gone). */
export type BoxOf = (id: string) => DOMRect;

/** The shapes of one annotation, in viewport CSS px. */
export function shapesFor(a: McpAnnotation, boxOf: BoxOf, parentBoxOf: BoxOf): Shape[] {
  switch (a.type) {
    case 'box': {
      const r = a.elementId ? boxOf(a.elementId) : undefined;
      const {
        x,
        y,
        width: w,
        height: h,
      } = r ? { x: r.left, y: r.top, width: r.width, height: r.height } : a.rect!;
      const color = a.color ?? COLORS.box;
      const out: Shape[] = [{ kind: 'rect', x, y, w, h, color, fill: true }];
      if (a.label) out.push({ kind: 'text', x, y, text: a.label, color });
      return out;
    }
    case 'label': {
      const at =
        a.at ??
        (() => {
          const r = boxOf(a.elementId!);
          return { x: r.left, y: r.top };
        })();
      return [{ kind: 'text', x: at.x, y: at.y, text: a.text, color: a.color ?? COLORS.label }];
    }
    case 'arrow': {
      const color = a.color ?? COLORS.arrow;
      const out: Shape[] = [
        { kind: 'line', x1: a.from.x, y1: a.from.y, x2: a.to.x, y2: a.to.y, color, ends: 'end' },
      ];
      if (a.label)
        out.push({
          kind: 'text',
          x: (a.from.x + a.to.x) / 2,
          y: (a.from.y + a.to.y) / 2,
          text: a.label,
          color,
        });
      return out;
    }
    case 'distance': {
      const color = a.color ?? COLORS.distance;
      if (!a.elementId) return pointDistance(a.from!, a.to!, a.label, color);
      const ra = boxOf(a.elementId);
      const rb = a.toElementId ? boxOf(a.toElementId) : parentBoxOf(a.elementId);
      return elementDistance(ra, rb, a.label, color);
    }
  }
}

function pointDistance(
  from: McpPoint,
  to: McpPoint,
  label: string | undefined,
  color: string,
): Shape[] {
  const len = r2(Math.hypot(to.x - from.x, to.y - from.y));
  return [
    { kind: 'line', x1: from.x, y1: from.y, x2: to.x, y2: to.y, color, ends: 'both' },
    {
      kind: 'text',
      x: (from.x + to.x) / 2,
      y: (from.y + to.y) / 2,
      text: tag(label, `${len}px`),
      color,
    },
  ];
}

/** The gap lines Pixmeter's Distance tool draws between two boxes, with their sizes. */
function elementDistance(
  a: DOMRect,
  b: DOMRect,
  label: string | undefined,
  color: string,
): Shape[] {
  const out: Shape[] = [
    { kind: 'rect', x: a.left, y: a.top, w: a.width, h: a.height, color, dashed: true },
    { kind: 'rect', x: b.left, y: b.top, w: b.width, h: b.height, color, dashed: true },
  ];
  let tagged = false; // the caller's label goes on the first measured line only
  const line = (x1: number, y1: number, x2: number, y2: number, n: number) => {
    if (n <= 0) return;
    out.push({ kind: 'line', x1, y1, x2, y2, color, ends: 'both' });
    const text = tag(tagged ? undefined : label, `${r2(n)}px`);
    tagged = true;
    out.push({ kind: 'text', x: (x1 + x2) / 2, y: (y1 + y2) / 2, text, color });
  };
  const d = distanceBetween(a, b);
  if (d.relation === 'inside' || d.relation === 'contains') {
    const [inner, outer] = d.relation === 'inside' ? [a, b] : [b, a];
    const cx = inner.left + inner.width / 2;
    const cy = inner.top + inner.height / 2;
    line(cx, outer.top, cx, inner.top, d.insets.top);
    line(inner.right, cy, outer.right, cy, d.insets.right);
    line(cx, inner.bottom, cx, outer.bottom, d.insets.bottom);
    line(outer.left, cy, inner.left, cy, d.insets.left);
    return out;
  }
  if (d.relation === 'overlapping') return out;
  const mid = (lo: number, hi: number) => (lo + hi) / 2;
  const below = b.top >= a.bottom;
  const leftOf = a.right <= b.left;
  const yOverlap = [Math.max(a.top, b.top), Math.min(a.bottom, b.bottom)] as const;
  const xOverlap = [Math.max(a.left, b.left), Math.min(a.right, b.right)] as const;
  if (d.gap.horizontal) {
    const y = yOverlap[1] > yOverlap[0] ? mid(...yOverlap) : below ? a.bottom : a.top;
    line(leftOf ? a.right : b.right, y, leftOf ? b.left : a.left, y, d.gap.horizontal);
  }
  if (d.gap.vertical) {
    const x = xOverlap[1] > xOverlap[0] ? mid(...xOverlap) : leftOf ? b.left : b.right;
    line(x, below ? a.bottom : b.bottom, x, below ? b.top : a.top, d.gap.vertical);
  }
  return out;
}

// ---------------------------------------------------------------- rendering

let host: HTMLElement | null = null;
let svg: SVGSVGElement | null = null;
let current: McpAnnotation[] = [];
let frame = 0;
let hidden = false;

const el = <K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>,
) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
};

function arrowHead(x: number, y: number, ang: number, color: string): SVGElement {
  const s = 6;
  const p = (a: number) => `${x - s * Math.cos(ang + a)},${y - s * Math.sin(ang + a)}`;
  return el('polygon', { points: `${x},${y} ${p(0.45)} ${p(-0.45)}`, fill: color });
}

function draw(s: Shape, into: SVGElement): void {
  if (s.kind === 'rect') {
    into.append(
      el('rect', {
        x: s.x,
        y: s.y,
        width: s.w,
        height: s.h,
        fill: s.fill ? s.color : 'none',
        'fill-opacity': 0.12,
        stroke: s.color,
        'stroke-width': 1.5,
        ...(s.dashed ? { 'stroke-dasharray': '4 3' } : {}),
      }),
    );
  } else if (s.kind === 'line') {
    const ang = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    into.append(
      el('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke: s.color, 'stroke-width': 1.5 }),
    );
    if (s.ends !== 'none') into.append(arrowHead(s.x2, s.y2, ang, s.color));
    if (s.ends === 'both') into.append(arrowHead(s.x1, s.y1, ang + Math.PI, s.color));
  } else {
    const w = Math.round(s.text.length * 6.6 + 10);
    const x = Math.max(0, Math.min(s.x, innerWidth - w));
    const y = s.y < 16 ? s.y + 2 : s.y - 16;
    into.append(el('rect', { x, y, width: w, height: 14, rx: 3, fill: s.color }));
    const t = el('text', { x: x + 5, y: y + 10.5, fill: '#fff', style: `font:${FONT}` });
    t.textContent = s.text;
    into.append(t);
  }
}

const boxOf: BoxOf = (id) => elementOf(id).getBoundingClientRect();
const parentBoxOf: BoxOf = (id) => {
  const p = elementOf(id).parentElement;
  return p ? p.getBoundingClientRect() : fail('The element has no parent; pass toElementId.');
};

/** Redraw every annotation from the elements' current boxes; a vanished element is skipped. */
function render(): void {
  if (!svg) return;
  const g = el('g', {});
  for (const a of current) {
    try {
      for (const s of shapesFor(a, boxOf, parentBoxOf)) draw(s, g);
    } catch {
      /* the element is gone or has no parent: nothing to draw for it */
    }
  }
  svg.replaceChildren(g);
}

const schedule = () => {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(render);
};

function ensureOverlay(): void {
  if (host?.isConnected) return;
  host = document.createElement('pixmeter-annotations');
  host.dataset.pixmeter = '';
  host.style.cssText =
    'position:fixed;inset:0;z-index:2147483646;pointer-events:none;border:0;margin:0;padding:0;' +
    `display:${hidden ? 'none' : 'block'}`;
  const shadow = host.attachShadow({ mode: 'open' });
  svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');
  svg.style.cssText = 'position:absolute;inset:0;overflow:visible;pointer-events:none';
  shadow.append(svg);
  document.documentElement.append(host);
  ownNodes.add(host);
  addEventListener('scroll', schedule, { capture: true, passive: true });
  addEventListener('resize', schedule, { passive: true });
  onStop(clearAnnotations);
}

/** Draw `list` (replacing what is there unless `replace` is false). Returns how many are shown. */
export function drawAnnotations(list: McpAnnotation[], replace = true): number {
  // resolve now so a bad element id is an error for the agent, not a silent gap
  for (const a of list) shapesFor(a, boxOf, parentBoxOf);
  ensureOverlay();
  current = replace ? [...list] : [...current, ...list];
  render();
  return current.length;
}

export function clearAnnotations(): number {
  const n = current.length;
  current = [];
  cancelAnimationFrame(frame);
  if (host) {
    removeEventListener('scroll', schedule, { capture: true });
    removeEventListener('resize', schedule);
    ownNodes.delete(host);
    host.remove();
  }
  host = null;
  svg = null;
  return n;
}

/** Hide the overlay while a shot is taken without it (it stays drawn, just not painted). */
export function setAnnotationsHidden(value: boolean): void {
  hidden = value;
  if (host) host.style.display = value ? 'none' : 'block';
}

export const annotateCommands: Commands = {
  draw_annotations({ annotations, replace }) {
    const shown = drawAnnotations(annotations, replace);
    return {
      shown,
      note:
        'The overlay is drawn over the page only (nothing in the page changes). ' +
        'Take get_screenshot with annotations: true to see it; clear_annotations removes it.',
    };
  },
  clear_annotations: () => ({ cleared: clearAnnotations() }),
};
