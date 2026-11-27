/**
 * Finding and waiting for the agent (MCP find_by_text, scroll_into_view, wait_for): locate an
 * element by what the user reads, bring it on screen, and let the page settle before measuring.
 */
import { isOwnHost, queryAllDeep, SKIP_TAGS } from '../../lib/dom/dom';
import { displaySelector } from '../../lib/dom/selector';
import { elementId } from '../sidepanel/bridge.svelte';
import { ownText } from './ai-data';
import { elementOf, fail, type Commands } from './command';

const r2 = (n: number) => Math.round(n * 100) / 100;
const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
const cut = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);

const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r2(r.x), y: r2(r.y), width: r2(r.width), height: r2(r.height) };
};

/** What an element shows or announces: its own text, then the attributes people read. */
function sources(el: Element): [string, string][] {
  const out: [string, string][] = [['text', ownText(el)]];
  for (const a of ['alt', 'aria-label', 'title', 'placeholder'])
    out.push([a, el.getAttribute(a) ?? '']);
  if (el instanceof HTMLInputElement && /^(submit|button|reset)$/.test(el.type))
    out.push(['value', el.value]);
  return out;
}

function matcher(text: string, exact: boolean, caseSensitive: boolean) {
  const want = caseSensitive ? norm(text) : norm(text).toLowerCase();
  return (have: string) => {
    const h = caseSensitive ? norm(have) : norm(have).toLowerCase();
    return exact ? h === want : h.includes(want);
  };
}

const found = (el: Element, matchedOn: string, shown: string) => {
  const c = el.getAttribute('class')?.trim();
  return {
    id: elementId(el),
    tag: el.tagName.toLowerCase(),
    selector: displaySelector(el),
    rect: rectOf(el),
    ...(el.id && { htmlId: el.id }),
    ...(c && { classes: c }),
    matchedOn,
    text: cut(norm(shown), 120),
  };
};

/** Elements whose own text or a reading attribute matches; else the smallest ones whose whole text does. */
export function findByText(
  root: Element,
  text: string,
  { exact, caseSensitive, limit }: { exact: boolean; caseSensitive: boolean; limit: number },
) {
  const is = matcher(text, exact, caseSensitive);
  const all = queryAllDeep(root, '*', isOwnHost).filter(
    (e) => !SKIP_TAGS.includes(e.tagName) && !isOwnHost(e) && e !== document.body,
  );
  let hits: ReturnType<typeof found>[] = [];
  for (const e of all) {
    const hit = sources(e).find(([, v]) => v && is(v));
    if (hit) hits.push(found(e, hit[0], hit[1]));
  }
  if (!hits.length) {
    // text split across inline children ("Save <b>draft</b>"): the innermost element holding all of it
    const withAll = all.filter((e) => is(e.textContent ?? ''));
    hits = withAll
      .filter((e) => !withAll.some((o) => o !== e && e.contains(o)))
      .map((e) => found(e, 'textContent', e.textContent ?? ''));
  }
  return {
    count: hits.length,
    truncated: Math.max(0, hits.length - limit),
    matches: hits.slice(0, limit),
  };
}

const visible = (el: Element) => {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (!(r.width > 0 || r.height > 0)) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && s.display !== 'none';
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const locateCommands: Commands = {
  find_by_text({ text, exact, caseSensitive, limit, rootId }) {
    const root = rootId ? elementOf(rootId, `Root element ${rootId} not found.`) : document.body;
    return findByText(root, text, { exact, caseSensitive, limit });
  },
  scroll_into_view({ elementId: id, block }) {
    const el = elementOf(id);
    el.scrollIntoView({ block, inline: 'nearest', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return {
      scrollX: Math.round(scrollX),
      scrollY: Math.round(scrollY),
      rect: rectOf(el),
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    };
  },
  async wait_for({ selector, state, stable, timeoutMs, quietMs }) {
    const t0 = performance.now();
    const deadline = t0 + timeoutMs;
    let lastChange = t0;
    const bump = () => (lastChange = performance.now());
    const mo = new MutationObserver(bump);
    mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    addEventListener('resize', bump);
    const match = (): Element[] => {
      try {
        return queryAllDeep(document.body, selector!, isOwnHost).filter((e) => !isOwnHost(e));
      } catch (e) {
        return fail(`Invalid selector: ${(e as Error).message}`);
      }
    };
    const selectorMet = (): Element[] | null => {
      if (!selector) return [];
      const m = match();
      switch (state) {
        case 'attached':
          return m.length ? m : null;
        case 'visible': {
          const v = m.filter(visible);
          return v.length ? v : null;
        }
        case 'hidden':
          return m.every((e) => !visible(e)) ? [] : null;
        case 'detached':
          return m.length ? null : [];
      }
    };
    try {
      let hit: Element[] | null = null;
      for (;;) {
        hit ??= selectorMet();
        const now = performance.now();
        const quiet =
          !stable || (document.readyState === 'complete' && now - lastChange >= quietMs);
        if (hit && quiet) {
          return {
            found: true,
            waitedMs: Math.round(now - t0),
            ...(selector && {
              count: hit.length,
              matches: hit.slice(0, 10).map((e) => found(e, 'selector', ownText(e))),
            }),
            ...(stable && { stable: true }),
          };
        }
        if (now >= deadline) {
          return {
            found: false,
            timedOut: true,
            waitedMs: Math.round(now - t0),
            ...(selector && { selectorMet: !!hit }),
            ...(stable && { stable: false }),
          };
        }
        await sleep(50);
      }
    } finally {
      mo.disconnect();
      removeEventListener('resize', bump);
    }
  },
};
