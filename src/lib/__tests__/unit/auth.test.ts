/**
 * Auth tests.
 *
 * The previous version of this file built tokens with the literal signature
 * "fakesignature" and asserted that extractUser ACCEPTED them — it encoded the
 * vulnerability as expected behaviour. Every token here is really signed, and
 * the central case is that a tampered signature is refused.
 */
import { SignJWT, exportSPKI, generateKeyPair } from 'jose';
import { _clearKeyCache, extractUser, isAdmin, isAuthEnabled, requireAdmin } from '@/lib/auth';

const KID = 'test-key-1';
const REGION = 'us-east-1';
const ALB_KEY_URL = `https://public-keys.auth.elb.${REGION}.amazonaws.com/${KID}`;
const ALB_ARN = 'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/ours/abc123';
const ISS = 'https://idp.example/';

let privateKey: CryptoKey;
let spkiPem: string;

beforeAll(async () => {
  const kp = await generateKeyPair('ES256', { extractable: true });
  privateKey = kp.privateKey as CryptoKey;
  spkiPem = await exportSPKI(kp.publicKey as CryptoKey);
});

async function sign(
  payload: Record<string, unknown>,
  opts: { kid?: string; alg?: string; expiresIn?: string; issuer?: string; signer?: string | null } = {},
): Promise<string> {
  // ALB puts `signer` (the load balancer's ARN) in the protected header.
  const header: Record<string, unknown> = { alg: opts.alg ?? 'ES256', kid: opts.kid ?? KID };
  if (opts.signer !== null) header.signer = opts.signer ?? ALB_ARN;
  return new SignJWT(payload)
    .setProtectedHeader(header as any)
    .setIssuedAt()
    .setExpirationTime(opts.expiresIn ?? '5m')
    .setIssuer(opts.issuer ?? 'https://idp.example/')
    .sign(privateKey);
}

/** Serve the real SPKI for KID; 404 anything else. */
function mockKeyEndpoint() {
  global.fetch = jest.fn(async (url: any) => {
    if (String(url) === ALB_KEY_URL) {
      return { ok: true, status: 200, text: async () => spkiPem } as any;
    }
    return { ok: false, status: 404, text: async () => 'not found' } as any;
  }) as any;
}

const SAVED: Record<string, string | undefined> = {};
const KEYS = [
  'AUTH_ENABLED', 'AUTH_HEADER', 'AUTH_ADMIN_GROUP', 'AUTH_ALB_REGION',
  'AUTH_JWKS_URL', 'AUTH_EXPECTED_ISS', 'AUTH_TEST_USER', 'AUTH_TEST_EMAIL',
  'AUTH_ALLOW_ANONYMOUS_ADMIN', 'NODE_ENV', 'AUTH_ALB_ARN', 'AUTH_EXPECTED_AUD', 'AUTH_ALLOW_ANONYMOUS',
];

