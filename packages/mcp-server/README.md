# @pixmeter/mcp-server

Let an AI agent (Claude Code, Claude Desktop, Cursor, VS Code, …) see and work with the page open
in your browser through the [Pixmeter](https://github.com/duchung45644/pixmeter) extension: inspect
elements and their CSS, measure spacing, check contrast and accessibility, take screenshots, try CSS
changes live, and click, type and scroll.

The server speaks MCP over stdio to the agent and listens on `127.0.0.1` only for the extension.
Nothing leaves your machine.

## Setup

1. Install Pixmeter in Chrome or Edge and turn it on in a tab.
2. In Pixmeter, open the **MCP** popover on the dock and press **Copy**. The copied prompt holds
   your extension ID and a private token.
3. Paste it into your agent, or add the server to its config yourself:

```json
{
  "mcpServers": {
    "Pixmeter": {
      "command": "npx",
      "args": ["-y", "@pixmeter/mcp-server", "--extension-id", "<extension id>"],
      "env": { "PIXMETER_MCP_TOKEN": "<token from Pixmeter>" }
    }
  }
}
```

Claude Code:

```sh
claude mcp add Pixmeter -e PIXMETER_MCP_TOKEN=<token> -- npx -y @pixmeter/mcp-server --extension-id <id>
```

4. Ask the agent to call `ping` to check the connection, then `list_tabs`.

## Options

| Option                     | Required | Description                                      |
| -------------------------- | -------- | ------------------------------------------------ |
| `--extension-id <id>`      | yes      | The Pixmeter extension ID (32 letters a–p).      |
| `PIXMETER_MCP_TOKEN` (env) | yes      | The token shown by Pixmeter. Keep it private.    |
| `--port <n>`               | no       | WebSocket port on 127.0.0.1 (default **47347**). |

## What the agent can do

- **Tabs:** list tabs, focus one, and (if you allow it in Pixmeter settings) turn Pixmeter on.
- **Inspect:** element details and outline, matched CSS rules and specificity, layout, Tailwind
  classes, typography, colors, CSS variables, assets, breakpoints, detected technologies.
- **Measure:** distance in px between two elements (or to the parent's edges), the full box model of
  an element, every gap and inset between its children in one call, and the distance between any
  two points. `check_spacing_scale` lists margins, paddings and gaps that are off your spacing grid
  (4 px, or a token list).
- **Annotate:** `draw_annotations` puts measuring arrows, element frames and labels in an overlay on
  the page (nothing in the page changes); `clear_annotations` removes it.
- **Check:** text contrast against the real background (WCAG ratio, AA/AAA, suggested fix),
  accessibility and SEO issues, meta tags, page weight.
- **See:** screenshots of the page, one element or one area (with padding and 2×/4× zoom, with or
  without the annotations), the full page, returned as images; responsive mode with several
  viewports at once.
- **Compare:** `compare_screenshot` diffs the page against an earlier capture or a mockup file
  (`referencePath`, under 600 KB) and returns the percentage and a diff image.
- **Find and wait:** `find_by_text`, `scroll_into_view`, and `wait_for` a selector or for the page to
  settle.
- **Edit:** apply styles, add rules, change classes, text or HTML live, and revert every edit.
- **Act:** click, type, press keys and scroll. These are ordinary DOM events, so sites that require
  trusted input ignore them.

## Security

- The socket binds to `127.0.0.1` and accepts only the Pixmeter extension (origin check) with the
  matching token.
- Every call is validated against the extension's own protocol before it is sent.
- Disconnect any time from the Pixmeter dock or settings.

## Requirements

Node.js 18 or newer. `measure_distance` and `check_contrast` need Pixmeter 1.2 or newer; the annotation, comparison, spacing and wait tools and the new `get_screenshot` options need a Pixmeter release after 1.2.0 (an older extension answers "Unknown action").
