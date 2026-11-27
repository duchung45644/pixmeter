# Pixmeter MCP channel — protocol 1

How the Pixmeter extension talks to a local MCP server. The code is the source of truth:
`src/lib/mcp/protocol.ts` holds the constants, the frame types, `parseFrame`, `validateCall`
(the exact payload of every command) and `connectPrompt`. This page explains it for whoever
builds the server.

```
agent ⇄ (stdio, MCP) ⇄ server ⇄ (WebSocket, this protocol) ⇄ extension background ⇄ tab
```

## Transport

| Item | Value |
| --- | --- |
| Server role | WebSocket **server**, bound to `127.0.0.1` only (never `0.0.0.0` / `::`) |
| Extension role | WebSocket **client** in the background service worker |
| URL | `ws://127.0.0.1:47347/pixmeter` (`MCP_PORT`, `MCP_PATH`). The extension never dials `localhost`. |
| Frames | UTF-8 JSON text, one object per message, ≤ 1 MB (`MAX_FRAME_BYTES`). Bigger, binary, non-JSON or unknown frames are dropped with no reply. |
| Keep-alive | Server sends `{"type":"ping"}` about every 20 s; extension replies `{"type":"pong"}`. Chrome ≥ 116 keeps the worker alive while the socket has traffic. |

If the port is taken the server must exit with a clear error. There is no port range.

## Security (all required)

1. **Origin check at upgrade.** Chrome sends `Origin: chrome-extension://<extension id>` on the
   WebSocket handshake and a web page cannot forge it. The server must answer anything else with
   HTTP 403 and no upgrade. The extension id comes from the copied prompt (`--extension-id`).
   This is what stops a web page from opening `ws://127.0.0.1:47347/pixmeter`.
2. **Pairing token.** The extension creates the token once, the first time the user presses
   Connect: 32 bytes from `crypto.getRandomValues`, unpadded base64url (43 chars, `TOKEN_RE`),
   stored in `chrome.storage.local` (`mcpToken`). It only reaches the user inside the copy prompt,
   which passes it as the env var `PIXMETER_MCP_TOKEN`. The server compares it in constant time
   (`crypto.timingSafeEqual` on equal-length buffers). Wrong token or wrong `protocol` → send
   `reject` and close. The token stops another local process that grabs the port first from
   posing as the server, and the Origin stops web pages.
3. **No calls before `welcome`.** The extension ignores `call` until it got `welcome`, and gives up
   on the handshake after 5 s (`HANDSHAKE_TIMEOUT_MS`).
4. **Neither side logs the token.**
5. **Opt-in.** The extension opens no socket and runs no timer until the user presses Connect
   (dock popover or settings page). Disconnect closes the socket right away.
6. **Tab scope.** By default tab commands only reach tabs where the user turned Pixmeter on, and
   `list_tabs` lists only those. Only when the user turns on **Let the agent turn Pixmeter on** in
   the settings (off by default; turning it on also asks for the `<all_urls>` grant) does
   `list_tabs` list every web-page tab with `enabled`, `enable_tab` inject Pixmeter, and a command
   sent to a tab where it is off turn it on first. Revoking `<all_urls>` switches this off again.
   Browser pages, the extension stores and `file://` are never injected.

## Frames

Extension → server

```jsonc
{ "type": "hello", "protocol": 1, "token": "<43 chars>", "extVersion": "2.0.0" } // first frame
{ "type": "pong" }
{ "type": "result", "id": 7, "ok": true, "data": { /* command result */ } }
{ "type": "result", "id": 7, "ok": false, "error": "Pixmeter is not active on this tab." }
```

Server → extension

```jsonc
{ "type": "welcome", "serverVersion": "0.5.0", "client": { "name": "claude-code", "version": "2.1.0" } } // client may be null
{ "type": "reject", "reason": "bad token" }   // then close
{ "type": "call", "id": 7, "command": "get_page_info", "payload": { "tabId": 123 } }
{ "type": "client", "client": { "name": "cursor", "version": "1.0" } } // agent identified / changed
{ "type": "ping" }
```

- `id` is chosen by the server: a non-empty string of ≤ 64 chars or a safe integer. The extension
  sends **exactly one** `result` per call, even on timeout (12 s, or 40 s for `get_screenshot`,
  `enter_responsive_mode`, `exit_responsive_mode`, `set_viewport`).
- If the socket closes while calls are pending, the extension drops them; the server should fail
  them for the agent.
- `serverVersion` lower than `0.5.0` (`MIN_MCP_SERVER_VERSION`), or not semver, keeps the
  connection but shows "MCP out of date" to the user.
