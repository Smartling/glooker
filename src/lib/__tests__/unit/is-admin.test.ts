import { isAdmin } from '../../auth';

/**
 * isAdmin is async now that identity comes from a verified token (see
 * auth.test.ts for the signature-verification cases). These cases drive it
 * through AUTH_TEST_USER so they exercise the group logic without re-testing
 * the crypto, and they no longer rely on an unsigned header being accepted.
 */
const mkReq = (headers: Record<string, string> = {}): Request => ({
  headers: { get: (k: string) => headers[k] ?? null } as any,
}) as any;

describe('isAdmin', () => {
  const origEnv = { ...process.env };
  afterEach(() => { process.env = { ...origEnv }; });

  it('allows anonymous admin when auth is disabled outside production', async () => {
    delete process.env.AUTH_ENABLED;
    (process.env as any).NODE_ENV = 'development';
    await expect(isAdmin(mkReq())).resolves.toBe(true);
  });

  it('denies anonymous admin when auth is disabled in production', async () => {
    process.env.AUTH_ENABLED = 'false';
    (process.env as any).NODE_ENV = 'production';
    await expect(isAdmin(mkReq())).resolves.toBe(false);
  });

  it('returns false when auth enabled but no token is present', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    await expect(isAdmin(mkReq())).resolves.toBe(false);
  });

  it('returns false when auth enabled and the token is unsigned', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    process.env.AUTH_ALB_REGION = 'us-east-1';
    const payload = Buffer.from(JSON.stringify({ email: 'a@b.com', groups: ['admins'] })).toString('base64url');
    await expect(isAdmin(mkReq({ 'x-amzn-oidc-data': `h.${payload}.` }))).resolves.toBe(false);
  });

  it('returns true for AUTH_TEST_USER=admin', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'admin';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    await expect(isAdmin(mkReq())).resolves.toBe(true);
  });

  it('returns false for AUTH_TEST_USER=viewer', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'viewer';
    process.env.AUTH_ADMIN_GROUP = 'admins';
    await expect(isAdmin(mkReq())).resolves.toBe(false);
  });

  it('returns false when AUTH_ADMIN_GROUP is unset', async () => {
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'admin';
    delete process.env.AUTH_ADMIN_GROUP;
    await expect(isAdmin(mkReq())).resolves.toBe(false);
  });
});
