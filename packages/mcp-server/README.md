# @pixellens/mcp-server

Let an AI agent (Claude Code, Claude Desktop, Cursor, VS Code, …) see and work with the page open
in your browser through the [PixelLens](https://github.com/duchung45644/pixellens) extension: inspect
elements and their CSS, measure spacing, check contrast and accessibility, take screenshots, try CSS
changes live, and click, type and scroll.

The server speaks MCP over stdio to the agent and listens on `127.0.0.1` only for the extension.
Nothing leaves your machine.

## Setup

1. Install PixelLens in Chrome or Edge and turn it on in a tab.
2. In PixelLens, open the **MCP** popover on the dock and press **Copy**. The copied prompt holds
   your extension ID and a private token.
3. Paste it into your agent, or add the server to its config yourself:

```json
{
  "mcpServers": {
    "PixelLens": {
      "command": "npx",
      "args": ["-y", "@pixellens/mcp-server", "--extension-id", "<extension id>"],
      "env": { "PIXELLENS_MCP_TOKEN": "<token from PixelLens>" }
    }
  }
}
```

Claude Code:

```sh
claude mcp add PixelLens -e PIXELLENS_MCP_TOKEN=<token> -- npx -y @pixellens/mcp-server --extension-id <id>
```

4. Ask the agent to call `ping` to check the connection, then `list_tabs`.

## Options

| Option                      | Required | Description                                      |
| --------------------------- | -------- | ------------------------------------------------ |
| `--extension-id <id>`       | yes      | The PixelLens extension ID (32 letters a–p).     |
| `PIXELLENS_MCP_TOKEN` (env) | yes      | The token shown by PixelLens. Keep it private.   |
| `--port <n>`                | no       | WebSocket port on 127.0.0.1 (default **47347**). |

## What the agent can do

- **Tabs:** list tabs, focus one, and (if you allow it in PixelLens settings) turn PixelLens on.
- **Inspect:** element details and outline, matched CSS rules and specificity, layout, Tailwind
  classes, typography, colors, CSS variables, assets, breakpoints, detected technologies.
- **Measure:** distance in px between two elements (or to the parent's edges).
- **Check:** text contrast against the real background (WCAG ratio, AA/AAA, suggested fix),
  accessibility and SEO issues, meta tags, page weight.
- **See:** screenshots of the page or an element, returned as images; responsive mode with several
  viewports at once.
- **Edit:** apply styles, add rules, change classes, text or HTML live, and revert every edit.
- **Act:** click, type, press keys and scroll. These are ordinary DOM events, so sites that require
  trusted input ignore them.

## Security

- The socket binds to `127.0.0.1` and accepts only the PixelLens extension (origin check) with the
  matching token.
- Every call is validated against the extension's own protocol before it is sent.
- Disconnect any time from the PixelLens dock or settings.

## Requirements

Node.js 18 or newer. `measure_distance` and `check_contrast` need PixelLens 1.2 or newer.
