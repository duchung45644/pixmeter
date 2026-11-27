import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { layer } from '../core/overlay';
import { sessionSignal, stopSession } from '../core/session';
import { state } from '../core/state.svelte';
import { initSidePanelBridge } from '../sidepanel/bridge.svelte';
import { runMcp } from '.';

vi.mock('../../lib/ext/messaging', async (orig) => ({
  ...(await orig<typeof import('../../lib/ext/messaging')>()),
  sendToSidePanel: vi.fn(async () => undefined),
  sendToBackground: vi.fn(async () => undefined),
}));

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
  state.capturing = false;
  document.body.replaceChildren();
});

const call = (type: Parameters<typeof runMcp>[0], payload: object) =>
  runMcp(type, { tabId: 1, ...payload });
const COMPARE = { threshold: 0.1, tolerancePercent: 0, diffImage: true, fullPage: false };

it('compare_screenshot needs a capture that exists', async () => {
  const r = await call('compare_screenshot', { ...COMPARE, referenceCaptureId: 'shot-999' });
  expect(r).toMatchObject({
    ok: false,
    error: expect.stringContaining('No capture with id shot-999'),
  });
});

it('refuses to capture while the user has a capture open', async () => {
  state.capturing = true;
  const r = await call('get_screenshot', { scale: 2 });
  expect(r).toMatchObject({ ok: false, error: expect.stringContaining('capture is open') });
  expect(state.capturing).toBe(true); // not ours to clear
});

it('an element id in responsive mode asks for a rect instead', async () => {
  state.responsiveOn = true;
  state.inFrame = false;
  const r = await call('get_screenshot', { elementId: 'v-abc' });
  // the screenshot runs in the top page, which cannot see elements inside the frames
  expect(r).toMatchObject({ ok: false, error: expect.stringContaining('pass rect') });
  state.responsiveOn = false;
});
