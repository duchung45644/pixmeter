/** stdio MCP side: one tool per protocol command plus `ping`, relayed through the Bridge. */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { NOT_CONNECTED, type Bridge } from './bridge.ts';
import { isMcpType, validateCall, ERR } from './protocol.gen.ts';
import { readReference } from './reference.ts';
import { COMMAND_TOOLS, PING_TOOL } from './schemas.ts';

const text = (t: string, isError = false): CallToolResult => ({
  content: [{ type: 'text', text: t }],
  ...(isError ? { isError: true } : {}),
});

/** A command result as MCP content; a PNG data URL becomes an image block. */
export function toContent(data: unknown): CallToolResult {
  const d = data as { dataUrl?: unknown } | null;
  const m =
    d && typeof d.dataUrl === 'string'
      ? /^data:(image\/[a-z+]+);base64,(.*)$/s.exec(d.dataUrl)
      : null;
  if (m) {
    const rest = { ...(d as Record<string, unknown>) };
    delete rest.dataUrl;
    return {
      content: [
        { type: 'image', mimeType: m[1]!, data: m[2]! },
        { type: 'text', text: JSON.stringify(rest) },
      ],
    };
  }
  return text(JSON.stringify(data ?? null));
}

export function createMcpServer(bridge: Bridge, version: string): Server {
  const server = new Server(
    { name: 'pixmeter', version },
    {
      capabilities: { tools: {} },
      instructions:
        'Inspect and edit pages open in the Pixmeter browser extension. Start with list_tabs to get a tabId; ' +
        'element ids (v-…) come from results such as query_selector or get_selected_element. ' +
        'Measuring results and annotations use viewport CSS px; get_screenshot (elementId / rect / padding / scale) ' +
        'and draw_annotations show what you measured.',
    },
  );
  server.oninitialized = () => {
    const c = server.getClientVersion();
    bridge.setClient(
      c ? { name: c.name.slice(0, 200), version: (c.version ?? '').slice(0, 50) } : null,
    );
  };
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [PING_TOOL, ...COMMAND_TOOLS],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    if (name === PING_TOOL.name) {
      const ext = bridge.connected;
      return ext
        ? text(`pong: Pixmeter ${ext.extVersion} is connected.`)
        : text(NOT_CONNECTED, true);
    }
    if (!isMcpType(name)) return text(ERR.unknown, true);
    let input = args ?? {};
    if (name === 'compare_screenshot' && typeof input.referencePath === 'string') {
      // a mockup file: read here, since the extension cannot see this machine's disk
      const ref = await readReference(input.referencePath);
      if ('error' in ref) return text(ref.error, true);
      input = { ...input, referencePath: undefined, referenceDataUrl: ref.dataUrl };
    }
    const v = validateCall(name, input);
    if (!v.ok) return text(v.error, true);
    const r = await bridge.call(name, v.payload);
    return r.ok ? toContent(r.data) : text(r.error, true);
  });
  return server;
}
