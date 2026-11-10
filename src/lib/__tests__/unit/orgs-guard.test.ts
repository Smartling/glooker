import {
  _clearOrgCache,
  allowedOrgs,
  assertAllowedOrg,
  assertOrgMembership,
  isOrgAllowed,
  OrgNotAllowedError,
  requireAllowedOrg,
  requireOrgMembership,
} from '@/lib/orgs/guard';

jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));

jest.mock('@/lib/auth', () => ({
  extractUser: jest.fn(),
  isAuthEnabled: jest.fn(),
}));

import db from '@/lib/db';
import { extractUser, isAuthEnabled } from '@/lib/auth';

const mockExecute = db.execute as jest.Mock;
const mockExtractUser = extractUser as jest.Mock;
const mockIsAuthEnabled = isAuthEnabled as jest.Mock;

const saved = process.env.ALLOWED_ORGS;
const savedAuthAdminGroup = process.env.AUTH_ADMIN_GROUP;

beforeEach(() => {
  delete process.env.ALLOWED_ORGS;
  delete process.env.AUTH_ADMIN_GROUP;
  _clearOrgCache();
  mockExecute.mockReset();
  mockExtractUser.mockReset();
  mockIsAuthEnabled.mockReset();
});

afterAll(() => {
  if (saved === undefined) delete process.env.ALLOWED_ORGS;
  else process.env.ALLOWED_ORGS = saved;
  if (savedAuthAdminGroup === undefined) delete process.env.AUTH_ADMIN_GROUP;
  else process.env.AUTH_ADMIN_GROUP = savedAuthAdminGroup;
  _clearOrgCache();
});

describe('isOrgAllowed — shape validation (applies with or without an allowlist)', () => {
  it('accepts plausible GitHub org names', () => {
    for (const o of ['smartling', 'Acme-Corp', 'a', 'x1-2-3']) {
      expect(isOrgAllowed(o)).toBe(true);
    }
  });

  it('rejects empty and non-string input', () => {
    for (const o of ['', '   ', null as any, undefined as any, 42 as any]) {
      expect(isOrgAllowed(o)).toBe(false);
    }
  });

  // The value reaches GitHub API paths and org-scoped SQL, so the shape check
  // runs even when no allowlist is configured.
  it('rejects path, wildcard and injection-shaped values', () => {
    for (const o of [
      '../../etc/passwd', 'a/b', 'a b', 'org;DROP', "org'--", 'org"x',
      'a\nb', 'a%2Fb', '*', '-leading-dash', 'org.with.dots', 'ünicode',
      'a'.repeat(40),
    ]) {
      expect(isOrgAllowed(o)).toBe(false);
    }
  });
});

describe('ALLOWED_ORGS enforcement', () => {
  it('permits anything well-shaped when unset (preserves existing single-org installs)', () => {
    expect(allowedOrgs().size).toBe(0);
    expect(isOrgAllowed('any-org')).toBe(true);
  });

  it('restricts to the configured set when set', () => {
    process.env.ALLOWED_ORGS = 'smartling, acme';
    expect(isOrgAllowed('smartling')).toBe(true);
    expect(isOrgAllowed('acme')).toBe(true);
    expect(isOrgAllowed('victim-inc')).toBe(false);
  });

  it('compares case-insensitively, because GitHub org names are', () => {
    process.env.ALLOWED_ORGS = 'Smartling';
    expect(isOrgAllowed('smartling')).toBe(true);
    expect(isOrgAllowed('SMARTLING')).toBe(true);
  });

  it('re-reads the env var when it changes rather than serving a stale cache', () => {
    process.env.ALLOWED_ORGS = 'one';
    expect(isOrgAllowed('two')).toBe(false);
    process.env.ALLOWED_ORGS = 'one,two';
    expect(isOrgAllowed('two')).toBe(true);
  });
});

describe('requireAllowedOrg — route helper', () => {
  it('400s a missing org', () => {
    const r = requireAllowedOrg(null);
    expect(r.ok).toBe(false);
    expect((r as any).res.status).toBe(400);
  });

  // 404 rather than 403 so the response does not confirm which orgs exist here.
  it('404s a disallowed org without confirming existence', async () => {
    process.env.ALLOWED_ORGS = 'smartling';
    const r = requireAllowedOrg('victim-inc');
    expect(r.ok).toBe(false);
    const res = (r as any).res;
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('victim-inc');
  });

  it('returns the trimmed org on success so callers get a narrowed string', () => {
    const r = requireAllowedOrg('  smartling  ');
    expect(r).toEqual({ ok: true, org: 'smartling' });
  });
});

