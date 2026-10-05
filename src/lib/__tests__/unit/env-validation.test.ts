import { validateEnv } from '@/lib/env-validation';
import { __clearVulnConfigCache } from '@/lib/vulnerabilities/config';

// PR #64 review: the AUTH_TEST_USER bypass reads no JWT at all, so if it's
// ever active on a deployed environment it must never be silent. This locks
// in the startup [ALERT] that names the identity being served.
describe('validateEnv: AUTH_TEST_USER alert', () => {
  const savedEnv = { ...process.env };
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...savedEnv };
    // Avoid unrelated required/warning noise in these assertions.
    process.env.GITHUB_TOKEN = 'github_pat_x';
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    jest.restoreAllMocks();
  });

  it('logs an [ALERT] naming the fabricated identity when AUTH_ENABLED=true and AUTH_TEST_USER is set', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    process.env.AUTH_TEST_USER = 'admin';
    process.env.AUTH_TEST_EMAIL = 'someone@company.com';

    validateEnv();

    const alert = errorSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('[ALERT]'));
    expect(alert).toBeDefined();
    expect(alert).toContain('AUTH_TEST_USER=admin');
    expect(alert).toContain('someone@company.com');
  });

  it('falls back to naming the default synthetic email when AUTH_TEST_EMAIL is unset', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    process.env.AUTH_TEST_USER = 'viewer';
    delete process.env.AUTH_TEST_EMAIL;

    validateEnv();

    const alert = errorSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('[ALERT]'));
    expect(alert).toContain('testuser@glooker.dev');
  });

  // Auth being OFF is now itself an alert condition. Previously silent, which is
  // how a dropped AUTH_ENABLED could turn every authorization check into "allow"
  // with no signal at all.
  it('alerts that authentication is disabled when AUTH_ENABLED is not true', () => {
    delete process.env.AUTH_ENABLED;
    process.env.AUTH_TEST_USER = 'admin';

    validateEnv();

    const alerts = errorSpy.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('[ALERT]'));
    expect(alerts.some((m) => m.includes('AUTHENTICATION IS DISABLED'))).toBe(true);
    expect(alerts.some((m) => m.includes('AUTH_TEST_USER=admin'))).toBe(true);
  });

  it('errors when AUTH_ENABLED=true but no token-verification mode is configured', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    delete process.env.AUTH_ALB_REGION;
    delete process.env.AUTH_JWKS_URL;

    validateEnv();

    const msg = errorSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('AUTH_ALB_REGION or AUTH_JWKS_URL'));
    expect(msg).toBeDefined();
  });

  it.each([['AUTH_OKTA_ISSUER', 'https://x.okta.com'], ['AUTH_OKTA_AUDIENCE', 'https://x.okta.com']])(
    'errors when only %s is set for the MCP Okta path', (k, v) => {
      delete process.env.AUTH_OKTA_ISSUER; delete process.env.AUTH_OKTA_AUDIENCE;
      process.env[k] = v;
      try {
        validateEnv();
        const msg = errorSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('AUTH_OKTA_ISSUER / AUTH_OKTA_AUDIENCE'));
        expect(msg).toBeDefined();
      } finally { delete process.env[k]; }
    });

  const errorsFor = (env: Record<string, string | undefined>, needle: string) => {
    const keys = Object.keys(env);
    const prev: Record<string, string | undefined> = {};
    for (const k of keys) { prev[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
    try {
      validateEnv();
      return errorSpy.mock.calls.map((c) => String(c[0])).some((m) => m.includes(needle));
    } finally {
      for (const k of keys) { if (prev[k] === undefined) delete process.env[k]; else (process.env as any)[k] = prev[k]; }
    }
  };

  it.each(['AUTH_ALB_ARN', 'AUTH_EXPECTED_ISS'])('errors when AUTH_ALB_REGION is set without %s', (k) => {
    const env: Record<string, string | undefined> = { AUTH_ENABLED: 'true', AUTH_ALB_REGION: 'us-east-1', AUTH_JWKS_URL: undefined,
      AUTH_ALB_ARN: 'arn:x', AUTH_EXPECTED_ISS: 'https://i' };
    env[k] = undefined;
    expect(errorsFor(env, `${k}: required with AUTH_ALB_REGION`)).toBe(true);
  });

  it.each(['AUTH_EXPECTED_ISS', 'AUTH_EXPECTED_AUD'])('errors when AUTH_JWKS_URL is set without %s', (k) => {
    const env: Record<string, string | undefined> = { AUTH_ENABLED: 'true', AUTH_JWKS_URL: 'https://k', AUTH_EXPECTED_ISS: 'https://i', AUTH_EXPECTED_AUD: 'a' };
    env[k] = undefined;
    expect(errorsFor(env, `${k}: required with AUTH_JWKS_URL`)).toBe(true);
  });

  it('errors when the Okta MCP path has no client id', () => {
    expect(errorsFor({ AUTH_OKTA_ISSUER: 'https://x.okta.com', AUTH_OKTA_AUDIENCE: 'https://x.okta.com', AUTH_OKTA_CLIENT_ID: undefined },
      'AUTH_OKTA_CLIENT_ID: required')).toBe(true);
  });

  it('errors when auth is off in production without AUTH_ALLOW_ANONYMOUS', () => {
    expect(errorsFor({ NODE_ENV: 'production', AUTH_ENABLED: 'false', AUTH_ALLOW_ANONYMOUS: undefined }, 'AUTH_ALLOW_ANONYMOUS:')).toBe(true);
    errorSpy.mockClear();
    expect(errorsFor({ NODE_ENV: 'production', AUTH_ENABLED: 'false', AUTH_ALLOW_ANONYMOUS: 'true' }, 'AUTH_ALLOW_ANONYMOUS:')).toBe(false);
  });

  it('does not alert when AUTH_ENABLED=true but AUTH_TEST_USER is unset', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    process.env.AUTH_ALB_REGION = 'us-east-1';
    delete process.env.AUTH_TEST_USER;

    validateEnv();

    const alert = errorSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('[ALERT]'));
    expect(alert).toBeUndefined();
  });
});

