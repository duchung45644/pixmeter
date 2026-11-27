import { describe, expect, it } from 'vitest';
import { FORCEABLE_STATES } from '../css/states';
import {
  compareVersion,
  connectPrompt,
  ERR,
  isMcpType,
  isOutdated,
  LIMITS,
  MAX_FRAME_BYTES,
  MCP_STATES,
  MCP_TYPES,
  mcpUrl,
  parseFrame,
  validateCall,
} from './protocol';

// inventory 10.15, verbatim
const LEGACY_10_15 =
  'list_tabs, focus_tab, get_page_info, get_selected_element, get_element_details, get_elements_details, get_element_outline, query_selector, get_element_matched_rules, get_breakpoints, get_seo_issues, get_meta_tags, get_page_weight, get_css_custom_properties, get_typography, calculate_specificity, get_colors, get_assets, get_layout, force_element_state, detect_technologies, get_a11y_issues, get_tailwind, fetch_stylesheet, enter_responsive_mode, exit_responsive_mode, set_viewport, get_viewport, set_viewports, add_viewport, remove_viewport, set_zoom, set_breakpoints_mode, get_my_edits, set_text_content, set_inner_html, insert_html, select_element, get_screenshot, apply_styles, add_rule, set_rule_selector, revert_css_change, revert_all_edits, set_element_classes, delete_element, duplicate_element'.split(
    ', ',
  );

const ruleRef = { stylesheet: 'a.css', selector: '.x', wrappers: [], occ: 0, scopeAddress: null };

describe('commands', () => {
  it('has the 47 legacy names first, then the agent-control and measuring commands', () => {
    expect(MCP_TYPES).toHaveLength(72);
    expect(MCP_TYPES.slice(0, 47)).toEqual(LEGACY_10_15);
    expect(MCP_TYPES.slice(47)).toEqual([
      'enable_tab',
      'click_element',
      'type_text',
      'press_key',
      'scroll_page',
      'measure_distance',
      'check_contrast',
      'draw_annotations',
      'clear_annotations',
      'get_full_page_screenshot',
      'compare_screenshot',
      'get_box_model',
      'measure_spacing',
      'measure_point_to_point',
      'check_spacing_scale',
      'find_by_text',
      'scroll_into_view',
      'wait_for',
      'get_computed_styles',
      'measure_alignment',
      'compare_styles',
      'get_element_at_point',
      'check_text_overflow',
      'hover_element',
      'screenshot_at_breakpoints',
    ]);
    expect(isMcpType('get_page_info')).toBe(true);
    expect(isMcpType('toString')).toBe(false);
  });
  it('keeps the state list in step with the edit engine', () => {
    expect([...MCP_STATES]).toEqual([...FORCEABLE_STATES]);
  });
  it('dials 127.0.0.1 only', () => {
    expect(mcpUrl()).toBe('ws://127.0.0.1:47347/pixmeter');
  });
});

describe('parseFrame', () => {
  it('reads each server frame', () => {
    expect(parseFrame('{"type":"welcome","serverVersion":"0.5.0","client":null}')).toEqual({
      type: 'welcome',
      serverVersion: '0.5.0',
      client: null,
    });
    expect(parseFrame('{"type":"call","id":7,"command":"list_tabs"}')).toEqual({
      type: 'call',
      id: 7,
      command: 'list_tabs',
      payload: {},
    });
    expect(parseFrame('{"type":"client","client":{"name":"claude-code","version":"2"}}')).toEqual({
      type: 'client',
      client: { name: 'claude-code', version: '2' },
    });
    expect(parseFrame('{"type":"ping"}')).toEqual({ type: 'ping' });
    expect(parseFrame('{"type":"reject","reason":"bad token"}')).toEqual({
      type: 'reject',
      reason: 'bad token',
    });
  });
  it.each([
    ['not json', '{'],
    ['not an object', '[1]'],
    ['unknown type', '{"type":"hello"}'],
    ['welcome without version', '{"type":"welcome"}'],
    ['call without id', '{"type":"call","command":"x"}'],
    ['call with object id', '{"type":"call","id":{},"command":"x"}'],
    ['call with fractional id', '{"type":"call","id":1.5,"command":"x"}'],
    ['client with bad agent', '{"type":"client","client":5}'],
    ['non-string', 5],
  ])('drops %s', (_, text) => expect(parseFrame(text)).toBeNull());
  it('drops frames over 1 MB', () => {
    const big = JSON.stringify({
      type: 'call',
      id: 1,
      command: 'x',
      payload: 'a'.repeat(MAX_FRAME_BYTES),
    });
    expect(parseFrame(big)).toBeNull();
    // multi-byte text counts in bytes, not characters
    const wide = JSON.stringify({ type: 'ping', pad: 'é'.repeat(MAX_FRAME_BYTES / 2) });
    expect(parseFrame(wide)).toBeNull();
  });
});

