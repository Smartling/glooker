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
  it('accepts plausible GitHub org names when they are in the allowlist', () => {
    process.env.ALLOWED_ORGS = 'smartling,Acme-Corp,a,x1-2-3';
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
  it('rejects everything when unset (secure by default)', () => {
    expect(allowedOrgs().size).toBe(0);
    expect(isOrgAllowed('any-org')).toBe(false);
    expect(isOrgAllowed('smartling')).toBe(false);
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
    process.env.ALLOWED_ORGS = 'smartling';
    const r = requireAllowedOrg('  smartling  ');
    expect(r).toEqual({ ok: true, org: 'smartling' });
  });
});

describe('assertAllowedOrg — service helper', () => {
  it('returns the org when permitted', () => {
    process.env.ALLOWED_ORGS = 'smartling';
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

describe('Security: Pentest finding mitigation — empty allowlist bypass', () => {
  // The vulnerability: when ALLOWED_ORGS was unset/empty, isOrgAllowed() returned
  // true for any syntactically valid org name. This allowed authenticated users to:
  // 1. Aim the server's GitHub PAT at arbitrary orgs via /api/developers?org=X&source=github
  // 2. Read any org's data from the database via org-scoped queries
  // The fix: empty allowlist now rejects everything (secure by default).

  it('rejects all orgs when ALLOWED_ORGS is unset (CVE mitigation)', () => {
    delete process.env.ALLOWED_ORGS;
    _clearOrgCache();
    
    // These would have been accepted before the fix
    expect(isOrgAllowed('attacker-org')).toBe(false);
    expect(isOrgAllowed('victim-org')).toBe(false);
    expect(isOrgAllowed('any-valid-org-name')).toBe(false);
  });

  it('rejects all orgs when ALLOWED_ORGS is empty string', () => {
    process.env.ALLOWED_ORGS = '';
    _clearOrgCache();
    
    expect(isOrgAllowed('attacker-org')).toBe(false);
    expect(isOrgAllowed('victim-org')).toBe(false);
  });

  it('rejects all orgs when ALLOWED_ORGS is whitespace only', () => {
    process.env.ALLOWED_ORGS = '   ';
    _clearOrgCache();
    
    expect(isOrgAllowed('attacker-org')).toBe(false);
    expect(isOrgAllowed('victim-org')).toBe(false);
  });

  it('rejects all orgs when ALLOWED_ORGS contains only delimiters', () => {
    process.env.ALLOWED_ORGS = ',,,';
    _clearOrgCache();
    
    expect(isOrgAllowed('attacker-org')).toBe(false);
    expect(isOrgAllowed('victim-org')).toBe(false);
  });

  it('rejects all orgs when ALLOWED_ORGS is whitespace and delimiters', () => {
    process.env.ALLOWED_ORGS = ' , , , ';
    _clearOrgCache();
    
    expect(isOrgAllowed('attacker-org')).toBe(false);
    expect(isOrgAllowed('victim-org')).toBe(false);
  });

  it('requireAllowedOrg returns 404 for any org when allowlist is empty', () => {
    delete process.env.ALLOWED_ORGS;
    _clearOrgCache();
    
    const result = requireAllowedOrg('attacker-org');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(404);
    }
  });

  it('assertAllowedOrg throws for any org when allowlist is empty', () => {
    delete process.env.ALLOWED_ORGS;
    _clearOrgCache();
    
    expect(() => assertAllowedOrg('attacker-org')).toThrow(OrgNotAllowedError);
    expect(() => assertAllowedOrg('victim-org')).toThrow(OrgNotAllowedError);
  });

  it('only allows explicitly configured orgs (no implicit allow-all)', () => {
    process.env.ALLOWED_ORGS = 'my-org,trusted-org';
    _clearOrgCache();
    
    // Allowed orgs work
    expect(isOrgAllowed('my-org')).toBe(true);
    expect(isOrgAllowed('trusted-org')).toBe(true);
    
    // Everything else is rejected
    expect(isOrgAllowed('attacker-org')).toBe(false);
    expect(isOrgAllowed('victim-org')).toBe(false);
    expect(isOrgAllowed('another-org')).toBe(false);
  });
});

describe('Security: Cross-tenant isolation enforcement', () => {
  // The vulnerability allowed authenticated users to access data from any org
  // in the database by supplying a different org parameter. The fix ensures
  // only explicitly allowed orgs can be accessed.

  it('prevents cross-tenant data access by rejecting non-allowlisted orgs', () => {
    process.env.ALLOWED_ORGS = 'tenant-a';
    _clearOrgCache();
    
    // Tenant A can access their own data
    expect(isOrgAllowed('tenant-a')).toBe(true);
    
    // Tenant A cannot access tenant B's data
    expect(isOrgAllowed('tenant-b')).toBe(false);
    expect(isOrgAllowed('tenant-c')).toBe(false);
  });

  it('multi-tenant deployments must explicitly list all allowed orgs', () => {
    process.env.ALLOWED_ORGS = 'tenant-a,tenant-b,tenant-c';
    _clearOrgCache();
    
    // All explicitly configured tenants are allowed
    expect(isOrgAllowed('tenant-a')).toBe(true);
    expect(isOrgAllowed('tenant-b')).toBe(true);
    expect(isOrgAllowed('tenant-c')).toBe(true);
    
    // Unlisted tenants are rejected
    expect(isOrgAllowed('tenant-d')).toBe(false);
    expect(isOrgAllowed('unauthorized-org')).toBe(false);
  });

  it('requireAllowedOrg returns 404 for cross-tenant access attempts', () => {
    process.env.ALLOWED_ORGS = 'tenant-a';
    _clearOrgCache();
    
    const result = requireAllowedOrg('tenant-b');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(404);
    }
  });
});

describe('Security: GitHub PAT proxy protection', () => {
  // The vulnerability allowed authenticated users to aim the server's GitHub PAT
  // at arbitrary organizations via routes like /api/developers?org=X&source=github.
  // The fix ensures the PAT can only be used for explicitly allowed orgs.

  it('prevents aiming server GitHub PAT at arbitrary orgs when allowlist is empty', () => {
    delete process.env.ALLOWED_ORGS;
    _clearOrgCache();
    
    // Before the fix, these would have been allowed
    expect(isOrgAllowed('attacker-target-org')).toBe(false);
    expect(isOrgAllowed('victim-private-org')).toBe(false);
  });

  it('restricts GitHub PAT usage to explicitly configured orgs only', () => {
    process.env.ALLOWED_ORGS = 'my-company';
    _clearOrgCache();
    
    // Server PAT can be used for configured org
    expect(isOrgAllowed('my-company')).toBe(true);
    
    // Server PAT cannot be aimed at other orgs
    expect(isOrgAllowed('competitor-org')).toBe(false);
    expect(isOrgAllowed('random-public-org')).toBe(false);
    expect(isOrgAllowed('attacker-controlled-org')).toBe(false);
  });

  it('requireAllowedOrg blocks unauthorized GitHub API proxy attempts', () => {
    process.env.ALLOWED_ORGS = 'my-company';
    _clearOrgCache();
    
    // Simulates /api/developers?org=attacker-org&source=github
    const result = requireAllowedOrg('attacker-org');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.res.status).toBe(404);
    }
  });
});
