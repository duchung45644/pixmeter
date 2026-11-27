import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layer } from '../core/overlay';
import { sessionSignal, stopSession } from '../core/session';
import { state } from '../core/state.svelte';
import { elementId, initSidePanelBridge } from '../sidepanel/bridge.svelte';
import { runMcp } from '.';

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
const GRID = { base: 4, tolerance: 0.05, limit: 50 };
const add = (parent: Element, css: string, tag = 'div') => {
  const e = parent.appendChild(document.createElement(tag));
  e.setAttribute('style', css);
  return e;
};

beforeEach(async () => {
  const host = document.body.appendChild(document.createElement('pixmeter-ui'));
  host.attachShadow({ mode: 'open' }).append(layer);
  state.active = true;
  sessionSignal();
  await initSidePanelBridge();
});
afterEach(() => {
  vi.unstubAllGlobals();
  stopSession();
  state.active = false;
  document.body.replaceChildren();
});

it('get_box_model returns the four boxes and their sides', async () => {
  const el = add(document.body, 'margin:10px 20px;padding:5px;border:2px solid #000');
  place(el, rect(100, 50, 200, 100)); // border box
  const d = await ok('get_box_model', { elementId: elementId(el) });
  expect(d.margin).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
  expect(d.padding).toEqual({ top: 5, right: 5, bottom: 5, left: 5 });
  expect(d.border).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
  expect(d.boxes.border).toEqual({ x: 100, y: 50, width: 200, height: 100 });
  expect(d.boxes.margin).toEqual({ x: 80, y: 40, width: 240, height: 120 });
  expect(d.boxes.padding).toEqual({ x: 102, y: 52, width: 196, height: 96 });
  expect(d.boxes.content).toEqual({ x: 107, y: 57, width: 186, height: 86 });
  expect(d.transformed).toBe(false);
});

it('measure_spacing lists the gaps between children and their insets', async () => {
  const box = add(document.body, 'padding:8px');
  const a = add(box, '');
  const b = add(box, '');
  const c = add(box, '');
  const abs = add(box, 'position:absolute'); // out of flow: left out
  place(box, rect(0, 0, 200, 200));
  place(a, rect(8, 8, 184, 40));
  place(b, rect(8, 60, 184, 40)); // 12 below a
  place(c, rect(8, 112, 184, 40)); // 12 below b
  place(abs, rect(0, 0, 10, 10));
  const d = await ok('measure_spacing', { elementId: elementId(box) });
  expect(d.children).toHaveLength(3);
  expect(d.gaps.map((g: Json) => g.gap.vertical)).toEqual([12, 12]);
  expect(d.distinctGaps).toEqual([{ value: 12, count: 2 }]);
  expect(d.insets).toEqual({ top: 8, right: 8, bottom: 48, left: 8 });
  expect(d.container.padding.top).toBe(8);
});

it('measure_spacing truncates to the limit', async () => {
  const box = add(document.body, '');
  for (let i = 0; i < 5; i++) place(add(box, ''), rect(0, i * 20, 10, 10));
  const d = await ok('measure_spacing', { elementId: elementId(box), limit: 3 });
  expect(d.children).toHaveLength(3);
  expect(d.truncated).toBe(2);
});

it('measure_point_to_point needs no element', async () => {
  vi.stubGlobal('scrollY', 100);
  const d = await ok('measure_point_to_point', { from: { x: 0, y: 0 }, to: { x: 30, y: 40 } });
  expect(d).toMatchObject({ dx: 30, dy: 40, distance: 50, angle: 53.13 });
  expect(d.page.to).toEqual({ x: 30, y: 140 });
});

it('check_spacing_scale reports values off the grid', async () => {
  const root = add(document.body, 'padding:8px');
  add(root, 'margin-top:10.2px;padding-left:5.1px');
  add(root, 'margin-top:10.2px');
  add(root, 'margin-left:12px;margin-bottom:auto');
  const d = await ok('check_spacing_scale', { elementId: elementId(root), ...GRID });
  expect(d.offenders.map((o: Json) => [o.value, o.count, o.nearest])).toEqual([
    [10.2, 2, 12],
    [5.1, 1, 4],
  ]);
  expect(d.offenders[0].examples[0]).toMatchObject({ property: 'margin-top' });
  const tokens = await ok('check_spacing_scale', {
    elementId: elementId(root),
    values: [8, 12],
    tolerance: 0.05,
    limit: 50,
  });
  expect(tokens.offenders.map((o: Json) => o.value)).toEqual([10.2, 5.1]);
});
