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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
const ok = async (type: Parameters<typeof runMcp>[0], payload: object) => {
  const r = await runMcp(type, { tabId: 1, ...payload });
  if (!r.ok) throw new Error(r.error);
  return r.data as Json;
};
const html = (h: string) => (document.body.innerHTML = h);
const sized = (el: Element) =>
  (el.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      width: 10,
      height: 10,
      right: 10,
      bottom: 10,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect);

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

it('find_by_text matches own text, alt, aria-label and button values', async () => {
  html(`<p>Save the date</p><a><img alt="Save icon"></a><button aria-label="save">x</button>
        <input type="submit" value="Save"><p>Cancel</p>`);
  const d = await ok('find_by_text', {
    text: 'save',
    exact: false,
    caseSensitive: false,
    limit: 50,
  });
  expect(d.matches.map((m: Json) => [m.tag, m.matchedOn])).toEqual([
    ['p', 'text'],
    ['img', 'alt'],
    ['button', 'aria-label'],
    ['input', 'value'],
  ]);
  const exact = await ok('find_by_text', {
    text: 'Save',
    exact: true,
    caseSensitive: true,
    limit: 50,
  });
  expect(exact.matches.map((m: Json) => m.tag)).toEqual(['input']);
});

it('find_by_text finds text split across inline children, innermost first', async () => {
  html('<div><span>Save <b>draft</b></span></div>');
  const d = await ok('find_by_text', {
    text: 'Save draft',
    exact: false,
    caseSensitive: false,
    limit: 50,
  });
  expect(d.matches.map((m: Json) => [m.tag, m.matchedOn])).toEqual([['span', 'textContent']]);
});

it('find_by_text limits and searches under a root', async () => {
  html('<ul id="a"><li>x</li><li>x</li><li>x</li></ul><ul id="b"><li>x</li></ul>');
  const a = document.getElementById('a')!;
  const d = await ok('find_by_text', {
    text: 'x',
    exact: false,
    caseSensitive: false,
    limit: 2,
    rootId: elementId(a),
  });
  expect(d.count).toBe(3);
  expect(d.matches).toHaveLength(2);
  expect(d.truncated).toBe(1);
});

it('scroll_into_view scrolls and reports', async () => {
  html('<div id="t">x</div>');
  const t = document.getElementById('t')!;
  sized(t);
  const spy = vi.fn();
  t.scrollIntoView = spy;
  const d = await ok('scroll_into_view', { elementId: elementId(t), block: 'start' });
  expect(spy).toHaveBeenCalledWith({ block: 'start', inline: 'nearest', behavior: 'instant' });
  expect(d.inViewport).toBe(true);
});

it('wait_for resolves when the selector appears', async () => {
  html('');
  setTimeout(() => {
    const e = document.body.appendChild(document.createElement('div'));
    e.className = 'late';
    sized(e);
  }, 120);
  const d = await ok('wait_for', {
    selector: '.late',
    state: 'visible',
    stable: false,
    timeoutMs: 3000,
    quietMs: 0,
  });
  expect(d).toMatchObject({ found: true, count: 1 });
  expect(d.waitedMs).toBeGreaterThanOrEqual(100);
});

it('wait_for times out as data, not as an error', async () => {
  html('');
  const d = await ok('wait_for', {
    selector: '.never',
    state: 'visible',
    stable: false,
    timeoutMs: 150,
    quietMs: 0,
  });
  expect(d).toMatchObject({ found: false, timedOut: true, selectorMet: false });
});

it('wait_for stable waits for the DOM to go quiet', async () => {
  html('');
  const t0 = performance.now();
  const timer = setInterval(() => document.body.append(document.createElement('i')), 40);
  setTimeout(() => clearInterval(timer), 200);
  const d = await ok('wait_for', { stable: true, state: 'visible', quietMs: 150, timeoutMs: 3000 });
  clearInterval(timer);
  expect(d).toMatchObject({ found: true, stable: true });
  expect(performance.now() - t0).toBeGreaterThanOrEqual(300);
});

it('wait_for detached and an invalid selector', async () => {
  html('<div class="x"></div>');
  const gone = setTimeout(() => document.querySelector('.x')?.remove(), 100);
  expect(
    await ok('wait_for', {
      selector: '.x',
      state: 'detached',
      stable: false,
      timeoutMs: 3000,
      quietMs: 0,
    }),
  ).toMatchObject({
    found: true,
  });
  clearTimeout(gone);
  const r = await runMcp('wait_for', {
    tabId: 1,
    selector: '!!',
    state: 'visible',
    stable: false,
    timeoutMs: 500,
    quietMs: 0,
  });
  expect(r).toMatchObject({ ok: false });
});
