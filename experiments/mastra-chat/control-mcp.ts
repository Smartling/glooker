/**
 * CONTROL ARM equivalent of Mastra's MCP client.
 * Glooker's MCP server is plain POST JSON-RPC, so this is the whole thing.
 * Exists to measure what Mastra's MCPClient is actually worth here.
 */
const ENDPOINT = process.env.GLOOKER_MCP_URL || 'http://localhost:3000/api/mcp';

let nextId = 1;
async function rpc(method: string, params?: any) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const body: any = await res.json();
  if (body.error) throw new Error(`MCP ${method}: ${body.error.message}`);
  return body.result;
}

export interface McpTool { name: string; description: string; input_schema: any }

export async function mcpListTools(): Promise<McpTool[]> {
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'glooker-control', version: '0' } });
  const { tools } = await rpc('tools/list');
  return tools.map((t: any) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema ?? t.input_schema,
  }));
}

export async function mcpCallTool(name: string, args: Record<string, any>): Promise<string> {
  const result = await rpc('tools/call', { name, arguments: args });
  return (result?.content ?? []).map((c: any) => c.text ?? '').join('\n');
}
