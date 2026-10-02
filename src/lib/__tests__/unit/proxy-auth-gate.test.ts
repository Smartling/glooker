/**
 * The deny-by-default gate. Before this existed, authorization was opt-in per
 * handler and 24 of 62 exported handlers referenced no auth function at all.
 */
import { NextRequest } from 'next/server';
import { proxy, config } from '@/proxy';

const KEYS = ['AUTH_ENABLED', 'AUTH_ALB_REGION', 'AUTH_TEST_USER', 'AUTH_ADMIN_GROUP', 'NODE_ENV'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  process.env.AUTH_ENABLED = 'true';
  process.env.AUTH_ALB_REGION = 'us-east-1';
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const req = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(`http://localhost${path}`), { headers });

/** NextResponse.next() carries this header; a short-circuit response does not. */
const passedThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';

describe('proxy auth gate', () => {
  it('401s an unauthenticated API request', async () => {
    const res = await proxy(req('/api/report'));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'Unauthorized' });
  });

  it('401s an unauthenticated page request with a plain-text body', async () => {
    const res = await proxy(req('/vulnerabilities'));
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
  });

  // These were the worst of the ungated reads: unpatched critical CVEs with due
  // dates, an LLM agent, and the server PAT aimed at a caller-chosen org.
  it.each([
    '/api/vulnerabilities/alerts',
    '/api/vulnerabilities/summary',
    '/api/report',
    '/api/report/abc/org',
    '/api/chat',
    '/api/developers',
    '/api/settings/user-mappings',
    '/api/settings/github/test-connection',
    '/api/llm-config',
    '/api/mcp',
    '/api/projects/GLOOK-1/stats',
  ])('denies %s without an identity', async (path) => {
    expect((await proxy(req(path))).status).toBe(401);
  });

  it('lets the liveness probe through — it has no auth, no DB and no secrets', async () => {
    expect(passedThrough(await proxy(req('/api/health')))).toBe(true);
  });

  it('rejects a forged identity header', async () => {
    const h = Buffer.from(JSON.stringify({ alg: 'ES256', kid: 'k' })).toString('base64url');
    const p = Buffer.from(JSON.stringify({ email: 'x@y', groups: ['splunk-admin'] })).toString('base64url');
    const res = await proxy(req('/api/report', { 'x-amzn-oidc-data': `${h}.${p}.forged` }));
    expect(res.status).toBe(401);
  });

  it('passes a verified identity through', async () => {
    // AUTH_TEST_USER stands in for a verified token here; signature cases live
    // in auth.test.ts.
    (process.env as any).NODE_ENV = 'development';
    process.env.AUTH_TEST_USER = 'viewer';
    expect(passedThrough(await proxy(req('/api/report')))).toBe(true);
  });

  it('is inert when auth is disabled, matching isAuthEnabled() elsewhere', async () => {
    (process.env as any).NODE_ENV = 'development';
    process.env.AUTH_ENABLED = 'false';
    expect(passedThrough(await proxy(req('/api/report')))).toBe(true);
  });

  it('is active by default in production even with AUTH_ENABLED unset', async () => {
    delete process.env.AUTH_ENABLED;
    (process.env as any).NODE_ENV = 'production';
    expect((await proxy(req('/api/report'))).status).toBe(401);
  });
});

describe('proxy matcher', () => {
  it('covers everything except Next static output', () => {
    expect(config.matcher).toEqual(['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)']);
  });

  // The point of a broad matcher: a newly added route is covered by default
  // rather than needing to be remembered.
  it('matches arbitrary new API paths', () => {
    const re = new RegExp(`^${config.matcher[0]}$`);
    for (const p of ['/api/some/brand/new/route', '/api/report', '/settings']) {
      expect(re.test(p)).toBe(true);
    }
    for (const p of ['/_next/static/chunk.js', '/favicon.ico']) {
      expect(re.test(p)).toBe(false);
    }
  });
});
