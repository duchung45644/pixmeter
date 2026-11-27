/**
 * Inspection tools for the agent (MCP get_computed_styles, measure_alignment, compare_styles,
 * get_element_at_point, check_text_overflow): chosen CSS values for many elements at once, whether
 * boxes line up, what differs between two elements, what sits at a point, and text that is cut.
 */
import { isOwnHost, queryAllDeep, SKIP_TAGS } from '../../lib/dom/dom';
import { displaySelector } from '../../lib/dom/selector';
import { LIMITS } from '../../lib/mcp/protocol';
import { isOwn } from '../core/events';
import { elementId } from '../sidepanel/bridge.svelte';
import { buildElementSummary, ownText } from './ai-data';
import { elementOf, fail, McpFail, type Commands } from './command';

const r2 = (n: number) => Math.round(n * 100) / 100;
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r2(r.x), y: r2(r.y), width: r2(r.width), height: r2(r.height) };
};
const brief = (el: Element) => ({
  id: elementId(el),
  tag: el.tagName.toLowerCase(),
  selector: displaySelector(el),
});

// ---------------------------------------------------------------- computed styles

/** The element, or the reason it cannot be read (one gone id must not fail the whole call). */
function lookup(id: string): { el: Element } | { error: string } {
  try {
    return { el: elementOf(id) };
  } catch (e) {
    if (e instanceof McpFail) return { error: e.message };
    throw e;
  }
}

export function computedStyles(el: Element, properties: readonly string[]): Record<string, string> {
  const s = getComputedStyle(el);
  return Object.fromEntries(properties.map((p) => [p, s.getPropertyValue(p).trim()]));
}

// ---------------------------------------------------------------- alignment

export const EDGES = ['left', 'centerX', 'right', 'top', 'centerY', 'bottom'] as const;
export type Edge = (typeof EDGES)[number];
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const edgeValue = (b: Box, e: Edge): number =>
  ({
    left: b.left,
    centerX: b.left + b.width / 2,
    right: b.left + b.width,
    top: b.top,
    centerY: b.top + b.height / 2,
    bottom: b.top + b.height,
  })[e];

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/**
 * How well boxes line up on each edge and centre line: the spread (largest minus smallest), whether
 * it is within `tolerance`, and how far each box is from the median line.
 */
export function alignment(boxes: Record<string, Box>, tolerance: number) {
  const ids = Object.keys(boxes);
  const edges = {} as Record<
    Edge,
    { aligned: boolean; spread: number; at: number; offsets: Record<string, number> }
  >;
  for (const e of EDGES) {
    const vals = ids.map((id) => edgeValue(boxes[id]!, e));
    const at = median(vals);
    const spread = Math.max(...vals) - Math.min(...vals);
    const offsets: Record<string, number> = {};
    ids.forEach((id, i) => {
      const d = r2(vals[i]! - at);
      if (Math.abs(d) > tolerance) offsets[id] = d;
    });
    edges[e] = { aligned: spread <= tolerance, spread: r2(spread), at: r2(at), offsets };
  }
  const spread = (k: 'width' | 'height') => {
    const v = ids.map((id) => boxes[id]![k]);
    return r2(Math.max(...v) - Math.min(...v));
  };
  const widthSpread = spread('width');
  const heightSpread = spread('height');
  return {
    edges,
    alignedOn: EDGES.filter((e) => edges[e].aligned),
    sameWidth: widthSpread <= tolerance,
    sameHeight: heightSpread <= tolerance,
    widthSpread,
    heightSpread,
  };
}

// ---------------------------------------------------------------- text overflow

export type Overflow = 'clipped-x' | 'clipped-y' | 'ellipsis' | 'line-clamp' | 'spills-x';

/** How an element's text is cut or escapes its box, from its computed style and scroll size. */
export function overflowKinds(el: Element): Overflow[] {
  const s = getComputedStyle(el);
  if (s.display === 'inline' || s.display === 'contents') return []; // no box of its own
  const ox = s.overflowX || s.overflow.split(' ')[0] || 'visible';
  const oy = s.overflowY || s.overflow.split(' ').at(-1) || 'visible';
  const out: Overflow[] = [];
  const wider = el.scrollWidth > el.clientWidth + 1;
  const taller = el.scrollHeight > el.clientHeight + 1;
  const clampLines = s.getPropertyValue('-webkit-line-clamp');
  const clamps = !!clampLines && clampLines !== 'none';
  if (wider) {
    if (/^(hidden|clip)$/.test(ox))
      out.push(s.textOverflow === 'ellipsis' ? 'ellipsis' : 'clipped-x');
    else if (ox === 'visible' && /^(nowrap|pre)$/.test(s.whiteSpace)) out.push('spills-x');
  }
  if (taller) {
    if (clamps) out.push('line-clamp');
    else if (/^(hidden|clip)$/.test(oy)) out.push('clipped-y');
  }
  return out;
}

