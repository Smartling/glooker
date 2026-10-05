/**
 * MCP identity via the mcp-okta-proxy sidecar.
 *
 * The sidecar validates the caller's Okta access token and (with
 * OKTA_MCP_PROXY_ACCESS_TOKEN_HEADER_NAME set) forwards that ORIGINAL token in
 * `x-okta-access-token`. Glooker verifies it against Okta's JWKS itself — it
 * never trusts an unsigned identity header — and reads email/groups from Okta's
 * /userinfo using the verified token, because Okta's org authorization server
 * issues access tokens without those claims.
 *
 * Every token here is really signed with a locally generated RS256 key.
 */
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { _clearKeyCache, extractUser, isAdmin } from '@/lib/auth';

const ISS = 'https://login.example.okta.com';
const AUD = 'https://login.example.okta.com';
const JWKS_URL = `${ISS}/oauth2/v1/keys`;
const USERINFO_URL = `${ISS}/oauth2/v1/userinfo`;
const KID = 'okta-key-1';

let privateKey: CryptoKey;
let otherKey: CryptoKey;
let jwk: Record<string, unknown>;
let userinfo: { status: number; body: unknown };
let userinfoCalls: number;

beforeAll(async () => {
  const kp = await generateKeyPair('RS256', { extractable: true });
  privateKey = kp.privateKey as CryptoKey;
  jwk = { ...(await exportJWK(kp.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  otherKey = (await generateKeyPair('RS256')).privateKey as CryptoKey;
});

async function oktaToken(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; alg?: string; iss?: string; aud?: string; exp?: string } = {},
): Promise<string> {
  return new SignJWT({ sub: 'alice@example.com', cid: 'mcp-client', scp: ['openid'], ...claims })
    .setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: KID })
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? AUD)
    .sign(opts.key ?? privateKey);
}

const SAVED: Record<string, string | undefined> = {};
const KEYS = [
  'AUTH_ENABLED', 'AUTH_HEADER', 'AUTH_ADMIN_GROUP', 'AUTH_ALB_REGION', 'AUTH_JWKS_URL',
  'AUTH_EXPECTED_ISS', 'AUTH_TEST_USER', 'NODE_ENV', 'AUTH_OKTA_ISSUER', 'AUTH_OKTA_AUDIENCE',
  'AUTH_OKTA_CLIENT_ID', 'AUTH_OKTA_JWKS_URL', 'AUTH_OKTA_USERINFO_URL', 'AUTH_OKTA_TOKEN_HEADER',
];

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.AUTH_ENABLED = 'true';
  process.env.AUTH_ALB_REGION = 'us-east-1';
  process.env.AUTH_ADMIN_GROUP = 'glooker-admin';
  process.env.AUTH_OKTA_ISSUER = ISS;
  process.env.AUTH_OKTA_AUDIENCE = AUD;
  process.env.AUTH_OKTA_CLIENT_ID = 'mcp-client';
  _clearKeyCache();
  userinfo = { status: 200, body: { sub: 'alice@example.com', email: 'alice@example.com', name: 'Alice', groups: ['glooker-admin', 'Everyone'] } };
  userinfoCalls = 0;
  global.fetch = jest.fn(async (url: any) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u === JWKS_URL) {
      return new Response(JSON.stringify({ keys: [jwk] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u === USERINFO_URL) {
      userinfoCalls++;
      return new Response(JSON.stringify(userinfo.body), { status: userinfo.status, headers: { 'content-type': 'application/json' } });
    }
    return new Response('not found', { status: 404 });
  }) as any;
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  jest.restoreAllMocks();
});

const okta = (token: string) => new Headers({ 'x-okta-access-token': token });

