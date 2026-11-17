import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layer } from '../core/overlay';
import { sessionSignal, stopSession } from '../core/session';
import { state } from '../core/state.svelte';
import { elementId, initSidePanelBridge } from '../sidepanel/bridge.svelte';
import { distanceBetween } from './measure';
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
const ok = async (type: Parameters<typeof runMcp>[0], payload: object) => {
  const r = await runMcp(type, { tabId: 1, ...payload });
  if (!r.ok) throw new Error(r.error);
  return r.data as Record<string, unknown>;
};

beforeEach(async () => {
  const host = document.body.appendChild(document.createElement('pixellens-ui'));
  host.attachShadow({ mode: 'open' }).append(layer);
  state.active = true;
  sessionSignal();
  await initSidePanelBridge();
  document.elementsFromPoint = () => [];
});
afterEach(() => {
  stopSession();
  state.active = false;
  document.body.replaceChildren();
});

it('gaps between boxes apart, overlapping, and insets when nested', () => {
  expect(distanceBetween(rect(0, 0, 100, 50), rect(0, 74, 100, 20))).toEqual({
    relation: 'apart',
    direction: 'below',
    gap: { horizontal: 0, vertical: 24 },
  });
  expect(distanceBetween(rect(200, 100, 50, 50), rect(0, 0, 100, 50))).toMatchObject({
    direction: 'above-left',
    gap: { horizontal: 100, vertical: 50 },
  });
  expect(distanceBetween(rect(0, 0, 100, 50), rect(50, 25, 100, 50)).relation).toBe('overlapping');
  expect(distanceBetween(rect(16, 8, 68, 34), rect(0, 0, 100, 50))).toEqual({
    relation: 'inside',
    insets: { top: 8, right: 16, bottom: 8, left: 16 },
  });
});

it('measure_distance defaults to the parent', async () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const child = parent.appendChild(document.createElement('span'));
  place(parent, rect(0, 0, 200, 100));
  place(child, rect(20, 10, 160, 80));
  const d = await ok('measure_distance', { elementId: elementId(child) });
  expect(d.relation).toBe('inside');
  expect(d.insets).toEqual({ top: 10, right: 20, bottom: 10, left: 20 });
  expect((d.to as { isParent: boolean }).isParent).toBe(true);
});

it('check_contrast reports the ratio, level and a fix when it fails', async () => {
  const box = document.body.appendChild(document.createElement('div'));
  box.style.backgroundColor = 'rgb(255, 255, 255)';
  const p = box.appendChild(document.createElement('p'));
  p.textContent = 'Hello';
  p.style.color = 'rgb(170, 170, 170)';
  p.style.fontSize = '14px';
  place(box, rect(0, 0, 200, 100));
  place(p, rect(10, 10, 100, 20));
  document.elementsFromPoint = () => [p, box, document.body, document.documentElement];
  const d = await ok('check_contrast', { elementId: elementId(p) });
  expect(d.foreground).toMatch(/^#aaaaaa$/i);
  expect(d.background).toMatch(/^#ffffff$/i);
  expect(d.ratio).toBeCloseTo(2.32, 1);
  expect(d.level).toBe('fail');
  expect(d.largeText).toBe(false);
  expect(d.suggestedForeground).toMatch(/^#[0-9a-f]{6}$/i);
});
