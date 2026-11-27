import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layer } from '../core/overlay';
import { sessionSignal, stopSession } from '../core/session';
import { state } from '../core/state.svelte';
import { elementId, initSidePanelBridge } from '../sidepanel/bridge.svelte';
import { setAnnotationsHidden, shapesFor, type BoxOf } from './annotate';
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
const boxes: Record<string, DOMRect> = {
  'v-a': rect(0, 0, 100, 50),
  'v-b': rect(0, 74, 100, 20),
  'v-parent': rect(0, 0, 200, 100),
  'v-child': rect(20, 10, 160, 80),
};
const boxOf: BoxOf = (id) => boxes[id]!;
const parentBoxOf: BoxOf = () => boxes['v-parent']!;
const labels = (s: ReturnType<typeof shapesFor>) =>
  s.flatMap((x) => (x.kind === 'text' ? [x.text] : []));

it('a distance between two boxes draws the gap with its size', () => {
  const s = shapesFor(
    { type: 'distance', elementId: 'v-a', toElementId: 'v-b' },
    boxOf,
    parentBoxOf,
  );
  expect(labels(s)).toEqual(['24px']);
  const line = s.find((x) => x.kind === 'line')!;
  expect(line).toMatchObject({ x1: 50, y1: 50, x2: 50, y2: 74, ends: 'both' });
});

it('a distance to the parent draws the four insets, skipping zeros', () => {
  const s = shapesFor({ type: 'distance', elementId: 'v-child' }, boxOf, parentBoxOf);
  expect(labels(s)).toEqual(['10px', '20px', '10px', '20px']);
});

it('a caller label prefixes the first measurement only', () => {
  const s = shapesFor({ type: 'distance', elementId: 'v-child', label: 'pad' }, boxOf, parentBoxOf);
  expect(labels(s)).toEqual(['pad: 10px', '20px', '10px', '20px']);
});

it('point distance, arrow, box and label', () => {
  expect(
    labels(
      shapesFor(
        { type: 'distance', from: { x: 0, y: 0 }, to: { x: 30, y: 40 } },
        boxOf,
        parentBoxOf,
      ),
    ),
  ).toEqual(['50px']);
  const arrow = shapesFor(
    { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, label: 'here' },
    boxOf,
    parentBoxOf,
  );
  expect(arrow[0]).toMatchObject({ kind: 'line', ends: 'end' });
  expect(labels(arrow)).toEqual(['here']);
  const box = shapesFor(
    { type: 'box', elementId: 'v-a', label: '1', color: 'blue' },
    boxOf,
    parentBoxOf,
  );
  expect(box[0]).toMatchObject({ kind: 'rect', x: 0, y: 0, w: 100, h: 50, color: 'blue' });
  expect(
    shapesFor({ type: 'box', rect: { x: 1, y: 2, width: 3, height: 4 } }, boxOf, parentBoxOf)[0],
  ).toMatchObject({ x: 1, y: 2, w: 3, h: 4 });
  expect(
    shapesFor({ type: 'label', text: 'hi', elementId: 'v-b' }, boxOf, parentBoxOf)[0],
  ).toMatchObject({ x: 0, y: 74, text: 'hi' });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const ok = async (type: Parameters<typeof runMcp>[0], payload: object) => {
  const r = await runMcp(type, { tabId: 1, ...payload });
  if (!r.ok) throw new Error(r.error);
  return r.data as Json;
};

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
  document.documentElement.querySelectorAll('pixmeter-annotations').forEach((n) => n.remove());
});

it('draws into its own host without touching the page, and clears it', async () => {
  const el = document.body.appendChild(document.createElement('div'));
  el.getBoundingClientRect = () => rect(10, 10, 80, 30);
  const id = elementId(el); // tags the element, as every command does
  const before = document.body.innerHTML;
  const d = await ok('draw_annotations', {
    annotations: [
      { type: 'box', elementId: id, label: 'A' },
      { type: 'arrow', from: { x: 0, y: 0 }, to: { x: 9, y: 9 } },
    ],
  });
  expect(d.shown).toBe(2);
  expect(document.body.innerHTML).toBe(before); // page DOM untouched
  const host = document.documentElement.querySelector('pixmeter-annotations') as HTMLElement;
  expect(host.shadowRoot!.querySelectorAll('rect').length).toBeGreaterThan(0);
  expect(host.style.pointerEvents).toBe('none');
  // replace by default, append on request
  expect(
    (
      await ok('draw_annotations', {
        annotations: [{ type: 'label', text: 'x', at: { x: 1, y: 1 } }],
      })
    ).shown,
  ).toBe(1);
  expect(
    (
      await ok('draw_annotations', {
        annotations: [{ type: 'label', text: 'y', at: { x: 1, y: 1 } }],
        replace: false,
      })
    ).shown,
  ).toBe(2);
  setAnnotationsHidden(true);
  expect(host.style.display).toBe('none');
  setAnnotationsHidden(false);
  expect(await ok('clear_annotations', {})).toEqual({ cleared: 2 });
  expect(document.documentElement.querySelector('pixmeter-annotations')).toBeNull();
});

it('rejects an element that is gone', async () => {
  const r = await runMcp('draw_annotations', {
    tabId: 1,
    annotations: [{ type: 'box', elementId: 'v-zzzz' }],
  });
  expect(r).toMatchObject({ ok: false });
  expect(document.documentElement.querySelector('pixmeter-annotations')).toBeNull();
});