describe('validateEnv: GLOOK-43 vulnerability env vars', () => {
  const savedEnv = { ...process.env };
  let warnSpy: jest.SpyInstance;
  beforeEach(() => {
    process.env = { ...savedEnv, GITHUB_TOKEN: 'github_pat_x' };
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    // getVulnConfig() is memoized once per process (config.ts) — validateEnv() now reads it, so
    // every test here must force a fresh parse of whatever env it just set.
    __clearVulnConfigCache();
  });
  afterEach(() => { process.env = { ...savedEnv }; jest.restoreAllMocks(); __clearVulnConfigCache(); });
  const warned = () => warnSpy.mock.calls.flat().join('\n');

  it('warns on an invalid VULN_SYNC_CRON and VULN_SYNC_TZ when the feature is on, without echoing the values', () => {
    process.env.VULNERABILITIES_ORG = 'o';
    process.env.VULN_SYNC_CRON = 'not a cron';
    process.env.VULN_SYNC_TZ = 'Mars/Base';
    validateEnv();
    expect(warned()).toContain('VULN_SYNC_CRON');
    expect(warned()).toContain('VULN_SYNC_TZ');
    // GLOOK-43 Wave P amendment 4: the `(got "…")` suffix is dropped — messages never echo the
    // configured value.
    expect(warned()).not.toContain('not a cron');
    expect(warned()).not.toContain('Mars/Base');
  });
  it('accepts valid values', () => {
    process.env.VULNERABILITIES_ORG = 'o';
    process.env.VULN_SYNC_CRON = '0 6 * * *';
    process.env.VULN_SYNC_TZ = 'America/New_York';
    validateEnv();
    expect(warned()).not.toContain('VULN_SYNC');
  });
  it('ignores both when the feature is off', () => {
    delete process.env.VULNERABILITIES_ORG;
    process.env.VULN_SYNC_CRON = 'not a cron';
    validateEnv();
    expect(warned()).not.toContain('VULN_SYNC_CRON');
  });

  // GLOOK-43 Wave P amendment 4: getVulnConfig().errors splits into an unrecognised-variable
  // warning (reported regardless of whether the feature is enabled — a misspelled
  // VULNERABILITIES_ORG must still be caught) and every other configuration problem (reported
  // only inside the VULNERABILITIES_ORG gate, alongside the cron/TZ checks above).
  it('an unrecognised VULN_/VULNERABILITIES_ variable warns even when the feature reads as off (a misspelled org name)', () => {
    delete process.env.VULNERABILITIES_ORG;
    process.env.VULNERABILITIES_ORGG = 'acme'; // typo — never picked up as the real org
    validateEnv();
    expect(warned()).toContain('VULNERABILITIES_ORGG');
    expect(warned()).toContain('unrecognised variable');
    delete process.env.VULNERABILITIES_ORGG;
  });

  it('a known-variable configuration problem stays inside the gate: no warning when the feature is off', () => {
    delete process.env.VULNERABILITIES_ORG;
    process.env.VULN_RESOLVED_SINCE = '2099-99-99';
    validateEnv();
    expect(warned()).not.toContain('VULN_RESOLVED_SINCE');
  });

  it('surfaces a known-variable configuration problem inside the gate, without echoing the value', () => {
    process.env.VULNERABILITIES_ORG = 'o';
    process.env.VULN_RESOLVED_SINCE = '2099-99-99';
    validateEnv();
    expect(warned()).toContain('  - VULN_RESOLVED_SINCE: must be a valid YYYY-MM-DD date');
    expect(warned()).not.toContain('2099-99-99');
  });
});