describe('versions', () => {
  it('compares semver', () => {
    expect(compareVersion('0.4.9', '0.5.0')).toBeLessThan(0);
    expect(compareVersion('v0.5.0', '0.5.0')).toBe(0);
    expect(compareVersion('1.0.0-beta.1', '0.5.0')).toBeGreaterThan(0);
    expect(compareVersion('0.10.0', '0.9.0')).toBeGreaterThan(0);
  });
  it('treats non-semver as unknown', () => {
    expect(compareVersion('latest', '0.5.0')).toBeNull();
    expect(compareVersion(undefined, '0.5.0')).toBeNull();
    expect(isOutdated('latest')).toBe(true);
    expect(isOutdated('0.4.0')).toBe(true);
    expect(isOutdated('0.5.0')).toBe(false);
  });
});

describe('validateCall', () => {
  it('rejects unknown commands with the legacy message', () => {
    expect(validateCall('rm_rf', {})).toEqual({ ok: false, error: ERR.unknown });
  });
  it('requires a numeric tabId (legacy wording)', () => {
    expect(validateCall('get_page_info', {})).toEqual({
      ok: false,
      error: 'get_page_info requires a numeric tabId.',
    });
    expect(validateCall('get_page_info', { tabId: '3' })).toMatchObject({ ok: false });
    expect(validateCall('get_page_info', { tabId: 1.5 })).toMatchObject({ ok: false });
    expect(validateCall('list_tabs', undefined)).toEqual({ ok: true, payload: {} });
  });
  it('rejects non-object payloads', () => {
    expect(validateCall('get_page_info', 'x')).toMatchObject({ ok: false });
    expect(validateCall('get_page_info', [1])).toMatchObject({ ok: false });
  });
  it('checks element ids and drops unknown fields', () => {
    expect(validateCall('get_colors', { tabId: 1, elementId: 'body' })).toMatchObject({
      ok: false,
    });
    expect(validateCall('get_colors', { tabId: 1, elementId: 'v-abc', evil: 1 })).toEqual({
      ok: true,
      payload: { tabId: 1, elementId: 'v-abc' },
    });
  });
  it('clamps limit to 1–200, default 50', () => {
    const lim = (limit: unknown) => {
      const r = validateCall('get_a11y_issues', { tabId: 1, limit });
      return r.ok ? r.payload.limit : null;
    };
    expect(lim(undefined)).toBe(50);
    expect(lim(0)).toBe(1);
    expect(lim(1000)).toBe(200);
    expect(lim('x')).toBe(50);
    expect(lim(12.7)).toBe(12);
  });
  it('caps selector and html sizes', () => {
    const sel = 'a'.repeat(LIMITS.selector + 1);
    expect(validateCall('query_selector', { tabId: 1, selector: sel })).toMatchObject({
      ok: false,
    });
    expect(validateCall('query_selector', { tabId: 1, selector: '' })).toMatchObject({ ok: false });
    const html = 'a'.repeat(LIMITS.html + 1);
    expect(validateCall('set_inner_html', { tabId: 1, elementId: 'v-a', html })).toMatchObject({
      ok: false,
    });
    expect(validateCall('set_inner_html', { tabId: 1, elementId: 'v-a', html: '' })).toMatchObject({
      ok: true,
    });
  });
  it('checks insert positions', () => {
    expect(
      validateCall('insert_html', { tabId: 1, elementId: 'v-a', html: '<b>', position: 'inside' }),
    ).toEqual({ ok: false, error: 'Bad position: inside. Use before/after/prepend/append.' });
  });
  it('checks styles and rule refs', () => {
    expect(validateCall('apply_styles', { tabId: 1, styles: { color: 'red' } })).toEqual({
      ok: false,
      error: 'apply_styles requires elementId or ruleRef.',
    });
    expect(
      validateCall('apply_styles', { tabId: 1, elementId: 'v-a', styles: { 'co lor': 'red' } }),
    ).toMatchObject({ ok: false });
    expect(
      validateCall('apply_styles', { tabId: 1, elementId: 'v-a', styles: 'color:red' }),
    ).toMatchObject({
      ok: false,
    });
    expect(
      validateCall('apply_styles', { tabId: 1, ruleRef: { ...ruleRef, occ: -1 }, styles: {} }),
    ).toMatchObject({ ok: false });
    expect(
      validateCall('apply_styles', { tabId: 1, ruleRef, styles: { '--x': 1, color: 'red' } }),
    ).toEqual({ ok: true, payload: { tabId: 1, ruleRef, styles: { '--x': '1', color: 'red' } } });
    expect(validateCall('set_rule_selector', { tabId: 1, selector: '.y' })).toMatchObject({
      ok: false,
    });
  });
  it('checks responsive arguments', () => {
    expect(validateCall('set_viewport', { tabId: 1, width: 0, height: 10 })).toEqual({
      ok: false,
      error: 'set_viewport requires positive numeric width and height.',
    });
    expect(validateCall('set_viewports', { tabId: 1, viewports: [] })).toMatchObject({ ok: false });
    expect(
      validateCall('set_viewports', { tabId: 1, viewports: [{ width: 300, height: 'x' }] }),
    ).toMatchObject({ ok: false });
    expect(validateCall('set_breakpoints_mode', { tabId: 1, enabled: 'yes' })).toMatchObject({
      ok: false,
    });
    expect(validateCall('remove_viewport', { tabId: 1 })).toMatchObject({ ok: false });
  });
  it('checks forced states and id lists', () => {
    expect(
      validateCall('force_element_state', { tabId: 1, elementId: 'v-a', state: ':hover' }),
    ).toMatchObject({ ok: true });
    expect(
      validateCall('force_element_state', { tabId: 1, elementId: 'v-a', state: ':evil' }),
    ).toMatchObject({ ok: false });
    expect(
      validateCall('get_elements_details', { tabId: 1, elementIds: ['v-a', 3] }),
    ).toMatchObject({ ok: false });
    const many = Array.from({ length: 51 }, (_, i) => `v-${i}`);
    expect(validateCall('get_elements_details', { tabId: 1, elementIds: many })).toMatchObject({
      ok: false,
    });
  });
  it('checks the agent-control payloads', () => {
    expect(validateCall('measure_distance', { tabId: 1, elementId: 'v-a' })).toEqual({
      ok: true,
      payload: { tabId: 1, elementId: 'v-a' },
    });
    expect(
      validateCall('measure_distance', { tabId: 1, elementId: 'v-a', toElementId: 'x' }).ok,
    ).toBe(false);
    expect(validateCall('click_element', { tabId: 1, elementId: 'v-a' })).toEqual({
      ok: true,
      payload: { tabId: 1, elementId: 'v-a', double: false },
    });
    expect(validateCall('type_text', { tabId: 1, elementId: 'v-a', text: '' })).toMatchObject({
      ok: true,
      payload: { clear: true, submit: false },
    });
    expect(validateCall('press_key', { tabId: 1, key: 'ArrowDown' })).toMatchObject({ ok: true });
    expect(validateCall('press_key', { tabId: 1, key: 'a' })).toMatchObject({ ok: true });
    expect(validateCall('press_key', { tabId: 1, key: 'rm -rf' })).toMatchObject({ ok: false });
    expect(validateCall('scroll_page', { tabId: 1 })).toMatchObject({ ok: false });
    expect(validateCall('scroll_page', { tabId: 1, to: 'middle' })).toMatchObject({ ok: false });
    expect(validateCall('scroll_page', { tabId: 1, deltaY: 1e9 })).toMatchObject({
      ok: true,
      payload: { deltaY: 100_000 },
    });
  });
  it('checks get_screenshot options', () => {
    expect(validateCall('get_screenshot', { tabId: 1 })).toEqual({
      ok: true,
      payload: { tabId: 1 },
    });
    const rect = { x: 1, y: 2, width: 30, height: 40 };
    expect(
      validateCall('get_screenshot', { tabId: 1, rect, padding: 8, scale: 2, annotations: true }),
    ).toEqual({ ok: true, payload: { tabId: 1, rect, padding: 8, scale: 2, annotations: true } });
    const bad = (extra: object) => validateCall('get_screenshot', { tabId: 1, ...extra }).ok;
    expect(bad({ elementId: 'v-a', rect })).toBe(false);
    expect(bad({ scale: 0 })).toBe(false);
    expect(bad({ scale: 9 })).toBe(false);
    expect(bad({ padding: -1 })).toBe(false);
    expect(bad({ rect: { x: 0, y: 0, width: -1, height: 2 } })).toBe(false);
  });
  it('checks draw_annotations', () => {
    const ok = (annotations: unknown) =>
      validateCall('draw_annotations', { tabId: 1, annotations });
    expect(
      ok([{ type: 'arrow', from: { x: 0, y: 0 }, to: { x: 5, y: 5 }, color: '#ff0000' }]),
    ).toMatchObject({
      ok: true,
      payload: { replace: true },
    });
    expect(ok([{ type: 'distance', elementId: 'v-a', toElementId: 'v-b' }]).ok).toBe(true);
    expect(ok([{ type: 'distance', from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }]).ok).toBe(true);
    expect(ok([]).ok).toBe(false);
    expect(ok([{ type: 'box' }]).ok).toBe(false); // needs an element or a rect
    expect(ok([{ type: 'distance', elementId: 'v-a', from: { x: 0, y: 0 } }]).ok).toBe(false);
    expect(ok([{ type: 'star' }]).ok).toBe(false);
    expect(ok([{ type: 'label', text: 'x', at: { x: 1, y: 1 }, color: 'red;}' }]).ok).toBe(false);
    expect(
      ok(Array.from({ length: 101 }, () => ({ type: 'label', text: 'x', at: { x: 0, y: 0 } }))).ok,
    ).toBe(false);
  });
  it('checks compare_screenshot', () => {
    const v = (extra: object) => validateCall('compare_screenshot', { tabId: 1, ...extra });
    expect(v({ referenceCaptureId: 'shot-2' })).toMatchObject({
      ok: true,
      payload: { threshold: 0.1, tolerancePercent: 0, diffImage: true, fullPage: false },
    });
    expect(v({}).ok).toBe(false);
    expect(v({ referenceCaptureId: 'a', referenceDataUrl: 'data:image/png;base64,AA' }).ok).toBe(
      false,
    );
    expect(v({ referenceDataUrl: 'data:text/html;base64,AA' }).ok).toBe(false);
    expect(v({ referenceDataUrl: 'data:image/png;base64,AA' }).ok).toBe(true);
    expect(v({ referenceCaptureId: 'a', threshold: 2 }).ok).toBe(false);
    expect(v({ referenceCaptureId: 'a', fullPage: true, elementId: 'v-a' }).ok).toBe(false);
  });
  it('checks the measuring and waiting payloads', () => {
    expect(
      validateCall('measure_point_to_point', { tabId: 1, from: { x: 0 }, to: { x: 1, y: 1 } }).ok,
    ).toBe(false);
    expect(validateCall('check_spacing_scale', { tabId: 1 })).toMatchObject({
      ok: true,
      payload: { base: 4, tolerance: 0.05 },
    });
    expect(validateCall('check_spacing_scale', { tabId: 1, values: [4, 8, 12] })).toMatchObject({
      ok: true,
      payload: { values: [4, 8, 12] },
    });
    expect(validateCall('check_spacing_scale', { tabId: 1, values: [4], base: 8 }).ok).toBe(false);
    expect(validateCall('check_spacing_scale', { tabId: 1, values: [-4] }).ok).toBe(false);
    expect(validateCall('wait_for', { tabId: 1 })).toMatchObject({
      ok: true,
      payload: { stable: true },
    });
    expect(validateCall('wait_for', { tabId: 1, selector: '.a' })).toMatchObject({
      ok: true,
      payload: { state: 'visible', stable: false, timeoutMs: 5000 },
    });
    expect(
      validateCall('wait_for', { tabId: 1, selector: '.a', stable: false, timeoutMs: 99_999 }).ok,
    ).toBe(false);
    expect(validateCall('wait_for', { tabId: 1, selector: '.a', state: 'gone' }).ok).toBe(false);
    expect(validateCall('scroll_into_view', { tabId: 1, elementId: 'v-a' })).toMatchObject({
      payload: { block: 'center' },
    });
    expect(validateCall('scroll_into_view', { tabId: 1, elementId: 'v-a', block: 'top' }).ok).toBe(
      false,
    );
  });
  it('validates the inspection and breakpoint commands', () => {
    const v = (t: string, p: object) => validateCall(t, { tabId: 1, ...p });
    expect(
      v('get_computed_styles', { elementIds: ['v-a'], properties: ['Font-Size', 'font-size'] }),
    ).toMatchObject({ payload: { properties: ['font-size'] } });
    expect(v('get_computed_styles', { elementIds: ['v-a'], properties: ['a;b'] }).ok).toBe(false);
    expect(v('get_computed_styles', { elementIds: ['v-a'] }).ok).toBe(false);
    expect(v('measure_alignment', { elementIds: ['v-a'] }).ok).toBe(false);
    expect(v('measure_alignment', { elementIds: ['v-a', 'v-b'] })).toMatchObject({
      payload: { tolerance: 0.5 },
    });
    expect(
      v('compare_styles', {
        elementId: 'v-a',
        otherElementId: 'v-b',
        properties: ['color'],
        ignore: ['top'],
      }).ok,
    ).toBe(false);
    expect(v('get_element_at_point', { x: 1 }).ok).toBe(false);
    expect(v('hover_element', { elementId: 'v-a' })).toMatchObject({ payload: { hover: true } });
    expect(v('screenshot_at_breakpoints', {})).toMatchObject({
      payload: { widths: [375, 768, 1280], height: 800 },
    });
    expect(v('screenshot_at_breakpoints', { widths: [100] }).ok).toBe(false);
  });
  it('accepts a valid payload for every command', () => {
    const base = { tabId: 1, elementId: 'v-a', selector: '.a', url: 'https://a.b/c.css' };
    const extra: Record<string, object> = {
      get_elements_details: { elementIds: ['v-a'] },
      set_viewport: { width: 300, height: 400 },
      set_viewports: { viewports: [{ width: 300, height: 400 }] },
      remove_viewport: { viewportId: 1 },
      set_zoom: { zoom: 1 },
      set_breakpoints_mode: { enabled: true },
      set_text_content: { text: 'x' },
      set_inner_html: { html: 'x' },
      insert_html: { html: 'x', position: 'append' },
      apply_styles: { styles: { color: 'red' } },
      set_rule_selector: { ruleRef },
      revert_css_change: { changeId: 'r1' },
      set_element_classes: { classes: 'a b' },
      type_text: { text: 'hi' },
      press_key: { key: 'Enter' },
      scroll_page: { deltaY: 300 },
      draw_annotations: { annotations: [{ type: 'box', elementId: 'v-a' }] },
      compare_screenshot: { referenceCaptureId: 'shot-1' },
      measure_point_to_point: { from: { x: 0, y: 0 }, to: { x: 3, y: 4 } },
      find_by_text: { text: 'Save' },
      wait_for: { selector: '.a' },
      get_computed_styles: { elementIds: ['v-a'], properties: ['color'] },
      measure_alignment: { elementIds: ['v-a', 'v-b'] },
      compare_styles: { otherElementId: 'v-b' },
      get_element_at_point: { x: 10, y: 20 },
    };
    for (const t of MCP_TYPES)
      expect(validateCall(t, { ...base, ...extra[t] }), t).toMatchObject({ ok: true });
  });
});

it('puts the token and extension id in the prompt', () => {
  const p = connectPrompt('T'.repeat(43), 'abcdef');
  expect(p).toContain('npx -y @pixmeter/mcp-server --extension-id abcdef');
  expect(p).toContain(`PIXMETER_MCP_TOKEN=${'T'.repeat(43)}`);
});