beforeEach(() => {
  for (const k of KEYS) SAVED[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.AUTH_ENABLED = 'true';
  process.env.AUTH_ALB_REGION = REGION;
  process.env.AUTH_ALB_ARN = ALB_ARN;
  process.env.AUTH_EXPECTED_ISS = ISS;
  process.env.AUTH_ADMIN_GROUP = 'splunk-admin';
  _clearKeyCache();
  mockKeyEndpoint();
});

afterEach(() => {
  for (const k of KEYS) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
  jest.restoreAllMocks();
});

const hdr = (token?: string) =>
  new Headers(token ? { 'x-amzn-oidc-data': token } : {});

describe('extractUser — signature verification', () => {
  it('accepts a correctly signed token', async () => {
    const u = await extractUser(hdr(await sign({ email: 'user@example.com', sub: 'abc', name: 'Test User', groups: ['splunk-admin', 'Everyone'] })));
    expect(u).toEqual({
      email: 'user@example.com', sub: 'abc',
      name: 'Test User', groups: ['splunk-admin', 'Everyone'],
    });
  });

  // The F-01 regression test. Before verification existed, this forged token
  // was accepted and granted admin.
  it('REJECTS a token whose signature has been tampered with', async () => {
    const good = await sign({ email: 'user@example.com', sub: 'abc' });
    const [h, p] = good.split('.');
    expect(await extractUser(hdr(`${h}.${p}.tampered`))).toBeNull();
  });

  it('REJECTS an unsigned header fabricated from scratch', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid: KID })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ email: 'attacker@evil.example', groups: ['splunk-admin'] })).toString('base64url');
    expect(await extractUser(hdr(`${h}.${p}.x`))).toBeNull();
  });

  it('REJECTS a payload swapped onto a valid signature', async () => {
    const good = await sign({ email: 'viewer@example.com', sub: '1', groups: [] });
    const [h, , sig] = good.split('.');
    const evil = Buffer.from(JSON.stringify({ email: 'viewer@example.com', sub: '1', groups: ['splunk-admin'] })).toString('base64url');
    expect(await extractUser(hdr(`${h}.${evil}.${sig}`))).toBeNull();
  });

  it('REJECTS alg: none', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'none', kid: KID })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ email: 'a@b.com', groups: ['splunk-admin'] })).toString('base64url');
    expect(await extractUser(hdr(`${h}.${p}.`))).toBeNull();
  });

  it('REJECTS an expired token', async () => {
    const token = await new SignJWT({ email: 'a@b.com', sub: '1' })
      .setProtectedHeader({ alg: 'ES256', kid: KID, signer: ALB_ARN } as any)
      .setIssuer(ISS)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    expect(await extractUser(hdr(token))).toBeNull();
  });

  it('REJECTS a token signed by an unknown key id', async () => {
    expect(await extractUser(hdr(await sign({ email: 'a@b.com' }, { kid: 'other-key' })))).toBeNull();
  });

  it('REJECTS a kid that tries to escape the AWS key path', async () => {
    await extractUser(hdr(await sign({ email: 'a@b.com' }, { kid: '../../evil' })));
    const called = (global.fetch as jest.Mock).mock.calls.map(c => String(c[0]));
    expect(called.some(u => u.includes('evil'))).toBe(false);
  });

  it('enforces AUTH_EXPECTED_ISS', async () => {
    expect(await extractUser(hdr(await sign({ email: 'a@b.com' })))).not.toBeNull();
    expect(await extractUser(hdr(await sign({ email: 'a@b.com' }, { issuer: 'https://evil.example/' })))).toBeNull();
  });

  it('denies when enabled but no verification mode is configured', async () => {
    delete process.env.AUTH_ALB_REGION;
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractUser(hdr(await sign({ email: 'a@b.com' })))).toBeNull();
  });

  it('returns null when the header is absent', async () => {
    expect(await extractUser(hdr())).toBeNull();
  });

  it('returns null when the verified payload carries no email', async () => {
    expect(await extractUser(hdr(await sign({ sub: '123' })))).toBeNull();
  });

  it('honours a custom AUTH_HEADER name', async () => {
    process.env.AUTH_HEADER = 'x-custom-auth';
    const token = await sign({ email: 'a@b.com', sub: '1' });
    expect(await extractUser(new Headers({ 'x-custom-auth': token }))).not.toBeNull();
    expect(await extractUser(new Headers({ 'x-amzn-oidc-data': token }))).toBeNull();
  });

  it('caches the ALB key rather than refetching per request', async () => {
    const token = await sign({ email: 'a@b.com', sub: '1' });
    await extractUser(hdr(token));
    await extractUser(hdr(token));
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  // PR #81 review (critical): the AWS key host serves keys for EVERY ALB in the
  // region, so a valid signature alone proves nothing — someone else's ALB can mint
  // one. The token's `signer` must be our ALB.
  it("REJECTS a correctly signed token from someone else's ALB, before fetching any key", async () => {
    const foreign = await sign({ email: 'a@b.com', groups: ['splunk-admin'] },
      { signer: 'arn:aws:elasticloadbalancing:us-east-1:999999999999:loadbalancer/app/theirs/zzz' });
    expect(await extractUser(hdr(foreign))).toBeNull();
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(0);
  });

  it('REJECTS a token with no signer', async () => {
    expect(await extractUser(hdr(await sign({ email: 'a@b.com' }, { signer: null })))).toBeNull();
  });

  it.each([['AUTH_ALB_ARN'], ['AUTH_EXPECTED_ISS']])('denies every ALB token when %s is unset', async (k) => {
    delete process.env[k];
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractUser(hdr(await sign({ email: 'a@b.com' })))).toBeNull();
  });

  it('caches a failed key lookup instead of refetching per request', async () => {
    const t = await sign({ email: 'a@b.com' }, { kid: 'unknown-key' });
    await extractUser(hdr(t));
    await extractUser(hdr(await sign({ email: 'b@b.com' }, { kid: 'unknown-key' })));
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('shares one in-flight key fetch between concurrent requests', async () => {
    const [a, b] = await Promise.all([sign({ email: 'a@b.com' }), sign({ email: 'b@b.com' })]);
    await Promise.all([extractUser(hdr(a)), extractUser(hdr(b))]);
    expect((global.fetch as jest.Mock).mock.calls.length).toBe(1);
  });

  it('bounds the key cache', async () => {
    const { _albKeyCacheSizeForTests, ALB_KEY_CACHE_MAX } = await import('@/lib/auth');
    for (let i = 0; i < ALB_KEY_CACHE_MAX + 20; i++) {
      await extractUser(hdr(await sign({ email: 'a@b.com' }, { kid: `k${i}` })));
    }
    expect(_albKeyCacheSizeForTests()).toBeLessThanOrEqual(ALB_KEY_CACHE_MAX);
  });

  it('verifies a given token once, not once per caller in the same request', async () => {
    const jose = await import('jose');
    const spy = jest.spyOn(jose, 'jwtVerify');
    const token = await sign({ email: 'a@b.com', sub: '1' });
    await extractUser(hdr(token));
    await extractUser(hdr(token));
    await extractUser(hdr(token));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('does not reuse a memoized identity past the token expiry', async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const token = await sign({ email: 'a@b.com', sub: '1' }, { expiresIn: '2m' });
      expect(await extractUser(hdr(token))).not.toBeNull();
      jest.setSystemTime(Date.now() + 10 * 60_000);
      expect(await extractUser(hdr(token))).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  it('drops non-string entries from groups', async () => {
    const u = await extractUser(hdr(await sign({ email: 'a@b.com', groups: ['ok', 42, null, { x: 1 }] })));
    expect(u!.groups).toEqual(['ok']);
  });
});

describe('isAuthEnabled — secure default', () => {
  it('is on when unset in production', () => {
    delete process.env.AUTH_ENABLED;
    (process.env as any).NODE_ENV = 'production';
    expect(isAuthEnabled()).toBe(true);
  });

  it('is off when unset outside production', () => {
    delete process.env.AUTH_ENABLED;
    (process.env as any).NODE_ENV = 'development';
    expect(isAuthEnabled()).toBe(false);
  });

  it('treats near-miss values as not-true rather than silently enabling', () => {
    (process.env as any).NODE_ENV = 'development';
    for (const v of ['True', 'TRUE', '1', 'yes', '']) {
      process.env.AUTH_ENABLED = v;
      expect(isAuthEnabled()).toBe(false);
    }
  });
});

describe('AUTH_TEST_USER bypass', () => {
  it('works outside production', async () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_TEST_USER = 'admin';
    const u = await extractUser(hdr());
    expect(u).toMatchObject({ email: 'testuser@glooker.dev', groups: ['splunk-admin'] });
  });

  // F-05: this used to be reachable in production via
  // AUTH_TEST_ALLOW_IN_PRODUCTION, which that variable no longer does.
  it('is inert in production even with the old opt-in set', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.AUTH_TEST_USER = 'admin';
    process.env.AUTH_TEST_EMAIL = 'ceo@corp.example';
    (process.env as any).AUTH_TEST_ALLOW_IN_PRODUCTION = 'true';
    expect(await extractUser(hdr())).toBeNull();
    delete (process.env as any).AUTH_TEST_ALLOW_IN_PRODUCTION;
  });
});

describe('requireAdmin / isAdmin', () => {
  const req = (token?: string) =>
    new Request('http://localhost/api/test', { headers: token ? { 'x-amzn-oidc-data': token } : {} });

  it('allows a verified member of the admin group', async () => {
    expect(await requireAdmin(req(await sign({ email: 'a@b.com', sub: '1', groups: ['splunk-admin'] })))).toBeNull();
  });

  it('denies a verified non-member', async () => {
    const res = await requireAdmin(req(await sign({ email: 'a@b.com', sub: '1', groups: ['Everyone'] })));
    expect(res!.status).toBe(403);
  });

  it('denies a forged admin claim', async () => {
    const good = await sign({ email: 'a@b.com', sub: '1', groups: ['splunk-admin'] });
    const [h, p] = good.split('.');
    const res = await requireAdmin(req(`${h}.${p}.forged`));
    expect(res!.status).toBe(403);
  });

  it('denies when no header is present', async () => {
    expect((await requireAdmin(req()))!.status).toBe(403);
  });

  it('denies when AUTH_ADMIN_GROUP is empty', async () => {
    process.env.AUTH_ADMIN_GROUP = '';
    const res = await requireAdmin(req(await sign({ email: 'a@b.com', sub: '1', groups: ['splunk-admin'] })));
    expect(res!.status).toBe(403);
  });

  // F-04: the controls used to grant everything the moment auth was disabled.
  it('allows anonymous admin outside production when auth is off', async () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.AUTH_ENABLED = 'false';
    expect(await requireAdmin(req())).toBeNull();
    expect(await isAdmin(req())).toBe(true);
  });

  it('DENIES anonymous admin in production when auth is off', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.AUTH_ENABLED = 'false';
    expect((await requireAdmin(req()))!.status).toBe(403);
    expect(await isAdmin(req())).toBe(false);
  });

  it('allows it in production only with the explicit second opt-in', async () => {
    (process.env as any).NODE_ENV = 'production';
    process.env.AUTH_ENABLED = 'false';
    process.env.AUTH_ALLOW_ANONYMOUS_ADMIN = 'true';
    expect(await requireAdmin(req())).toBeNull();
  });
});

