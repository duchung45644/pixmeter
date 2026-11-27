/**
 * MCP tool definitions: one tool per protocol command. The JSON Schemas describe what
 * `validateCall` (protocol.gen.ts, copied from the extension) accepts; the server still runs
 * `validateCall` before sending, so the validator stays the authority.
 */
import {
  ANNOTATION_TYPES,
  INSERT_POSITIONS,
  LIMITS,
  MCP_STATES,
  MCP_TYPES,
  SCROLL_BLOCKS,
  WAIT_STATES,
  type McpType,
} from './protocol.gen.ts';

type Schema = Record<string, unknown>;
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, Schema>; required?: string[] };
}

const int = (description: string): Schema => ({ type: 'integer', description });
const str = (maxLength: number, description: string, minLength = 0): Schema => ({
  type: 'string',
  maxLength,
  ...(minLength ? { minLength } : {}),
  description,
});
const ELEMENT_ID_PATTERN = '^v-[a-z0-9]{1,16}$';
const elementIdS = (description = 'Element id like "v-abc123", from a previous result.') => ({
  type: 'string',
  pattern: ELEMENT_ID_PATTERN,
  description,
});
const tabId = int('Tab id from list_tabs (only tabs where Pixmeter is on).');
const viewportId = int(
  'Responsive mode: run in this viewport frame instead of the one holding the selection.',
);
const limit: Schema = {
  type: 'integer',
  minimum: LIMITS.limitMin,
  maximum: LIMITS.limitMax,
  default: LIMITS.limitDefault,
  description: `Max results (clamped ${LIMITS.limitMin}-${LIMITS.limitMax}).`,
};
const styles: Schema = {
  type: 'object',
  maxProperties: LIMITS.styles,
  additionalProperties: { type: ['string', 'number'], maxLength: LIMITS.styleValue },
  description: 'CSS property → value, e.g. {"color": "red", "--gap": "8px"}.',
};
const ruleRef: Schema = {
  type: 'object',
  description: 'ruleRef exactly as returned by get_element_matched_rules; pass it back unchanged.',
  properties: {
    stylesheet: { type: 'string', maxLength: LIMITS.url },
    selector: { type: 'string', maxLength: LIMITS.selector },
    wrappers: {
      type: 'array',
      maxItems: LIMITS.wrappers,
      items: { type: 'string', maxLength: LIMITS.selector },
    },
    occ: { type: 'integer', minimum: 0 },
    scopeAddress: { type: ['string', 'null'], maxLength: 4 * LIMITS.selector },
  },
  required: ['stylesheet', 'selector', 'wrappers', 'occ', 'scopeAddress'],
};
const selector = str(LIMITS.selector, 'CSS selector.', 1);
const num = (description: string): Schema => ({ type: 'number', description });
const point = (description: string): Schema => ({
  type: 'object',
  description,
  properties: { x: num('Viewport x, CSS px.'), y: num('Viewport y, CSS px.') },
  required: ['x', 'y'],
});
const rectS = (description: string): Schema => ({
  type: 'object',
  description,
  properties: {
    x: num('Left, viewport CSS px.'),
    y: num('Top, viewport CSS px.'),
    width: num('Width, CSS px.'),
    height: num('Height, CSS px.'),
  },
  required: ['x', 'y', 'width', 'height'],
});
const colorS: Schema = {
  type: 'string',
  maxLength: 40,
  description: 'CSS colour, e.g. "#ff3b30" or "rgb(10 20 30)". Optional.',
};
const labelS: Schema = { type: 'string', maxLength: LIMITS.label, description: 'Optional text.' };
/** The region / zoom / overlay options shared by get_screenshot and compare_screenshot. */
const shotProps: Record<string, Schema> = {
  elementId: elementIdS(
    'Capture just this element (scrolled into view first; stitched if taller than the screen).',
  ),
  rect: rectS(
    'Capture just this area, in viewport CSS px (as in measure_* results). Not with elementId.',
  ),
  padding: {
    type: 'number',
    minimum: 0,
    maximum: LIMITS.padding,
    description: 'CSS px of margin around the element or rect (cut at the screen edge).',
  },
  scale: {
    type: 'number',
    minimum: LIMITS.scaleMin,
    maximum: LIMITS.scaleMax,
    description:
      'Zoom of the output over the captured pixels, e.g. 2 or 4 (pixels stay crisp, nothing is smoothed). Longest side is capped at 4000 px.',
  },
  annotations: {
    type: 'boolean',
    description: 'Keep the draw_annotations overlay in the shot (default: it is hidden).',
  },
};
const annotationS: Schema = {
  type: 'object',
  description:
    'One shape. type "box": frame an element (elementId) or area (rect) with optional label. ' +
    'type "distance": measure between elements (elementId + optional toElementId, default the parent: draws the gaps or insets with px labels) or between two points (from + to). ' +
    'type "arrow": from → to with optional label. type "label": text at a point (at) or at an element\'s top-left (elementId).',
  properties: {
    type: { type: 'string', enum: [...ANNOTATION_TYPES] },
    elementId: elementIdS(),
    toElementId: elementIdS('distance: the other element; omit to use the parent.'),
    rect: rectS('box: the area.'),
    from: point('distance / arrow: start.'),
    to: point('distance / arrow: end.'),
    at: point('label: where.'),
    text: str(LIMITS.label, 'label: the text.', 1),
    label: labelS,
    color: colorS,
  },
  required: ['type'],
};
const wrappers: Schema = {
  type: 'array',
  maxItems: LIMITS.wrappers,
  items: { type: 'string', maxLength: LIMITS.selector },
  description: 'At-rule preludes, outermost first, e.g. ["@media (min-width: 768px)"].',
};

