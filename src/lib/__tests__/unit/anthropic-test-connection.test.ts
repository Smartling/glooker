// Tests for the POST /api/settings/anthropic/test-connection route:
//   - admin gate is honored (denied response is propagated)
//   - successful probe returns sampleEmailMasked, not sampleEmail
//
// The route only existed in PR #38; this guards against (a) accidental
// removal of requireAdmin and (b) regressions that leak the raw email.

jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/auth', () => ({
  requireAdmin: jest.fn().mockResolvedValue(null),
}));
jest.mock('@/lib/cc-spend/provider', () => {
  const real = jest.requireActual('@/lib/cc-spend/provider');
  return { ...real, getCcSpendProvider: jest.fn() };
});

import { POST } from '@/app/api/settings/anthropic/test-connection/route';
import { requireAdmin } from '@/lib/auth';
import { getCcSpendProvider } from '@/lib/cc-spend/provider';

const mockRequireAdmin = requireAdmin as jest.Mock;
const mockGetProvider = getCcSpendProvider as jest.Mock;

function makeReq() {
  return { headers: new Headers() } as any;
}

describe('POST /api/settings/anthropic/test-connection', () => {
  beforeEach(() => {
    mockRequireAdmin.mockReset();
    mockRequireAdmin.mockResolvedValue(null);
    mockGetProvider.mockReset();
  });

  it('propagates the requireAdmin denial when the caller is not admin', async () => {
    const denied = new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
    mockRequireAdmin.mockResolvedValue(denied);

    // Provider should never be touched when admin gate denies.
    mockGetProvider.mockReturnValue({
      probe: jest.fn(),
      pullByPeriod: jest.fn(),
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(403);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  it('returns sampleEmailMasked (not sampleEmail) on a successful probe', async () => {
    mockGetProvider.mockReturnValue({
      probe: jest.fn().mockResolvedValue({
        userCount: 3,
        sampleEmail: 'bob.smith@smartling.com',
      }),
      pullByPeriod: jest.fn(),
    });

    const res = await POST(makeReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.userCount).toBe(3);
    // First letter preserved, rest of local-part starred, full domain visible.
    expect(body.sampleEmailMasked).toBe('b********@smartling.com');
    // Raw email must not appear anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('bob.smith');
    expect(body.sampleEmail).toBeUndefined();
  });

  it('still returns success when probe yields no sample email', async () => {
    mockGetProvider.mockReturnValue({
      probe: jest.fn().mockResolvedValue({ userCount: 0 }),
      pullByPeriod: jest.fn(),
    });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.userCount).toBe(0);
    expect(body.sampleEmailMasked).toBeUndefined();
  });

  it('returns success:false with error message when the provider throws', async () => {
    mockGetProvider.mockReturnValue({
      probe: jest.fn().mockRejectedValue(new Error('Anthropic API 401: bad key')),
      pullByPeriod: jest.fn(),
    });

    const res = await POST(makeReq());
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/401/);
  });
});