describe('assertAllowedOrg — service helper', () => {
  it('returns the org when permitted', () => {
    expect(assertAllowedOrg('smartling')).toBe('smartling');
  });

  it('throws without echoing the rejected value', () => {
    process.env.ALLOWED_ORGS = 'smartling';
    try {
      assertAllowedOrg('victim-inc');
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OrgNotAllowedError);
      expect((err as Error).message).not.toContain('victim-inc');
    }
  });
});

// ============================================================================
// Tenant isolation tests: verify that the pentest finding is mitigated
// ============================================================================

describe('requireOrgMembership — route-level tenant isolation', () => {
  function makeHeaders(headerMap: Record<string, string> = {}): Headers {
    const headers = new Headers();
    Object.entries(headerMap).forEach(([k, v]) => headers.set(k, v));
    return headers;
  }

  it('bypasses membership check when auth is disabled', async () => {
    mockIsAuthEnabled.mockReturnValue(false);
    const result = await requireOrgMembership(makeHeaders(), 'acme');
    expect(result).toBeNull();
    expect(mockExtractUser).not.toHaveBeenCalled();
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('denies access when no authenticated user is present', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue(null);
    const result = await requireOrgMembership(makeHeaders(), 'acme');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(404);
    const body = await result?.json();
    expect(body.error).toBe('Not found');
  });

  it('allows access when user has a mapping for the requested org', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@acme.com', groups: [] });
    mockExecute.mockResolvedValue([[{ id: 1 }], null]); // user_mappings row exists
    const result = await requireOrgMembership(makeHeaders(), 'acme');
    expect(result).toBeNull();
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT 1 FROM user_mappings WHERE jira_email = ? AND org = ?'),
      ['alice@acme.com', 'acme']
    );
  });

  it('denies access when user has no mapping for the requested org (cross-tenant attempt)', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@acme.com', groups: [] });
    mockExecute.mockResolvedValue([[], null]); // no user_mappings row
    const result = await requireOrgMembership(makeHeaders(), 'victim-inc');
    expect(result).not.toBeNull();
    expect(result?.status).toBe(404);
    const body = await result?.json();
    expect(body.error).toBe('Not found');
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT 1 FROM user_mappings WHERE jira_email = ? AND org = ?'),
      ['alice@acme.com', 'victim-inc']
    );
  });

  it('bypasses membership check for admin users', async () => {
    process.env.AUTH_ADMIN_GROUP = 'admins';
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'admin@acme.com', groups: ['admins'] });
    const result = await requireOrgMembership(makeHeaders(), 'any-org');
    expect(result).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled(); // no DB check for admins
  });

  it('returns 404 (not 403) to avoid confirming org existence', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@acme.com', groups: [] });
    mockExecute.mockResolvedValue([[], null]);
    const result = await requireOrgMembership(makeHeaders(), 'victim-inc');
    expect(result?.status).toBe(404);
    const body = await result?.json();
    expect(body.error).toBe('Not found');
    // Verify the error message doesn't leak the org name
    expect(JSON.stringify(body)).not.toContain('victim-inc');
  });
});

