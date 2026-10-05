import {
  _clearOrgCache,
  allowedOrgs,
  assertAllowedOrg,
  isOrgAllowed,
  OrgNotAllowedError,
  requireAllowedOrg,
} from '@/lib/orgs/guard';

const saved = process.env.ALLOWED_ORGS;
beforeEach(() => { delete process.env.ALLOWED_ORGS; _clearOrgCache(); });
afterAll(() => {
  if (saved === undefined) delete process.env.ALLOWED_ORGS;
  else process.env.ALLOWED_ORGS = saved;
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
