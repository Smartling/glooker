import { validateEnv } from '@/lib/env-validation';

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
