/**
 * Box-model and spacing measurements for the agent (MCP get_box_model, measure_spacing,
 * measure_point_to_point, check_spacing_scale): what Pixmeter's Box and Distance tools show,
 * as numbers, in one call.
 */
import { isOwnHost } from '../../lib/dom/dom';
import { displaySelector } from '../../lib/dom/selector';
import { groupOffenders, px as parsePx } from '../../lib/mcp/spacing';
import { elementId } from '../sidepanel/bridge.svelte';
import { buildElementSummary } from './ai-data';
import { elementOf, type Commands } from './command';
import { distanceBetween } from './measure';

const r2 = (n: number) => Math.round(n * 100) / 100;
const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Sides = Record<(typeof SIDES)[number], number>;
interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const sides = (s: CSSStyleDeclaration, name: (side: string) => string): Sides =>
  Object.fromEntries(
    SIDES.map((k) => [k, r2(parseFloat(s.getPropertyValue(name(k))) || 0)]),
  ) as Sides;
const toBox = (r: DOMRect): Box => ({
  x: r2(r.left),
  y: r2(r.top),
  width: r2(r.width),
  height: r2(r.height),
});
const grow = (b: Box, by: Sides): Box => ({
  x: r2(b.x - by.left),
  y: r2(b.y - by.top),
  width: r2(b.width + by.left + by.right),
  height: r2(b.height + by.top + by.bottom),
});
const shrink = (b: Box, by: Sides): Box =>
  grow(b, { top: -by.top, right: -by.right, bottom: -by.bottom, left: -by.left });

/** The four boxes of the CSS box model in viewport px, from the border box outwards and inwards. */
export function boxModel(el: Element) {
  const s = getComputedStyle(el);
  const margin = sides(s, (k) => `margin-${k}`);
  const border = sides(s, (k) => `border-${k}-width`);
  const padding = sides(s, (k) => `padding-${k}`);
  const borderBox = toBox(el.getBoundingClientRect());
  const paddingBox = shrink(borderBox, border);
  return {
    boxSizing: s.boxSizing,
    display: s.display,
    margin,
    border,
    padding,
    boxes: {
      margin: grow(borderBox, margin),
      border: borderBox,
      padding: paddingBox,
      content: shrink(paddingBox, padding),
    },
    // rects are what the screen shows; a transform makes the CSS values and the rects disagree
    transformed: s.transform !== 'none' && s.transform !== '',
  };
}

const compact = (el: Element) => ({
  id: elementId(el),
  tag: el.tagName.toLowerCase(),
  selector: displaySelector(el),
  box: toBox(el.getBoundingClientRect()),
});

/** Children that take part in layout: rendered, not out of flow, not our own UI. */
function flowChildren(el: Element): Element[] {
  return [...el.children].filter((c) => {
    if (isOwnHost(c) || /^(script|style|link|meta|template|noscript)$/i.test(c.localName))
      return false;
    const s = getComputedStyle(c);
    return (
      s.display !== 'none' &&
      s.display !== 'contents' &&
      s.position !== 'absolute' &&
      s.position !== 'fixed'
    );
  });
}

const SPACING_PROPS = [
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'row-gap',
  'column-gap',
] as const;

/** Most elements one check_spacing_scale call reads. */
const SCAN_MAX = 5000;

export const spacingCommands: Commands = {
  get_box_model({ elementId: id }) {
    const el = elementOf(id);
    return {
      element: buildElementSummary(el, elementId),
      ...boxModel(el),
      unit: 'CSS px (viewport coordinates)',
    };
  },
  measure_spacing({ elementId: id, limit }) {
    const container = elementOf(id);
    const all = flowChildren(container);
    const kids = all.slice(0, limit);
    const s = getComputedStyle(container);
    const rc = container.getBoundingClientRect();
    const pads = sides(s, (k) => `padding-${k}`);
    const gaps = kids.slice(1).map((b, i) => {
      const a = kids[i]!;
      const d = distanceBetween(a.getBoundingClientRect(), b.getBoundingClientRect());
      return {
        from: elementId(a),
        to: elementId(b),
        relation: d.relation,
        ...('gap' in d ? { gap: d.gap, direction: d.direction } : {}),
      };
    });
    // distinct main-axis gaps tell at once whether the rhythm is consistent
    const tally = new Map<number, number>();
    for (const g of gaps) {
      const v = 'gap' in g && g.gap ? Math.max(g.gap.horizontal, g.gap.vertical) : null;
      if (v !== null && v > 0) tally.set(v, (tally.get(v) ?? 0) + 1);
    }
    let insets: Sides | null = null;
    if (kids.length) {
      const rects = kids.map((k) => k.getBoundingClientRect());
      const left = Math.min(...rects.map((r) => r.left));
      const top = Math.min(...rects.map((r) => r.top));
      const right = Math.max(...rects.map((r) => r.right));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      insets = {
        top: r2(top - rc.top),
        right: r2(rc.right - right),
        bottom: r2(rc.bottom - bottom),
        left: r2(left - rc.left),
      };
    }
    return {
      container: { ...compact(container), padding: pads },
      layout: {
        display: s.display,
        flexDirection: s.display.includes('flex') ? s.flexDirection : null,
        rowGap: s.rowGap,
        columnGap: s.columnGap,
      },
      children: kids.map(compact),
      truncated: all.length - kids.length,
      gaps,
      distinctGaps: [...tally]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => a.value - b.value),
      // children block (union) from each edge of the container's border box
      insets,
      unit: 'CSS px (viewport coordinates)',
    };
  },
  measure_point_to_point({ from, to }) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return {
      from,
      to,
      dx: r2(dx),
      dy: r2(dy),
      distance: r2(Math.hypot(dx, dy)),
      // 0° points right, 90° points down (screen coordinates)
      angle: r2((Math.atan2(dy, dx) * 180) / Math.PI),
      page: {
        from: { x: r2(from.x + scrollX), y: r2(from.y + scrollY) },
        to: { x: r2(to.x + scrollX), y: r2(to.y + scrollY) },
      },
      unit: 'CSS px (viewport coordinates; page = plus current scroll)',
    };
  },
  check_spacing_scale({ elementId: id, base, values, tolerance, limit }) {
    const root = id ? elementOf(id) : document.body;
    const scale = { base, values };
    const els = [root, ...root.querySelectorAll('*')]
      .filter((e) => !isOwnHost(e))
      .slice(0, SCAN_MAX);
    const readings: { value: number; property: string; el: Element }[] = [];
    for (const e of els) {
      const s = getComputedStyle(e);
      if (s.display === 'none') continue;
      for (const property of SPACING_PROPS) {
        const value = parsePx(s.getPropertyValue(property));
        if (value !== null && value !== 0) readings.push({ value, property, el: e });
      }
    }
    const all = groupOffenders(readings, scale, tolerance);
    const offenders = all.slice(0, limit).map((o) => ({
      ...o,
      examples: readings
        .filter((r) => r2(r.value) === o.value)
        .slice(0, 3)
        .map((r) => ({ ...compact(r.el), property: r.property })),
    }));
    return {
      scale: values ? { values } : { base },
      tolerance,
      checkedElements: els.length,
      checkedValues: readings.length,
      offScaleValues: all.length,
      offenders,
      truncated: all.length - offenders.length,
      note: 'Computed margin, padding and gap in px; auto, % and 0 are skipped. Negative margins are judged by size.',
    };
  },
};