// PR #81 review: the JWKS path pinned neither audience nor (by default) issuer,
// so a token the same IdP signed for a DIFFERENT app would authenticate here.
describe('extractUser — AUTH_JWKS_URL path requires issuer and audience', () => {
  const JWKS = 'https://idp.example/keys';
  let rsKey: CryptoKey;
  let rsJwk: Record<string, unknown>;
  beforeAll(async () => {
    const { exportJWK } = await import('jose');
    const kp = await generateKeyPair('RS256', { extractable: true });
    rsKey = kp.privateKey as CryptoKey;
    rsJwk = { ...(await exportJWK(kp.publicKey)), kid: 'rs1', alg: 'RS256' };
  });
  beforeEach(() => {
    delete process.env.AUTH_ALB_REGION;
    process.env.AUTH_JWKS_URL = JWKS;
    process.env.AUTH_EXPECTED_ISS = ISS;
    process.env.AUTH_EXPECTED_AUD = 'glooker';
    global.fetch = jest.fn(async (url: any) => String(url instanceof Request ? url.url : url) === JWKS
      ? new Response(JSON.stringify({ keys: [rsJwk] }), { status: 200, headers: { 'content-type': 'application/json' } })
      : new Response('nf', { status: 404 })) as any;
  });
  const rs = (aud: string, iss = ISS) => new SignJWT({ email: 'a@b.com', sub: '1' })
    .setProtectedHeader({ alg: 'RS256', kid: 'rs1' }).setIssuedAt().setExpirationTime('5m')
    .setIssuer(iss).setAudience(aud).sign(rsKey);

  it('accepts the right issuer and audience', async () => {
    expect(await extractUser(hdr(await rs('glooker')))).not.toBeNull();
  });
  it("REJECTS a token for another app (wrong audience)", async () => {
    expect(await extractUser(hdr(await rs('some-other-app')))).toBeNull();
  });
  it('REJECTS a wrong issuer', async () => {
    expect(await extractUser(hdr(await rs('glooker', 'https://evil.example/')))).toBeNull();
  });
  it.each([['AUTH_EXPECTED_AUD'], ['AUTH_EXPECTED_ISS']])('denies every JWKS token when %s is unset', async (k) => {
    delete process.env[k];
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await extractUser(hdr(await rs('glooker')))).toBeNull();
  });
});

