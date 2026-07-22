jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));

import { handleJsonRpc } from '@/lib/mcp/protocol';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

describe('handleJsonRpc', () => {
  it('initialize echoes a supported protocolVersion and advertises tools capability', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
    expect(res.status).toBe(200);
    expect(res.body.result.protocolVersion).toBe('2025-03-26');
    expect(res.body.result.capabilities).toEqual({ tools: {} });
    expect(res.body.result.serverInfo.name).toBe('glooker');
  });

  it('initialize falls back to the default version when unrecognized', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    expect(res.body.result.protocolVersion).toBe('2025-06-18');
  });

  it('notifications/initialized yields 202 with no body', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(res).toEqual({ status: 202, body: null });
  });

  it('ping returns an empty result', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 7, method: 'ping' });
    expect(res.body).toEqual({ jsonrpc: '2.0', id: 7, result: {} });
  });

  it('tools/list returns the registry as name/description/inputSchema', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const tools = res.body.result.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect(tools.find((t: any) => t.name === 'query_commits')).toBeTruthy();
    for (const t of tools) {
      expect(Object.keys(t).sort()).toEqual(['description', 'inputSchema', 'name']);
    }
  });

  it('tools/call wraps the tool result as MCP content', async () => {
    mockExecute.mockResolvedValueOnce([[{ id: 'r1', org: 'acme', period_days: 30, status: 'completed', created_at: 'x', completed_at: 'y' }], null]);
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_reports', arguments: { limit: 5 } } });
    expect(res.body.result.content[0].type).toBe('text');
    const payload = JSON.parse(res.body.result.content[0].text);
    expect(payload.reports).toHaveLength(1);
  });

  it('tools/call with an unknown tool returns isError content', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope', arguments: {} } });
    expect(res.body.result.isError).toBe(true);
  });

  it('unknown method returns JSON-RPC error -32601', async () => {
    const res = await handleJsonRpc({ jsonrpc: '2.0', id: 5, method: 'does/not/exist' });
    expect(res.body.error.code).toBe(-32601);
  });
});