- Reconnect: the extension retries 1 s, 2 s, 4 s … up to 30 s while the user's Connect intent is
  on and the worker is alive. After `reject` it stops until the user presses Connect again.

## Commands

`MCP_TYPES` lists the 72 command names (the 47 legacy ones, 5 agent-control ones, measure_distance and check_contrast, then 11 for annotating, comparing and measuring, then 7 for inspecting); `validateCall(command, payload)` is the schema. Every
command except `list_tabs` and `fetch_stylesheet` needs `tabId` (an integer from `list_tabs`);
without it the error is "`<command>` requires a numeric tabId.". Unknown fields are dropped.
An unknown command gives "Unknown action. Update the Pixmeter extension to the latest version.".

Common fields:

- `elementId`: `v-` + 1–16 lowercase alphanumerics, as returned by results (`id`).
- `viewportId` (optional, integer): in responsive mode, run element / edit commands in this
  viewport's frame instead of the frame holding the selection.
- `limit`: clamped to 1–200, default 50.
- `selector` ≤ 1000 chars; `html` / `text` ≤ 200 KB; `styles` ≤ 200 properties, values ≤ 4000 chars.
- `ruleRef`: object `{stylesheet, selector, wrappers, occ, scopeAddress}` returned by
  `get_element_matched_rules`; pass it back unchanged.

