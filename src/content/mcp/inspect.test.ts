import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layer } from '../core/overlay';
import { sessionSignal, stopSession } from '../core/session';
import { state } from '../core/state.svelte';
import { elementId, initSidePanelBridge } from '../sidepanel/bridge.svelte';
import { runMcp } from '.';
import { alignment, overflowKinds } from './inspect';
import { fitZoom } from './breakpoints';

vi.mock('../../lib/ext/messaging', async (orig) => ({
  ...(await orig<typeof import('../../lib/ext/messaging')>()),
  sendToSidePanel: vi.fn(async () => undefined),
  sendToBackground: vi.fn(async () => undefined),
}));

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON() {},
  }) as DOMRect;
const place = (el: Element, r: DOMRect) => (el.getBoundingClientRect = () => r);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const ok = async (type: Parameters<typeof runMcp>[0], payload: object) => {
  const r = await runMcp(type, { tabId: 1, ...payload });
  if (!r.ok) throw new Error(r.error);
  return r.data as Json;
};
const add = (css: string, tag = 'div', text = '') => {
  const e = document.body.appendChild(document.createElement(tag));
  e.setAttribute('style', css);
  e.textContent = text;
  return e;
};
const size = (el: Element, p: Record<string, number>) =>
  Object.entries(p).forEach(([k, v]) =>
    Object.defineProperty(el, k, { value: v, configurable: true }),
  );

beforeEach(async () => {
  const host = document.body.appendChild(document.createElement('pixmeter-ui'));
  host.attachShadow({ mode: 'open' }).append(layer);
  state.active = true;
  sessionSignal();
  await initSidePanelBridge();
});
afterEach(() => {
  stopSession();
  state.active = false;
  document.body.replaceChildren();
});

it('get_computed_styles reads chosen properties and reports a gone element', async () => {
  const a = add('font-size:20px;color:rgb(1, 2, 3)');
  const d = await ok('get_computed_styles', {
    elementIds: [elementId(a), 'v-gone'],
    properties: ['font-size', 'color'],
  });
  expect(d.elements[0].styles).toEqual({ 'font-size': '20px', color: 'rgb(1, 2, 3)' });
  expect(d.elements[1].error).toMatch(/No element/);
});

it('alignment finds the shared lines and the odd one out', () => {
  const a = alignment(
    {
      a: { left: 10, top: 0, width: 100, height: 50 },
      b: { left: 10, top: 0, width: 100, height: 50 },
      c: { left: 14, top: 0, width: 100, height: 52 },
    },
    0.5,
  );
  expect(a.edges.top.aligned).toBe(true);
  expect(a.edges.left.aligned).toBe(false);
  expect(a.edges.left.offsets).toEqual({ c: 4 });
  expect(a.alignedOn).toContain('top');
  expect(a.sameWidth).toBe(true);
  expect(a.sameHeight).toBe(false);
});

it('measure_alignment returns items and edges', async () => {
  const a = add('');
  const b = add('');
  place(a, rect(0, 0, 50, 20));
  place(b, rect(0, 30, 50, 20));
  const d = await ok('measure_alignment', {
    elementIds: [elementId(a), elementId(b)],
    tolerance: 0.5,
  });
  expect(d.count).toBe(2);
  expect(d.edges.left.aligned).toBe(true);
  expect(d.edges.top.aligned).toBe(false);
});

it('compare_styles lists only the differences', async () => {
  const a = add('color:red;margin:4px');
  const b = add('color:blue;margin:4px');
  const d = await ok('compare_styles', {
    elementId: elementId(a),
    otherElementId: elementId(b),
    properties: ['color', 'margin-top'],
  });
  expect(d.identical).toBe(false);
  expect(d.differences).toEqual([{ property: 'color', a: 'red', b: 'blue' }]);
});

it('get_element_at_point returns the top element and the stack, or an error', async () => {
  const a = add('');
  document.elementsFromPoint = () => [a, document.body, document.documentElement];
  const d = await ok('get_element_at_point', { x: 5, y: 5, limit: 20 });
  expect(d.element.id).toBe(elementId(a));
  expect(d.stack).toHaveLength(3);
  document.elementsFromPoint = () => [];
  const r = await runMcp('get_element_at_point', { tabId: 1, x: 5, y: 5, limit: 20 });
  expect(r.ok).toBe(false);
});

it('overflowKinds tells clipped, ellipsis, line-clamp and spill apart', () => {
  const clip = add('overflow:hidden;display:block', 'div', 'x');
  size(clip, { scrollWidth: 300, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });
  expect(overflowKinds(clip)).toEqual(['clipped-x']);
  const dots = add('overflow:hidden;text-overflow:ellipsis;display:block', 'div', 'x');
  size(dots, { scrollWidth: 300, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });
  expect(overflowKinds(dots)).toEqual(['ellipsis']);
  const spill = add('white-space:nowrap;display:block', 'div', 'x');
  size(spill, { scrollWidth: 300, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });
  expect(overflowKinds(spill)).toEqual(['spills-x']);
  const tall = add('overflow:hidden;display:block', 'div', 'x');
  size(tall, { scrollWidth: 100, clientWidth: 100, scrollHeight: 90, clientHeight: 40 });
  expect(overflowKinds(tall)).toEqual(['clipped-y']);
  const fine = add('display:block', 'div', 'x');
  size(fine, { scrollWidth: 100, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });
  expect(overflowKinds(fine)).toEqual([]);
});

it('check_text_overflow reports only elements with a problem', async () => {
  const clip = add('overflow:hidden;display:block', 'p', 'Long title');
  size(clip, { scrollWidth: 300, clientWidth: 100, scrollHeight: 20, clientHeight: 20 });
  add('display:block', 'p', 'Fine');
  const d = await ok('check_text_overflow', { limit: 50 });
  expect(d.count).toBe(1);
  expect(d.issues[0]).toMatchObject({ kinds: ['clipped-x'], hiddenPx: { x: 200, y: 0 } });
});

it('hover_element sends enter events and leaves again', async () => {
  const a = add('');
  place(a, rect(10, 10, 100, 40));
  a.scrollIntoView = () => {};
  document.elementsFromPoint = () => [a];
  const seen: string[] = [];
  for (const t of ['mouseover', 'mouseenter', 'mouseleave'])
    a.addEventListener(t, () => seen.push(t));
  const on = await ok('hover_element', { elementId: elementId(a), hover: true });
  expect(on.hover).toBe(true);
  expect(seen).toEqual(['mouseover', 'mouseenter']);
  await ok('hover_element', { elementId: elementId(a), hover: false });
  expect(seen).toContain('mouseleave');
});

it('fitZoom shrinks wide sets to fit, never above 1 or below 0.25', () => {
  expect(fitZoom([375, 768, 1280], 1920)).toBeCloseTo(0.75, 1);
  expect(fitZoom([375], 1920)).toBe(1);
  expect(fitZoom([3840, 3840], 800)).toBe(0.25);
});
