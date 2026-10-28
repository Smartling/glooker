/**
 * Security test: chat endpoint cross-tenant read mitigation.
 *
 * Pentest finding: The chat endpoint accepted caller-selected `org` and performed
 * only deployment-wide allowlist validation, allowing authenticated users to read
 * analytics and metadata from any organization hosted by the deployment.
 *
 * Mitigation: The route now calls resolveRequester with the requested org and
 * rejects requests when the authenticated caller has no user_mappings entry for
 * that org (unless auth is disabled or the caller is an admin).
 */

jest.mock('@/lib/chat/agent', () => ({ runChatAgent: jest.fn() }));
jest.mock('@/lib/orgs/guard', () => ({
  requireAllowedOrg: jest.fn((org) => {
    if (!org) return { ok: false, res: { status: 400, json: async () => ({ error: 'org is required' }) } };
    // Simulate deployment-wide allowlist accepting both orgs
    if (org === 'acme' || org === 'globex') return { ok: true, org };
    return { ok: false, res: { status: 404, json: async () => ({ error: 'Not found' }) } };
  }),
}));
jest.mock('@/lib/cost-visibility', () => ({
  resolveRequester: jest.fn(),
}));

import { NextRequest } from 'next/server';
import { POST } from '@/app/api/chat/route';
import { runChatAgent } from '@/lib/chat/agent';
import { resolveRequester } from '@/lib/cost-visibility';

const mockRunChatAgent = runChatAgent as jest.Mock;
const mockResolveRequester = resolveRequester as jest.Mock;

function makeRequest(org: string, messages: any[] = [{ role: 'user', content: 'test' }]) {
  return POST(new NextRequest('http://localhost/api/chat', {
    method: 'POST',
    body: JSON.stringify({ org, messages }),
    headers: { 'content-type': 'application/json' },
  }) as any);
}

beforeEach(() => {
  mockRunChatAgent.mockReset();
  mockResolveRequester.mockReset();
  mockRunChatAgent.mockResolvedValue({ messages: [] });
});

describe('chat route cross-tenant authorization', () => {
  it('allows request when auth is disabled', async () => {
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null,
      isAdmin: false,
      authDisabled: true,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(200);
    expect(mockResolveRequester).toHaveBeenCalledWith(expect.any(Headers), 'acme');
    expect(mockRunChatAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: 'test' }],
      'acme'
    );
  });

  it('allows request when caller is admin', async () => {
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'admin-user',
      isAdmin: true,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(200);
    expect(mockRunChatAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: 'test' }],
      'acme'
    );
  });

  it('allows request when caller has mapping for the requested org', async () => {
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'alice',
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(200);
    expect(mockResolveRequester).toHaveBeenCalledWith(expect.any(Headers), 'acme');
    expect(mockRunChatAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: 'test' }],
      'acme'
    );
  });

  it('rejects cross-tenant read: authenticated non-admin without org mapping', async () => {
    // Caller is authenticated (authDisabled=false, isAdmin=false) but has no
    // user_mappings entry for the requested org (githubLogin=null).
    // This is the exploit scenario: user from org A trying to access org B.
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null,
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('globex');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });

  it('rejects when resolveRequester returns null githubLogin for non-admin', async () => {
    // Explicit test: authenticated user without mapping to the org
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null,
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
    expect(mockResolveRequester).toHaveBeenCalledWith(expect.any(Headers), 'acme');
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });

  it('passes normalized org from requireAllowedOrg to runChatAgent', async () => {
    // Verify that orgCheck.org (normalized) is used, not the raw request org
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'bob',
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(200);
    // The route should pass orgCheck.org (from requireAllowedOrg) to both
    // resolveRequester and runChatAgent
    expect(mockResolveRequester).toHaveBeenCalledWith(expect.any(Headers), 'acme');
    expect(mockRunChatAgent).toHaveBeenCalledWith(
      [{ role: 'user', content: 'test' }],
      'acme'
    );
  });

  it('checks authorization before invoking the agent', async () => {
    // Ensure the authorization check happens before expensive agent operations
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null,
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(404);
    expect(mockResolveRequester).toHaveBeenCalled();
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });

  it('deployment-wide allowlist still enforced before membership check', async () => {
    // requireAllowedOrg should reject unknown orgs before resolveRequester runs
    const res = await makeRequest('unknown-org');
    expect(res.status).toBe(404);
    // resolveRequester should not be called for disallowed orgs
    expect(mockResolveRequester).not.toHaveBeenCalled();
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });

  it('validates messages before authorization check', async () => {
    // Empty messages should fail before resolveRequester
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'alice',
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme', []);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'messages are required' });
    // Authorization check should not run for invalid requests
    expect(mockResolveRequester).not.toHaveBeenCalled();
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });
});

describe('chat route authorization with multiple orgs', () => {
  it('user mapped to org A cannot access org B', async () => {
    // Simulate user alice@acme.com mapped to 'acme' trying to access 'globex'
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null, // No mapping found for globex
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('globex');
    expect(res.status).toBe(404);
    expect(mockResolveRequester).toHaveBeenCalledWith(expect.any(Headers), 'globex');
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });

  it('user mapped to org B cannot access org A', async () => {
    // Reverse scenario: user from globex trying to access acme
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null, // No mapping found for acme
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    expect(res.status).toBe(404);
    expect(mockResolveRequester).toHaveBeenCalledWith(expect.any(Headers), 'acme');
    expect(mockRunChatAgent).not.toHaveBeenCalled();
  });

  it('user with mappings to both orgs can access both', async () => {
    // User mapped to acme
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'multi-org-user',
      isAdmin: false,
      authDisabled: false,
    });
    let res = await makeRequest('acme');
    expect(res.status).toBe(200);

    // Same user mapped to globex
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'multi-org-user',
      isAdmin: false,
      authDisabled: false,
    });
    res = await makeRequest('globex');
    expect(res.status).toBe(200);
  });
});

describe('chat route security properties', () => {
  it('returns 404 (not 403) to avoid org enumeration', async () => {
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null,
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('acme');
    // Should return 404 to not confirm org existence
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'Not found' });
  });

  it('does not leak org information in error messages', async () => {
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: null,
      isAdmin: false,
      authDisabled: false,
    });

    const res = await makeRequest('secret-org');
    const body = await res.json();
    // Error message should be generic, not mentioning the org
    expect(body.error).toBe('Not found');
    expect(JSON.stringify(body)).not.toContain('secret-org');
  });

  it('authorization check uses org-scoped mapping lookup', async () => {
    // Verify that resolveRequester is called with the specific org
    mockResolveRequester.mockResolvedValueOnce({
      githubLogin: 'alice',
      isAdmin: false,
      authDisabled: false,
    });

    await makeRequest('acme');
    
    // resolveRequester should be called with the org to perform org-scoped lookup
    expect(mockResolveRequester).toHaveBeenCalledWith(
      expect.any(Headers),
      'acme' // org parameter for scoped lookup
    );
  });
});
