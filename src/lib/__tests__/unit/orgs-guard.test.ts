import {
  _clearOrgCache,
  allowedOrgs,
  assertAllowedOrg,
  isOrgAllowed,
  OrgNotAllowedError,
  requireAllowedOrg,
  requireUserOrg,
} from '@/lib/orgs/guard';
import { extractUser } from '@/lib/auth';

jest.mock('@/lib/auth', () => ({
  extractUser: jest.fn(),
  isAuthEnabled: jest.fn(),
}));

const saved = process.env.ALLOWED_ORGS;
const savedAuthUserOrgClaim = process.env.AUTH_USER_ORG_CLAIM;
const savedAuthAdminGroup = process.env.AUTH_ADMIN_GROUP;
const savedAuthEnabled = process.env.AUTH_ENABLED;

beforeEach(() => {
  delete process.env.ALLOWED_ORGS;
  delete process.env.AUTH_USER_ORG_CLAIM;
  delete process.env.AUTH_ADMIN_GROUP;
  delete process.env.AUTH_ENABLED;
  _clearOrgCache();
  jest.clearAllMocks();
});

afterAll(() => {
  if (saved === undefined) delete process.env.ALLOWED_ORGS;
  else process.env.ALLOWED_ORGS = saved;
  if (savedAuthUserOrgClaim === undefined) delete process.env.AUTH_USER_ORG_CLAIM;
  else process.env.AUTH_USER_ORG_CLAIM = savedAuthUserOrgClaim;
  if (savedAuthAdminGroup === undefined) delete process.env.AUTH_ADMIN_GROUP;
  else process.env.AUTH_ADMIN_GROUP = savedAuthAdminGroup;
  if (savedAuthEnabled === undefined) delete process.env.AUTH_ENABLED;
  else process.env.AUTH_ENABLED = savedAuthEnabled;
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

describe('requireUserOrg — user-to-org authorization', () => {
  const mockHeaders = new Headers();
  const { isAuthEnabled } = require('@/lib/auth');

  beforeEach(() => {
    isAuthEnabled.mockReturnValue(true);
  });

  it('allows access when auth is disabled', async () => {
    isAuthEnabled.mockReturnValue(false);
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(true);
  });

  it('allows access when AUTH_USER_ORG_CLAIM is not configured', async () => {
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['some-group'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(true);
  });

  it('denies access when user is not authenticated', async () => {
    process.env.AUTH_USER_ORG_CLAIM = 'org-';
    (extractUser as jest.Mock).mockResolvedValue(null);
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(false);
    expect((result as any).res.status).toBe(404);
  });

  it('allows admins to access any org', async () => {
    process.env.AUTH_USER_ORG_CLAIM = 'org-';
    process.env.AUTH_ADMIN_GROUP = 'admin-group';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'admin@example.com',
      sub: 'admin123',
      name: 'Admin User',
      groups: ['admin-group'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(true);
  });

  it('allows access with prefix pattern when user has matching group', async () => {
    process.env.AUTH_USER_ORG_CLAIM = 'org-';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['org-acme', 'other-group'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(true);
  });

  it('denies access with prefix pattern when user lacks matching group', async () => {
    process.env.AUTH_USER_ORG_CLAIM = 'org-';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['org-other', 'some-group'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(false);
    expect((result as any).res.status).toBe(404);
  });

  it('allows access with exact match pattern when user has matching group', async () => {
    // Use a non-dash-ending pattern for exact match (any string that doesn't end with '-')
    process.env.AUTH_USER_ORG_CLAIM = 'x';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['acme', 'other-group'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(true);
  });

  it('denies access with exact match pattern when user lacks matching group', async () => {
    // Use a non-dash-ending pattern for exact match
    process.env.AUTH_USER_ORG_CLAIM = 'x';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['other', 'some-group'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(false);
    expect((result as any).res.status).toBe(404);
  });

  it('performs case-insensitive matching', async () => {
    process.env.AUTH_USER_ORG_CLAIM = 'org-';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['org-ACME'],
    });
    const result = await requireUserOrg(mockHeaders, 'acme');
    expect(result.ok).toBe(true);
  });

  it('returns 404 rather than 403 to avoid org enumeration', async () => {
    process.env.AUTH_USER_ORG_CLAIM = 'org-';
    (extractUser as jest.Mock).mockResolvedValue({
      email: 'user@example.com',
      sub: 'user123',
      name: 'Test User',
      groups: ['org-other'],
    });
    const result = await requireUserOrg(mockHeaders, 'victim-inc');
    expect(result.ok).toBe(false);
    const res = (result as any).res;
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('victim-inc');
  });
});
