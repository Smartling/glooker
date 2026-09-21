/**
 * Minimal MCP client for Glooker's own MCP server (GLOOK-26).
 * That server is POST-only JSON-RPC, so this is the whole protocol surface:
 * initialize, tools/list, tools/call.
 */
let nextId = 1;

async function rpc(endpoint: string, method: string, params?: any) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const body: any = await res.json();
  if (body.error) throw new Error(`MCP ${method}: ${body.error.message}`);
  return body.result;
}

export interface McpTool { name: string; description: string; input_schema: any }

export async function mcpListTools(endpoint: string): Promise<McpTool[]> {
  await rpc(endpoint, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'glooker-chat', version: '1' },
  });
  const { tools } = await rpc(endpoint, 'tools/list');
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema ?? t.input_schema,
  }));
}

export async function mcpCallTool(endpoint: string, name: string, args: Record<string, any>): Promise<string> {
  const result = await rpc(endpoint, 'tools/call', { name, arguments: args });
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}