/** [description, extra properties, extra required] per command; tabId is added below. */
type Spec = [string, Record<string, Schema>?, string[]?];
const EL: Spec[1] = { elementId: elementIdS(), viewportId };
const SPECS: Record<McpType, Spec> = {
  list_tabs: [
    'List tabs: {tabs: [{tabId, title, url, active, enabled}], canEnable}. Normally only tabs where the user turned Pixmeter on; ' +
      'with canEnable true every web-page tab is listed and you can turn Pixmeter on yourself (enable_tab, or any command does it).',
  ],
  focus_tab: ['Bring a Pixmeter tab to the front.'],
  get_page_info: [
    'Page summary: url, title, lang, meta, h1, viewport, page size, scroll, devicePixelRatio.',
  ],
  get_selected_element: [
    "Summary of the element the user selected in Pixmeter's inspector.",
    { viewportId },
  ],
  get_element_details: ['Full details of one element.', EL, ['elementId']],
  get_elements_details: [
    'Details of several elements: {results, notFound}.',
    {
      elementIds: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITS.elementIds,
        items: { type: 'string', pattern: ELEMENT_ID_PATTERN },
      },
      viewportId,
    },
    ['elementIds'],
  ],
  get_element_outline: [
    'DOM outline below an element (default: body).',
    {
      elementId: elementIdS('Root element id (optional).'),
      maxDepth: { type: 'integer', minimum: 1, maximum: LIMITS.outlineDepth },
      maxChildren: { type: 'integer', minimum: 1, maximum: LIMITS.outlineChildren },
      viewportId,
    },
  ],
  query_selector: [
    'Find elements by CSS selector; returns element ids.',
    { selector, limit, rootId: elementIdS('Search inside this element (optional).'), viewportId },
    ['selector'],
  ],
  get_element_matched_rules: [
    'CSS rules matching an element (≤ 60 by score), with ruleRef for editing, and its inline style.',
    EL,
    ['elementId'],
  ],
  get_breakpoints: ["The page's media-query breakpoints."],
  get_seo_issues: ['SEO issues of the page.'],
  get_meta_tags: ['Meta tags of the page.'],
  get_page_weight: ['Resource sizes of the page.'],
  get_css_custom_properties: ['CSS custom properties (variables) defined by the page.'],
  get_typography: ['Typography of an element.', EL, ['elementId']],
  calculate_specificity: ['Specificity of a CSS selector.', { selector }, ['selector']],
  get_colors: ['Colors used in an element.', EL, ['elementId']],
  get_assets: ['Images and other assets inside an element.', EL, ['elementId']],
  get_layout: ['Box model / flex / grid layout of an element.', EL, ['elementId']],
  force_element_state: [
    'Force a pseudo-class state on an element (null clears it).',
    {
      ...EL,
      state: { type: ['string', 'null'], enum: [...MCP_STATES, null] },
    },
    ['elementId'],
  ],
  detect_technologies: ['Frameworks and libraries detected on the page.'],
  get_a11y_issues: ['Accessibility issues, warnings first, lowest contrast first.', { limit }],
  get_tailwind: ['Tailwind classes for an element.', EL, ['elementId']],
  fetch_stylesheet: [
    'Fetch a public http(s) stylesheet (needs the optional all-sites grant in Pixmeter).',
    { url: str(LIMITS.url, 'Stylesheet URL.', 1) },
    ['url'],
  ],
  enter_responsive_mode: ['Enter responsive mode (several viewports side by side).'],
  exit_responsive_mode: ['Exit responsive mode.'],
  set_viewport: [
    'Resize a viewport (clamped to at least 200×300).',
    {
      width: { type: 'number', exclusiveMinimum: 0 },
      height: { type: 'number', exclusiveMinimum: 0 },
      viewportId,
    },
    ['width', 'height'],
  ],
  get_viewport: ['Current viewport(s).'],
  set_viewports: [
    'Replace the responsive viewport set.',
    {
      viewports: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITS.viewports,
        items: {
          type: 'object',
          properties: {
            width: { type: 'number', exclusiveMinimum: 0 },
            height: { type: 'number', exclusiveMinimum: 0 },
            name: { type: 'string', maxLength: LIMITS.name },
          },
          required: ['width', 'height'],
        },
      },
    },
    ['viewports'],
  ],
  add_viewport: [
    'Add a responsive viewport.',
    {
      width: { type: 'number', exclusiveMinimum: 0 },
      height: { type: 'number', exclusiveMinimum: 0 },
      name: { type: 'string', maxLength: LIMITS.name },
    },
  ],
  remove_viewport: ['Remove a responsive viewport.', { viewportId }, ['viewportId']],
  set_zoom: ['Zoom of responsive mode (clamped 0.25–2).', { zoom: { type: 'number' } }, ['zoom']],
  set_breakpoints_mode: [
    "Show the page's own breakpoints as viewports.",
    { enabled: { type: 'boolean' } },
    ['enabled'],
  ],
  get_my_edits: ['Edits made so far: {edits, ruleChanges, htmlChanges}.'],
  set_text_content: [
    'Replace the text of an element.',
    { ...EL, text: str(LIMITS.text, 'New text.') },
    ['elementId', 'text'],
  ],
  set_inner_html: [
    'Replace the inner HTML of an element (sanitized in the page).',
    { ...EL, html: str(LIMITS.html, 'HTML.') },
    ['elementId', 'html'],
  ],
  insert_html: [
    'Insert HTML next to / inside an element (sanitized).',
    {
      ...EL,
      html: str(LIMITS.html, 'HTML.', 1),
      position: { type: 'string', enum: [...INSERT_POSITIONS] },
    },
    ['elementId', 'html', 'position'],
  ],
  select_element: ["Select an element in Pixmeter's inspector.", EL, ['elementId']],
  get_screenshot: [
    'Screenshot of the visible tab as an image. Plain: the whole visible tab (longest side ≤ 2000 px). ' +
      'With elementId or rect: just that element or area, optionally with padding (CSS px around it) and scale (zoom 2×, 4×); ' +
      'annotations: true keeps the draw_annotations overlay in the shot. The result has a captureId for compare_screenshot. ' +
      'Images are PNG, or JPEG / shrunk when a PNG would not fit the connection limit (the result says so).',
    shotProps,
  ],
  apply_styles: [
    'Set CSS: with ruleRef edits that rule, else the inline style of elementId. Joins undo and is saved per site.',
    {
      elementId: elementIdS(),
      ruleRef,
      styles,
      state: { type: 'string', maxLength: 100, description: 'e.g. ":hover"' },
      media: { type: 'string', maxLength: LIMITS.selector, description: 'Media query prelude.' },
      pseudo: { type: 'string', maxLength: 100, description: 'e.g. "::before"' },
      viewportId,
    },
    ['styles'],
  ],
  add_rule: [
    'Add a new CSS rule.',
    { selector, wrappers, styles, elementId: elementIdS(), viewportId },
    ['selector'],
  ],
  set_rule_selector: [
    'Change the selector of a rule.',
    { ruleRef, selector, viewportId },
    ['ruleRef', 'selector'],
  ],
  revert_css_change: [
    'Revert one change (a recordId from get_my_edits).',
    { changeId: str(200, 'recordId from get_my_edits.', 1) },
    ['changeId'],
  ],
  revert_all_edits: ['Revert every edit; also clears the edits saved for the site.'],
  set_element_classes: [
    'Replace the class attribute of an element.',
    { ...EL, classes: str(LIMITS.classes, 'Space-separated classes.') },
    ['elementId', 'classes'],
  ],
  delete_element: ['Delete an element.', EL, ['elementId']],
  duplicate_element: ['Duplicate an element.', EL, ['elementId']],
  enable_tab: [
    'Turn Pixmeter on in a tab (shows its dock to the user). Only works when list_tabs says canEnable; otherwise ask the user to click the Pixmeter icon.',
  ],
  click_element: [
    'Click an element like a user: scrolls it into view, checks nothing covers it, then fires pointer/mouse/click events. ' +
      'Links navigate, buttons and checkboxes act. After a navigation, call list_tabs again. Events are synthetic (isTrusted false).',
    { ...EL, double: { type: 'boolean', description: 'Double-click.' } },
    ['elementId'],
  ],
  measure_distance: [
    'Distance in CSS px between two elements (what the Pixmeter Distance tool draws): gaps when apart, ' +
      'insets from each edge when one is inside the other. Without toElementId, measures against the parent.',
    { ...EL, toElementId: elementIdS('The other element; omit to use the parent.') },
    ['elementId'],
  ],
  check_contrast: [
    "WCAG contrast of an element's text against the background actually painted under it: ratio, level (AAA/AA/fail), " +
      'large-text rule, and a suggested text colour when it fails.',
    EL,
    ['elementId'],
  ],
  type_text: [
    'Type into an input, textarea, contenteditable or <select> (option value or label). Fires key/input/change events so frameworks see it.',
    {
      ...EL,
      text: str(LIMITS.text, 'Text to type.'),
      clear: {
        type: 'boolean',
        default: true,
        description: 'Replace the current value (default) instead of appending.',
      },
      submit: {
        type: 'boolean',
        default: false,
        description: 'Press Enter afterwards (submits a form).',
      },
    },
    ['elementId', 'text'],
  ],
  press_key: [
    'Press a key on the focused element (or on elementId, focused first): one character or a name like Enter, Escape, Tab, ArrowDown.',
    {
      key: str(LIMITS.key, 'Key, e.g. "Enter", "Escape", "a".', 1),
      elementId: elementIdS(),
      shift: { type: 'boolean' },
      ctrl: { type: 'boolean' },
      alt: { type: 'boolean' },
      meta: { type: 'boolean' },
      viewportId,
    },
    ['key'],
  ],
  scroll_page: [
    'Scroll: elementId brings that element to the middle of the screen; to "top"/"bottom"; or deltaX/deltaY in px. Returns the new scroll position.',
    {
      elementId: elementIdS(),
      to: { type: 'string', enum: ['top', 'bottom'] },
      deltaX: { type: 'number' },
      deltaY: { type: 'number' },
      viewportId,
    },
  ],
  draw_annotations: [
    'Draw an overlay on the page: measuring arrows with px labels, element frames, arrows and text labels. ' +
      'It lives in its own layer and changes nothing in the page. Coordinates are viewport CSS px. ' +
      'Shapes tied to an element follow it on scroll. See it with get_screenshot annotations: true; remove it with clear_annotations. ' +
      'Replaces the previous overlay unless replace is false.',
    {
      annotations: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITS.annotations,
        items: annotationS,
      },
      replace: {
        type: 'boolean',
        default: true,
        description: 'Replace the current overlay (default) instead of adding to it.',
      },
    },
    ['annotations'],
  ],
  clear_annotations: ['Remove the draw_annotations overlay.'],
  get_full_page_screenshot: [
    'Screenshot of the whole page, including the part you have to scroll to. Shrunk or JPEG-compressed when a PNG would not fit ' +
      'the connection limit; for detail on a long page use get_screenshot with elementId or rect. Has a captureId.',
  ],
  compare_screenshot: [
    'Compare the page (same options as get_screenshot, or fullPage) with a reference image: an earlier capture (referenceCaptureId from a ' +
      'previous get_screenshot / get_full_page_screenshot / compare_screenshot) or a mockup file (referencePath, a PNG/JPEG/WebP under 600 KB). ' +
      'Returns diffPercent, differentPixels, the bounds of the difference and a diff image (differences in red). ' +
      'The reference is resized to the capture; aspectMismatch warns when the shapes differ.',
    {
      ...shotProps,
      fullPage: {
        type: 'boolean',
        description: 'Compare the whole page (not with elementId or rect).',
      },
      referenceCaptureId: str(
        LIMITS.captureId,
        'captureId of an earlier capture (the last 6 are kept).',
      ),
      referencePath: str(4096, 'Local path of a mockup image (PNG, JPEG or WebP, under 600 KB).'),
      threshold: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        default: 0.1,
        description: 'Per-pixel colour tolerance (0 strict – 1 lax).',
      },
      tolerancePercent: {
        type: 'number',
        minimum: 0,
        maximum: 100,
        default: 0,
        description: 'Differences up to this percent still count as a match.',
      },
      diffImage: { type: 'boolean', default: true, description: 'Return the diff image.' },
    },
  ],
  get_box_model: [
    'Margin, border, padding and content of an element in one call: each side in px, and the four boxes (x, y, width, height) in viewport coordinates.',
    EL,
    ['elementId'],
  ],
  measure_spacing: [
    'Every spacing between the direct children of an element in one call: the gap between each neighbouring pair, the distinct gap values with counts, ' +
      "the children's inset from the container's edges, and the container's padding / gap CSS. Out-of-flow children are left out.",
    { ...EL, limit },
    ['elementId'],
  ],
  measure_point_to_point: [
    'Distance between two arbitrary points (viewport CSS px, no element needed): dx, dy, length, angle, and the same points in page coordinates.',
    { from: point('Start point.'), to: point('End point.') },
    ['from', 'to'],
  ],
  check_spacing_scale: [
    "Find margin, padding and gap values that are not on the design's spacing scale (a base grid like 4 px, or a token list). " +
      'Scans an element and its descendants (default: the page), groups off-scale values with counts and example elements, and gives the nearest scale value.',
    {
      elementId: elementIdS('Root of the scan (default: the whole page).'),
      base: {
        type: 'number',
        exclusiveMinimum: 0,
        default: 4,
        description: 'On-scale values are multiples of this many px (default 4). Not with values.',
      },
      values: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITS.scaleValues,
        items: { type: 'number', minimum: 0 },
        description: 'Or an explicit list of allowed px values (design tokens).',
      },
      tolerance: {
        type: 'number',
        minimum: 0,
        maximum: 4,
        default: 0.05,
        description: 'px of rounding slack (default 0.05).',
      },
      limit,
      viewportId,
    },
  ],
  find_by_text: [
    'Find elements by what they show: their own text, or alt / aria-label / title / placeholder / button value. Case-insensitive substring by default. ' +
      'Text split across inline children is found too (the innermost element holding it). Returns element ids.',
    {
      text: str(LIMITS.findText, 'Text to look for.', 1),
      exact: {
        type: 'boolean',
        default: false,
        description: 'Whole text must equal it (spaces collapsed).',
      },
      caseSensitive: { type: 'boolean', default: false },
      limit,
      rootId: elementIdS('Search inside this element (optional).'),
      viewportId,
    },
    ['text'],
  ],
  scroll_into_view: [
    'Scroll an element into view (block: start / center / end / nearest, default center). Returns the scroll position, its rect and whether it is fully on screen.',
    { ...EL, block: { type: 'string', enum: [...SCROLL_BLOCKS], default: 'center' } },
    ['elementId'],
  ],
  wait_for: [
    'Wait before measuring or capturing: for a selector to be attached / visible / hidden / detached, and/or for the page to settle (stable: no DOM change or resize for quietMs, document loaded). ' +
      'With no selector it waits for the page to settle. A timeout is a normal result (found: false, timedOut: true), not an error.',
    {
      selector: str(LIMITS.selector, 'CSS selector to wait for (optional).', 1),
      state: { type: 'string', enum: [...WAIT_STATES], default: 'visible' },
      stable: {
        type: 'boolean',
        description:
          'Also wait for the page to go quiet (default: true when there is no selector).',
      },
      timeoutMs: {
        type: 'integer',
        minimum: 0,
        maximum: LIMITS.waitMax,
        default: LIMITS.waitDefault,
      },
      quietMs: { type: 'integer', minimum: 0, maximum: 5000, default: LIMITS.quietDefault },
      viewportId,
    },
  ],
};

const NO_TAB: readonly string[] = ['list_tabs', 'fetch_stylesheet'];

export const COMMAND_TOOLS: ToolDef[] = MCP_TYPES.map((name) => {
  const [description, props = {}, req = []] = SPECS[name];
  const needsTab = !NO_TAB.includes(name);
  const properties: Record<string, Schema> = needsTab ? { tabId, ...props } : { ...props };
  const required = needsTab ? ['tabId', ...req] : req;
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}) },
  };
});

export const PING_TOOL: ToolDef = {
  name: 'ping',
  description: 'Check the link to the Pixmeter extension: whether it is connected and its version.',
  inputSchema: { type: 'object', properties: {} },
};
