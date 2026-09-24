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

  it('does not alert when AUTH_TEST_USER is set but AUTH_ENABLED is not true', () => {
    delete process.env.AUTH_ENABLED;
    process.env.AUTH_TEST_USER = 'admin';

    validateEnv();

    const alert = errorSpy.mock.calls.map((c) => String(c[0])).find((m) => m.includes('[ALERT]'));
    expect(alert).toBeUndefined();
  });

  it('does not alert when AUTH_ENABLED=true but AUTH_TEST_USER is unset', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
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
