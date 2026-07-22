import { MCP_TOOLS, callTool } from './tools';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

const SERVER_INFO = { name: 'glooker', version: process.env.npm_package_version || '0.1.0' };

type RpcResult = { status: number; body: any | null };

function ok(id: any, result: any): RpcResult {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}
function err(id: any, code: number, message: string): RpcResult {
  return { status: 200, body: { jsonrpc: '2.0', id: id ?? null, error: { code, message } } };
}

export async function handleJsonRpc(message: any): Promise<RpcResult> {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return err(message?.id, -32600, 'Invalid Request');
  }
  const { id, method, params } = message;
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      const requested = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : DEFAULT_PROTOCOL_VERSION;
      return ok(id, { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return { status: 202, body: null };
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (typeof name !== 'string') return err(id, -32602, 'Invalid params: missing tool name');
      const result = await callTool(name, args);
      const isError = result && typeof result === 'object' && 'error' in result;
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        isError: !!isError,
      });
    }
    default:
      if (isNotification) return { status: 202, body: null };
      return err(id, -32601, `Method not found: ${method}`);
  }
}
