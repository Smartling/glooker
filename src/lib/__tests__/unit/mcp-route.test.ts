jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));

import { POST, GET } from '@/app/api/mcp/route';
import db from '@/lib/db/index';

const mockExecute = db.execute as jest.Mock;
beforeEach(() => mockExecute.mockReset());

function postReq(body: any) {
  return new Request('http://localhost/api/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/mcp', () => {
  it('handles initialize and returns 200 JSON-RPC result', async () => {
    const res = await POST(postReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe('glooker');
  });

  it('returns 202 with empty body for notifications/initialized', async () => {
    const res = await POST(postReq({ jsonrpc: '2.0', method: 'notifications/initialized' }) as any);
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('returns a -32700 parse error for malformed JSON', async () => {
    const bad = new Request('http://localhost/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' });
    const res = await POST(bad as any);
    const json = await res.json();
    expect(json.error.code).toBe(-32700);
  });

  it('GET returns 405', async () => {
    const res = await GET(new Request('http://localhost/api/mcp') as any);
    expect(res.status).toBe(405);
  });
});

describe('POST /api/mcp auth backstop', () => {
  const orig = { enabled: process.env.AUTH_ENABLED, testUser: process.env.AUTH_TEST_USER };
  afterEach(() => {
    process.env.AUTH_ENABLED = orig.enabled;
    process.env.AUTH_TEST_USER = orig.testUser;
  });

  it('returns 401 when AUTH_ENABLED and no proxy identity header is present', async () => {
    process.env.AUTH_ENABLED = 'true';
    delete process.env.AUTH_TEST_USER;
    const res = await POST(postReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as any);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.code).toBe(-32001);
  });

  it('allows the request when AUTH_ENABLED and an identity is present', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'viewer'; // extractUser returns a user in test mode
    mockExecute.mockResolvedValueOnce([[], null]); // resolveRequester → user_mappings lookup
    const res = await POST(postReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) as any);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.result.serverInfo.name).toBe('glooker');
  });
});
