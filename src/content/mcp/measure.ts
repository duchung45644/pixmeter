/**
 * Measuring for the agent (MCP measure_distance, check_contrast): the numbers the Distance tool
 * draws and the contrast check of the side panel, as data.
 */
import { isLargeText, roundRatio } from '../../lib/dom/a11y';
import { suggestForeground } from '../../lib/style/contrast-fix';
import { contrastRatio, parseColor, toHex, wcagLevel } from '../../lib/style/color';
import { backgroundOf } from '../core/contrast';
import { buildElementSummary } from './ai-data';
import { elementOf, fail, type Commands } from './command';
import { elementId } from '../sidepanel/bridge.svelte';

const px = (n: number) => Math.round(n * 100) / 100;
const box = (r: DOMRect) => ({
  x: px(r.left),
  y: px(r.top),
  width: px(r.width),
  height: px(r.height),
});

/**
 * Space between two boxes. Apart: the horizontal and vertical gaps (0 when they overlap on that
 * axis). One inside the other: the inset of the inner box from each edge of the outer one.
 */
export function distanceBetween(a: DOMRect, b: DOMRect) {
  const contains = (o: DOMRect, i: DOMRect) =>
    i.left >= o.left && i.right <= o.right && i.top >= o.top && i.bottom <= o.bottom;
  const inset = (o: DOMRect, i: DOMRect) => ({
    top: px(i.top - o.top),
    right: px(o.right - i.right),
    bottom: px(o.bottom - i.bottom),
    left: px(i.left - o.left),
  });
  if (contains(b, a)) return { relation: 'inside', insets: inset(b, a) } as const;
  if (contains(a, b)) return { relation: 'contains', insets: inset(a, b) } as const;
  const horizontal = Math.max(0, b.left - a.right, a.left - b.right);
  const vertical = Math.max(0, b.top - a.bottom, a.top - b.bottom);
  return {
    relation: horizontal || vertical ? 'apart' : 'overlapping',
    // where the other element sits, seen from the first
    direction:
      [
        vertical && (b.top >= a.bottom ? 'below' : 'above'),
        horizontal && (b.left >= a.right ? 'right' : 'left'),
      ]
        .filter(Boolean)
        .join('-') || null,
    gap: { horizontal: px(horizontal), vertical: px(vertical) },
  } as const;
}

const summary = (el: Element) => buildElementSummary(el, elementId);

export const measureCommands: Commands = {
  measure_distance({ elementId: id, toElementId }) {
    const a = elementOf(id);
    const b = toElementId
      ? elementOf(toElementId)
      : (a.parentElement ?? fail('The element has no parent; pass toElementId.'));
    if (a === b) return fail('Pick two different elements.');
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return {
      from: { ...summary(a), box: box(ra) },
      to: { ...summary(b), box: box(rb), isParent: !toElementId },
      ...distanceBetween(ra, rb),
      unit: 'CSS px (viewport coordinates)',
    };
  },
  check_contrast({ elementId: id }) {
    const el = elementOf(id);
    const s = getComputedStyle(el);
    const fg = parseColor(s.color);
    if (!fg) return fail(`Could not read the text colour (${s.color}).`);
    const bg = backgroundOf(el);
    const size = parseFloat(s.fontSize);
    const weight = parseInt(s.fontWeight, 10) || 400;
    const large = isLargeText(size, weight);
    const base = {
      element: summary(el),
      text: ((el as HTMLElement).innerText ?? '').trim().slice(0, 120),
      foreground: toHex(fg),
      fontSize: `${size}px`,
      fontWeight: weight,
      largeText: large,
    };
    if (!bg)
      return {
        ...base,
        background: null,
        note: 'The background is an image or gradient, so the ratio cannot be computed; check it with get_screenshot.',
      };
    const ratio = roundRatio(contrastRatio(fg, bg));
    const level = wcagLevel(ratio, large);
    const need = large ? 3 : 4.5;
    const fix = level === 'fail' ? suggestForeground(fg, bg, need) : null;
    return {
      ...base,
      background: toHex(bg),
      ratio,
      level,
      required: { AA: need, AAA: large ? 4.5 : 7 },
      ...(fix ? { suggestedForeground: toHex(fix) } : {}),
    };
  },
};