// ---------------------------------------------------------------- commands

export const inspectCommands: Commands = {
  get_computed_styles({ elementIds, properties }) {
    return {
      properties,
      elements: elementIds.map((id) => {
        const f = lookup(id);
        if ('error' in f) return { id, error: f.error };
        return { ...brief(f.el), styles: computedStyles(f.el, properties) };
      }),
    };
  },

  measure_alignment({ elementIds, tolerance }) {
    const boxes: Record<string, Box> = {};
    const items = elementIds.map((id) => {
      const el = elementOf(id);
      const r = el.getBoundingClientRect();
      boxes[id] = { left: r.left, top: r.top, width: r.width, height: r.height };
      return { ...brief(el), rect: rectOf(el) };
    });
    return {
      count: items.length,
      tolerance,
      unit: 'viewport CSS px',
      items,
      ...alignment(boxes, tolerance),
    };
  },

  compare_styles({ elementId: a, otherElementId: b, properties, ignore }) {
    const ea = elementOf(a);
    const eb = elementOf(b);
    const sa = getComputedStyle(ea);
    const sb = getComputedStyle(eb);
    const names = properties ?? Array.from(sa, (n) => n).filter((n) => !ignore?.includes(n));
    const differences: { property: string; a: string; b: string }[] = [];
    let truncated = false;
    for (const property of names) {
      const va = sa.getPropertyValue(property).trim();
      const vb = sb.getPropertyValue(property).trim();
      if (va === vb) continue;
      if (differences.length >= LIMITS.styleDiffs) {
        truncated = true;
        break;
      }
      differences.push({ property, a: va, b: vb });
    }
    return {
      a: brief(ea),
      b: brief(eb),
      compared: names.length,
      identical: !differences.length,
      differences,
      ...(truncated && { truncated: true }),
      note: properties
        ? undefined
        : 'All computed properties were compared. Pass properties to focus on some, or ignore to skip some. Size and position properties differ whenever the boxes differ.',
    };
  },

  get_element_at_point({ x, y, limit }) {
    const stack = document.elementsFromPoint(x, y).filter((n) => !isOwn(n));
    const top =
      stack.find((n) => n !== document.body && n !== document.documentElement) ?? stack[0];
    if (!top)
      return fail(
        `Nothing at (${x}, ${y}). The point must be inside the viewport (${innerWidth}×${innerHeight}).`,
      );
    return {
      point: { x, y },
      element: buildElementSummary(top, elementId),
      stack: stack.slice(0, limit).map((n) => ({ ...brief(n), rect: rectOf(n) })),
      total: stack.length,
    };
  },

  check_text_overflow({ elementId: id, limit }) {
    const root: ParentNode = id ? elementOf(id) : document;
    const all = queryAllDeep(root, '*', isOwnHost).filter(
      (e) => !SKIP_TAGS.includes(e.tagName) && !isOwnHost(e),
    );
    if (id) all.unshift(root as Element);
    const issues: object[] = [];
    let scanned = 0;
    let truncated = false;
    for (const el of all) {
      const text = ownText(el);
      const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (!text && !isField) continue;
      scanned++;
      const kinds = overflowKinds(el);
      if (!kinds.length) continue;
      if (issues.length >= limit) {
        truncated = true;
        continue;
      }
      issues.push({
        ...brief(el),
        kinds,
        text: cut(text || (el as HTMLInputElement).value, 80),
        client: { width: el.clientWidth, height: el.clientHeight },
        scroll: { width: el.scrollWidth, height: el.scrollHeight },
        hiddenPx: {
          x: Math.max(0, el.scrollWidth - el.clientWidth),
          y: Math.max(0, el.scrollHeight - el.clientHeight),
        },
      });
    }
    return {
      scanned,
      count: issues.length,
      issues,
      ...(truncated && { truncated: true }),
      kindsGuide: {
        'clipped-x': 'text is cut off at the right edge (overflow hidden, no ellipsis)',
        ellipsis: 'text is shortened with "…" (text-overflow: ellipsis)',
        'clipped-y': 'text is cut off at the bottom (overflow hidden)',
        'line-clamp': 'text is limited to a number of lines (line-clamp)',
        'spills-x': 'unwrapped text runs past its box and overlaps what is next to it',
      },
    };
  },
};