// PR #81 review: in production AUTH_ENABLED=false alone opened every READ route
// (AUTH_ALLOW_ANONYMOUS_ADMIN only governed admin). It now needs its own opt-in.
describe('anonymous access in production', () => {
  const gate = async (path: string) => {
    const { NextRequest } = await import('next/server');
    const { proxy } = await import('@/proxy');
    return proxy(new NextRequest(new URL(`http://localhost${path}`)));
  };
  beforeEach(() => {
    (process.env as any).NODE_ENV = 'production';
    process.env.AUTH_ENABLED = 'false';
    delete process.env.AUTH_ALLOW_ANONYMOUS;
  });
  afterEach(() => { delete process.env.AUTH_ALLOW_ANONYMOUS; });

  it('denies reads when auth is off without AUTH_ALLOW_ANONYMOUS', async () => {
    expect((await gate('/api/report')).status).toBe(503);
    expect((await gate('/reports')).status).toBe(503);
  });
  it('keeps the liveness probe open', async () => {
    expect((await gate('/api/health')).status).not.toBe(503);
  });
  it('lets requests through with the explicit opt-in', async () => {
    process.env.AUTH_ALLOW_ANONYMOUS = 'true';
    expect((await gate('/api/report')).headers.get('x-middleware-next')).toBe('1');
  });
  it('is unaffected outside production', async () => {
    (process.env as any).NODE_ENV = 'development';
    expect((await gate('/api/report')).headers.get('x-middleware-next')).toBe('1');
  });
});

// PR #81 review: authentication now lives only in the proxy, so its matcher IS the
// perimeter. Pin that it covers every API route and page, and skips only assets.
describe('proxy matcher coverage', () => {
  it('matches API routes and pages, and excludes only static assets', async () => {
    const { config } = await import('@/proxy');
    const re = new RegExp(`^${config.matcher[0].replace('/((?!', '/(?!(').replace(').*)', ')).*')}$`);
    const fs = await import('fs'); const path = await import('path');
    const appDir = path.join(__dirname, '../../../app');
    const routes: string[] = [];
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/^(route|page)\.tsx?$/.test(e.name)) {
        routes.push('/' + path.relative(appDir, path.dirname(f)).split(path.sep).filter(Boolean)
          .map(s => s.replace(/^\[\.*(.+?)\]$/, 'x')).join('/'));
      }
    } };
    walk(appDir);
    expect(routes.length).toBeGreaterThan(40);
    const unmatched = routes.filter(r => !re.test(r));
    expect(unmatched).toEqual([]);
    for (const asset of ['/_next/static/chunks/a.js', '/_next/image', '/favicon.ico', '/icon.svg']) {
      expect(re.test(asset)).toBe(false);
    }
  });
});
