import { isAdmin } from '../../auth';

const mkReq = (headers: Record<string, string> = {}): Request => ({
  headers: { get: (k: string) => headers[k] ?? null } as any,
}) as any;

describe('isAdmin', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  it('returns true when auth disabled', () => {
    delete process.env.AUTH_ENABLED;
    expect(isAdmin(mkReq())).toBe(true);
  });

  it('returns false when auth enabled but no JWT', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    expect(isAdmin(mkReq())).toBe(false);
  });

  it('returns true for AUTH_TEST_USER=admin', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'admin';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    expect(isAdmin(mkReq())).toBe(true);
  });

  it('returns false for AUTH_TEST_USER=viewer', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'viewer';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    expect(isAdmin(mkReq())).toBe(false);
  });

  it('returns false when AUTH_ADMIN_GROUP is unset', () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'admin';
    delete process.env.AUTH_ADMIN_GROUP;
    expect(isAdmin(mkReq())).toBe(false);
  });
});