describe('extractUser — Okta access token from the MCP sidecar', () => {
  it('accepts a correctly signed token and takes email/groups from /userinfo', async () => {
    const u = await extractUser(okta(await oktaToken()));
    expect(u).toEqual({ email: 'alice@example.com', sub: 'alice@example.com', name: 'Alice', groups: ['glooker-admin', 'Everyone'] });
  });

  it('calls /userinfo with the verified token as the bearer', async () => {
    const token = await oktaToken();
    await extractUser(okta(token));
    const call = (global.fetch as jest.Mock).mock.calls.find(c => String(c[0]) === USERINFO_URL);
    expect(new Headers(call![1].headers).get('authorization')).toBe(`Bearer ${token}`);
  });

  it('caches the userinfo lookup per token', async () => {
    const token = await oktaToken();
    await extractUser(okta(token));
    await extractUser(okta(token));
    expect(userinfoCalls).toBe(1);
  });

  it('makes an Okta admin an admin', async () => {
    const req = new Request('http://localhost/api/mcp', { headers: { 'x-okta-access-token': await oktaToken() } });
    expect(await isAdmin(req)).toBe(true);
  });

  it('REJECTS the sidecar\'s old unsigned alg=none synthetic token', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ email: 'attacker@evil.example', groups: ['glooker-admin'] })).toString('base64url');
    expect(await extractUser(okta(`${h}.${p}.`))).toBeNull();
    expect(await extractUser(new Headers({ 'x-amzn-oidc-data': `${h}.${p}.` }))).toBeNull();
  });

  it('REJECTS a token signed by a key Okta does not publish', async () => {
    expect(await extractUser(okta(await oktaToken({}, { key: otherKey })))).toBeNull();
  });

  it('REJECTS a tampered payload', async () => {
    const [h, , s] = (await oktaToken()).split('.');
    const p = Buffer.from(JSON.stringify({ sub: 'mallory@evil.example', iss: ISS, aud: AUD, exp: 9999999999 })).toString('base64url');
    expect(await extractUser(okta(`${h}.${p}.${s}`))).toBeNull();
  });

  it.each([
    ['a wrong issuer', { iss: 'https://evil.example.okta.com' }],
    ['a wrong audience', { aud: 'api://something-else' }],
    ['an expired token', { exp: '-1m' }],
  ])('REJECTS %s', async (_label, opts) => {
    expect(await extractUser(okta(await oktaToken({}, opts as any)))).toBeNull();
  });

  // PR #81 review: dev's audience is the org-wide https://<tenant>.okta.com that
  // every app in the tenant shares, so the cid pin is what stops another app's token.
  it('requires AUTH_OKTA_CLIENT_ID — without it Okta tokens are denied', async () => {
    delete process.env.AUTH_OKTA_CLIENT_ID;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractUser(okta(await oktaToken()))).toBeNull();
  });

  // PR #81 review: /userinfo's subject must be the token's. Okta's org server puts
  // the login in the access token's `sub` and the user id in `uid`, while /userinfo
  // returns sub = user id — so compare against uid when the token has one.
  it('REJECTS a /userinfo response for a different principal', async () => {
    userinfo = { status: 200, body: { sub: '00u-someone-else', email: 'mallory@example.com', groups: ['glooker-admin'] } };
    expect(await extractUser(okta(await oktaToken({ uid: '00u-alice' })))).toBeNull();
  });

  it("accepts /userinfo whose sub is the token's uid (Okta org-server shape)", async () => {
    userinfo = { status: 200, body: { sub: '00u-alice', email: 'alice@example.com', groups: [] } };
    expect(await extractUser(okta(await oktaToken({ uid: '00u-alice' })))).toMatchObject({ email: 'alice@example.com' });
  });

  it('REJECTS /userinfo with no sub at all', async () => {
    userinfo = { status: 200, body: { email: 'alice@example.com' } };
    expect(await extractUser(okta(await oktaToken()))).toBeNull();
  });

  it('enforces AUTH_OKTA_CLIENT_ID', async () => {
    expect(await extractUser(okta(await oktaToken()))).not.toBeNull();
    expect(await extractUser(okta(await oktaToken({ cid: 'some-other-app' })))).toBeNull();
  });

  it('denies when /userinfo fails, rather than inventing an identity', async () => {
    userinfo = { status: 401, body: { error: 'invalid_token' } };
    expect(await extractUser(okta(await oktaToken()))).toBeNull();
  });

  it('denies when /userinfo returns no email', async () => {
    userinfo = { status: 200, body: { sub: 'x' } };
    expect(await extractUser(okta(await oktaToken()))).toBeNull();
  });

  it('ignores the Okta header entirely when Okta verification is not configured', async () => {
    delete process.env.AUTH_OKTA_ISSUER;
    expect(await extractUser(okta(await oktaToken()))).toBeNull();
  });

  it('refuses a half-configured Okta verifier (issuer without audience)', async () => {
    delete process.env.AUTH_OKTA_AUDIENCE;
    expect(await extractUser(okta(await oktaToken()))).toBeNull();
  });

  it('derives JWKS and userinfo URLs for a custom authorization server issuer', async () => {
    const custom = `${ISS}/oauth2/aus123`;
    process.env.AUTH_OKTA_ISSUER = custom;
    process.env.AUTH_OKTA_JWKS_URL = JWKS_URL;            // keys served at the mock path
    process.env.AUTH_OKTA_USERINFO_URL = USERINFO_URL;
    expect(await extractUser(okta(await oktaToken({}, { iss: custom })))).not.toBeNull();
  });
});

describe('proxy gate — the Okta token only counts on /api/mcp', () => {
  // Imported lazily so the module picks up the env set in beforeEach.
  const gate = async (path: string, headers: Record<string, string>) => {
    const { NextRequest } = await import('next/server');
    const { proxy } = await import('@/proxy');
    return proxy(new NextRequest(new URL(`http://localhost${path}`), { headers }));
  };
  const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';

  it('lets a verified Okta token through on /api/mcp', async () => {
    const res = await gate('/api/mcp', { 'x-okta-access-token': await oktaToken() });
    expect(passedThrough(res)).toBe(true);
  });

  it.each(['/api/report', '/api/vulnerabilities/alerts', '/settings', '/api/mcpx', '/api/mcp/../report'])(
    'does NOT accept the same token on %s', async (path) => {
      const res = await gate(path, { 'x-okta-access-token': await oktaToken() });
      expect(res.status).toBe(401);
    });

  it('strips the Okta header from the request forwarded to any non-MCP route', async () => {
    // A browser request with a valid ALB identity must not carry an Okta token
    // further either — nothing downstream should ever see one outside /api/mcp.
    const { sanitizeIdentityHeaders } = await import('@/lib/auth');
    const h = sanitizeIdentityHeaders(new Headers({ 'x-okta-access-token': 't', 'x-amzn-oidc-data': 'a' }), '/api/report');
    expect(h.get('x-okta-access-token')).toBeNull();
    expect(h.get('x-amzn-oidc-data')).toBe('a');
    const m = sanitizeIdentityHeaders(new Headers({ 'x-okta-access-token': 't' }), '/api/mcp');
    expect(m.get('x-okta-access-token')).toBe('t');
  });
});