describe('assertOrgMembership — service-level tenant isolation (MCP/chat)', () => {
  it('throws when no requester is provided (fail closed)', async () => {
    await expect(assertOrgMembership('acme', null)).rejects.toThrow(OrgNotAllowedError);
    await expect(assertOrgMembership('acme', undefined)).rejects.toThrow(OrgNotAllowedError);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('bypasses membership check when auth is disabled', async () => {
    const requester = { githubLogin: 'alice', isAdmin: false, authDisabled: true };
    await assertOrgMembership('acme', requester);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('bypasses membership check for admin users', async () => {
    const requester = { githubLogin: 'alice', isAdmin: true, authDisabled: false };
    await assertOrgMembership('acme', requester);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('throws when requester has no githubLogin (authenticated but unmapped)', async () => {
    const requester = { githubLogin: null, isAdmin: false, authDisabled: false };
    await expect(assertOrgMembership('acme', requester)).rejects.toThrow(OrgNotAllowedError);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('allows access when user has a mapping for the requested org', async () => {
    const requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    mockExecute.mockResolvedValue([[{ id: 1 }], null]); // user_mappings row exists
    await assertOrgMembership('acme', requester);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT 1 FROM user_mappings WHERE github_login = ? AND org = ?'),
      ['alice', 'acme']
    );
  });

  it('throws when user has no mapping for the requested org (cross-tenant attempt)', async () => {
    const requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    mockExecute.mockResolvedValue([[], null]); // no user_mappings row
    await expect(assertOrgMembership('victim-inc', requester)).rejects.toThrow(OrgNotAllowedError);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('SELECT 1 FROM user_mappings WHERE github_login = ? AND org = ?'),
      ['alice', 'victim-inc']
    );
  });

  it('does not leak the rejected org name in the error message', async () => {
    const requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    mockExecute.mockResolvedValue([[], null]);
    try {
      await assertOrgMembership('victim-inc', requester);
      throw new Error('expected a throw');
    } catch (err) {
      expect(err).toBeInstanceOf(OrgNotAllowedError);
      expect((err as Error).message).not.toContain('victim-inc');
    }
  });
});

describe('Pentest scenario: authenticated user requests another org\'s data', () => {
  function makeHeaders(headerMap: Record<string, string> = {}): Headers {
    const headers = new Headers();
    Object.entries(headerMap).forEach(([k, v]) => headers.set(k, v));
    return headers;
  }

  it('blocks cross-tenant access to Jira projects (GET /api/jira-projects?org=victim)', async () => {
    // Scenario: User from org A tries to access org B's Jira projects
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@orgA.com', groups: [] });
    mockExecute.mockResolvedValue([[], null]); // no mapping for orgB

    // Step 1: requireAllowedOrg passes (orgB is syntactically valid)
    const orgCheck = requireAllowedOrg('orgB');
    expect(orgCheck.ok).toBe(true);

    // Step 2: requireOrgMembership blocks the request
    const membershipDenied = await requireOrgMembership(makeHeaders(), (orgCheck as any).org);
    expect(membershipDenied).not.toBeNull();
    expect(membershipDenied?.status).toBe(404);
  });

  it('blocks cross-tenant access to board epics (GET /api/projects?org=victim)', async () => {
    // Scenario: User from org A tries to access org B's board data
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@orgA.com', groups: [] });
    mockExecute.mockResolvedValue([[], null]); // no mapping for orgB

    const orgCheck = requireAllowedOrg('orgB');
    expect(orgCheck.ok).toBe(true);

    const membershipDenied = await requireOrgMembership(makeHeaders(), (orgCheck as any).org);
    expect(membershipDenied).not.toBeNull();
    expect(membershipDenied?.status).toBe(404);
  });

  it('blocks cross-tenant MCP queries (list_reports with org filter)', async () => {
    // Scenario: MCP tool caller tries to list reports for another org
    const requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    mockExecute.mockResolvedValue([[], null]); // no mapping for victim-inc

    await expect(assertOrgMembership('victim-inc', requester)).rejects.toThrow(OrgNotAllowedError);
  });

  it('blocks cross-tenant chat agent queries (get_team_pulse for another org)', async () => {
    // Scenario: Chat agent caller tries to get team pulse for another org
    const requester = { githubLogin: 'alice', isAdmin: false, authDisabled: false };
    mockExecute.mockResolvedValue([[], null]); // no mapping for victim-inc

    await expect(assertOrgMembership('victim-inc', requester)).rejects.toThrow(OrgNotAllowedError);
  });

  it('allows same-org access when user has proper membership', async () => {
    // Scenario: User from org A accesses their own org's data
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@orgA.com', groups: [] });
    mockExecute.mockResolvedValue([[{ id: 1 }], null]); // has mapping for orgA

    const orgCheck = requireAllowedOrg('orgA');
    expect(orgCheck.ok).toBe(true);

    const membershipDenied = await requireOrgMembership(makeHeaders(), (orgCheck as any).org);
    expect(membershipDenied).toBeNull(); // access granted
  });

  it('enforces membership check even with deployment-wide allowlist', async () => {
    // Scenario: Deployment has ALLOWED_ORGS=orgA,orgB but user only belongs to orgA
    process.env.ALLOWED_ORGS = 'orgA,orgB';
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockResolvedValue({ email: 'alice@orgA.com', groups: [] });
    mockExecute.mockResolvedValue([[], null]); // no mapping for orgB

    // requireAllowedOrg passes (orgB is in the allowlist)
    const orgCheck = requireAllowedOrg('orgB');
    expect(orgCheck.ok).toBe(true);

    // But requireOrgMembership blocks it (user not a member of orgB)
    const membershipDenied = await requireOrgMembership(makeHeaders(), (orgCheck as any).org);
    expect(membershipDenied).not.toBeNull();
    expect(membershipDenied?.status).toBe(404);
  });
});