| Command | Payload (besides `tabId`) | Notes |
| --- | --- | --- |
| `list_tabs` | — (no tabId) | `{tabs: [{tabId, title, url, active, enabled}], canEnable}`; every web tab when `canEnable`, else Pixmeter tabs only |
| `enable_tab` | — | turns Pixmeter on (shows the dock); `{success, alreadyOn}`; needs `canEnable` |
| `focus_tab` | — | Pixmeter tabs only |
| `fetch_stylesheet` | `url` (no tabId) | http(s), public hosts only; needs the optional `<all_urls>` grant |
| `get_page_info` | — | url, title, lang, meta, h1, viewport, page size, scroll, DPR |
| `get_selected_element` | `viewportId?` | summary of the user's selection |
| `get_element_details` | `elementId`, `viewportId?` | |
| `get_elements_details` | `elementIds` (1–50), `viewportId?` | `{results, notFound}` |
| `get_element_outline` | `elementId?`, `maxDepth?` (1–10), `maxChildren?` (1–100), `viewportId?` | |
| `query_selector` | `selector`, `limit?`, `rootId?`, `viewportId?` | |
| `get_element_matched_rules` | `elementId`, `viewportId?` | ≤ 60 rules by score, `truncated`, `inlineStyle` |
| `get_breakpoints`, `get_seo_issues`, `get_meta_tags`, `get_page_weight`, `get_css_custom_properties`, `detect_technologies` | — | top frame |
| `get_typography`, `get_colors`, `get_assets`, `get_layout`, `get_tailwind` | `elementId`, `viewportId?` | |
| `calculate_specificity` | `selector` | |
| `force_element_state` | `elementId`, `state` (`:hover` … `:visited` or null) | |
| `get_a11y_issues` | `limit?` | grouped, warnings first, lowest contrast first |
| `enter_responsive_mode`, `exit_responsive_mode`, `get_viewport` | — | |
| `set_viewport` | `width`, `height`, `viewportId?` | clamped to ≥ 200×300 |
| `set_viewports` | `viewports: [{width, height, name?}]` (1–20) | |
| `add_viewport` | `width?`, `height?`, `name?` | |
| `remove_viewport` | `viewportId` | |
| `set_zoom` | `zoom` | clamped 0.25–2 |
| `set_breakpoints_mode` | `enabled` | |
| `get_my_edits` | — | `{edits, ruleChanges, htmlChanges}` |
| `set_text_content` | `elementId`, `text` | |
| `set_inner_html` | `elementId`, `html` | sanitized in the page |
| `insert_html` | `elementId`, `html`, `position` (`before`/`after`/`prepend`/`append`) | sanitized |
| `select_element` | `elementId` | selects it in the inspector |
| `get_screenshot` | `elementId?` or `rect?` (`{x,y,width,height}`, viewport CSS px), `padding?` (0–500), `scale?` (0.1–8), `annotations?` | no options: PNG data URL of the visible tab, longest side ≤ 2000 px. With `elementId` (scrolled into view; stitched when taller than the screen) or `rect`: just that area plus `padding`, zoomed by `scale` (nearest-neighbour above 1×, longest side ≤ 4000 px). `annotations: true` keeps the overlay. Result: `{dataUrl, width, height, mimeType, captureId, region?, …}`. A PNG over the frame budget (`FRAME_DATA_BUDGET`, 900 000 chars) becomes a JPEG, then shrinks; `reduced` says so |
| `apply_styles` | `styles`, and `ruleRef` or `elementId`; `state?`, `media?`, `pseudo?` | ruleRef edits that rule, else the inline style |
| `add_rule` | `selector`, `wrappers?`, `styles?`, `elementId?` | |
| `set_rule_selector` | `ruleRef`, `selector` | |
| `revert_css_change` | `changeId` (a `recordId` from `get_my_edits`) | |
| `revert_all_edits` | — | also clears the edits saved for the site |
| `set_element_classes` | `elementId`, `classes` | |
| `delete_element`, `duplicate_element` | `elementId` | |
| `click_element` | `elementId`, `double?` | scrolls into view, refuses when covered, then pointer/mouse/click events; replies before dispatching (a navigation cannot lose the reply) |
| `type_text` | `elementId`, `text`, `clear?` (default true), `submit?` | input / textarea / contenteditable, or a `<select>` option by value or label; native value setter + key/input/change events |
| `press_key` | `key` (one character or a name such as `Enter`), `elementId?`, `shift?` `ctrl?` `alt?` `meta?` | on the focused element; Enter submits a form, Tab moves focus |
| `scroll_page` | `elementId?` or `to?` (`top`/`bottom`) or `deltaX?`/`deltaY?` | returns `{scrollX, scrollY, scrollHeight, viewportHeight}` |
| `measure_distance` | `elementId`, `toElementId?` (default: the parent) | `{from, to, relation: apart\|overlapping\|inside\|contains, gap{horizontal,vertical} or insets{top,right,bottom,left}, direction}` in CSS px |
| `draw_annotations` | `annotations` (1–100 of `box` / `distance` / `arrow` / `label`), `replace?` (default true) | overlay in its own shadow host (`pixmeter-annotations`), `pointer-events: none`, page DOM untouched; element shapes follow scroll / resize; top page only. `{shown, note}` |
| `clear_annotations` | — | `{cleared}` |
| `get_full_page_screenshot` | — | whole page height (debugger route, else scroll-and-stitch); same size rules as `get_screenshot`; has a `captureId`. 40 s timeout |
| `compare_screenshot` | the `get_screenshot` options or `fullPage?`; one of `referenceCaptureId` (an earlier `captureId`; the last 6 are kept in the page) or `referenceDataUrl` (PNG / JPEG / WebP ≤ 800 000 chars); `threshold?` (0–1, default 0.1), `tolerancePercent?` (default 0), `diffImage?` (default true) | `{diffPercent, differentPixels, totalPixels, match, differenceBounds, reference, resized?, aspectMismatch?, current{captureId}, dataUrl}` — `dataUrl` is the diff image, differences in red. The MCP server turns its own `referencePath` (a local file) into `referenceDataUrl` |
| `get_box_model` | `elementId`, `viewportId?` | `{margin, border, padding}` sides in px, `boxes{margin, border, padding, content}` as `{x,y,width,height}`, `boxSizing`, `transformed` |
| `measure_spacing` | `elementId`, `limit?`, `viewportId?` | `{container, layout, children, gaps[{from,to,relation,gap,direction}], distinctGaps[{value,count}], insets, truncated}`; out-of-flow children are skipped |
| `measure_point_to_point` | `from`, `to` (`{x,y}`) | `{dx, dy, distance, angle, page{from,to}}`; runs in the top page |
| `check_spacing_scale` | `elementId?`, `base?` (default 4) or `values?` (≤ 50), `tolerance?` (default 0.05), `limit?`, `viewportId?` | off-scale margin / padding / gap grouped by value: `{offenders[{value,count,nearest,properties,examples}], offScaleValues, checkedElements}` |
| `find_by_text` | `text`, `exact?`, `caseSensitive?`, `limit?`, `rootId?`, `viewportId?` | own text, `alt`, `aria-label`, `title`, `placeholder`, button `value`; falls back to the innermost element whose whole text matches |
| `scroll_into_view` | `elementId`, `block?` (`start`/`center`/`end`/`nearest`, default center) | `{scrollX, scrollY, rect, inViewport}` |
| `wait_for` | `selector?`, `state?` (`attached`/`visible`/`hidden`/`detached`, default visible), `stable?` (default true without a selector), `timeoutMs?` (≤ 20 000, default 5000), `quietMs?` (default 300), `viewportId?` | `{found, waitedMs, …}`; a timeout is `{found: false, timedOut: true}`, not an error. 40 s command timeout |
| `get_computed_styles` | `elementIds` (≤ 50), `properties` (≤ 50 names), `viewportId?` | `{properties, elements: [{id, tag, selector, styles}]}`; a gone id gives `{id, error}` |
| `measure_alignment` | `elementIds` (2–50), `tolerance?` (px, default 0.5), `viewportId?` | `{items, edges: {left, centerX, right, top, centerY, bottom: {aligned, spread, at, offsets}}, alignedOn, sameWidth, sameHeight}` |
| `compare_styles` | `elementId`, `otherElementId`, `properties?` or `ignore?`, `viewportId?` | `{identical, differences: [{property, a, b}], compared}` |
| `get_element_at_point` | `x`, `y` (viewport CSS px), `limit?` (≤ 20), `viewportId?` | `{element, stack, total}` |
| `check_text_overflow` | `elementId?`, `limit?`, `viewportId?` | `{scanned, issues: [{id, kinds, hiddenPx, client, scroll, text}]}`; kinds: `clipped-x`, `clipped-y`, `ellipsis`, `line-clamp`, `spills-x` |
| `hover_element` | `elementId`, `hover?` (default true), `viewportId?` | `{success, hover, target}`; sends mouseover/mouseenter/mousemove and forces `:hover` CSS |
| `screenshot_at_breakpoints` | `widths?` (1–6, default 375/768/1280), `height?` (300–3000, default 800) | one image with a frame per width, plus the viewports; stays in responsive mode. 40 s command timeout |
| `check_contrast` | `elementId` | `{foreground, background, ratio, level: AAA\|AA\|fail, largeText, required, suggestedForeground?}`; `background: null` over an image |

Agent input is synthetic (`isTrusted` is false): sites that check it ignore these events. Pixmeter's
own listeners (inspector click-to-select, measure, ruler, keyboard shortcuts, drag guard) let agent
events through to the page, so a click is not swallowed by the inspector and a typed "1" does not
switch tools.

Edits from MCP go through the same edit handlers as the side panel: they show in the side panel's
change list and are saved per site. Only HTML edits (`set_text_content`, `set_inner_html`,
`insert_html`, `set_element_classes`, `delete_element`, `duplicate_element`) join the engine's
undo / redo history (Ctrl+Z). Rule and inline style edits (`apply_styles`, `add_rule`,
`set_rule_selector`) are not in that history; revert them from the Changes list, or with
`revert_css_change` / `revert_all_edits`.

## Copy prompt

`connectPrompt(token, extensionId)` builds the text the user pastes into the agent, for example:

```
Add the Pixmeter MCP server to this agent. Command: npx -y @pixmeter/mcp-server --extension-id <id>
with environment variable PIXMETER_MCP_TOKEN=<token> (stdio transport, requires Node 18 or newer).
After adding it, call its ping tool to verify the connection.
```

The server reads `PIXMETER_MCP_TOKEN` and `--extension-id` (and an optional `--port`).

## Server (`packages/mcp-server`)

The reference server lives in this repo as its own pnpm workspace package, with its own
dependencies (`@modelcontextprotocol/sdk`, `ws`); the extension bundle does not include it. Its
build copies `src/lib/mcp/protocol.ts` to `src/protocol.gen.ts`, so frames, limits and
`validateCall` are the extension's own code.

- One MCP tool per command (same name, JSON Schema mirroring `validateCall`), plus `ping`.
  The server runs `validateCall` before sending, so a bad call never reaches the extension.
- Results are JSON text; a result with a `dataUrl` (screenshots, the compare diff) comes back as an MCP image block.
- `compare_screenshot` also takes `referencePath`, a mockup file on the server's machine: the server reads it
  (PNG / JPEG / WebP by magic bytes, under 600 KB, since it must fit one frame) and sends it as `referenceDataUrl`.
- When the agent initializes, the server sends `client` (or puts it in `welcome`).
- A newer authenticated extension socket replaces the old one; pending calls fail with
  `ERR.disconnected`. The server waits the extension timeout + 5 s before failing a call itself.
- It exits when stdin closes (the agent quit) and when the port is taken.

Run from a checkout (before the package is published):

```sh
corepack pnpm install
corepack pnpm --filter @pixmeter/mcp-server build
corepack pnpm --filter @pixmeter/mcp-server test
```

Agent config for a local build (e.g. `.mcp.json` / Claude Desktop):

```json
{
  "mcpServers": {
    "Pixmeter": {
      "command": "node",
      "args": ["/path/to/ruler/packages/mcp-server/dist/cli.js", "--extension-id", "<id>"],
      "env": { "PIXMETER_MCP_TOKEN": "<token>" }
    }
  }
}
```
