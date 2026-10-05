/**
 * The app previously set no response security headers at all. These were the
 * layers that would have contained the stored-XSS sinks and the UI-redress
 * variant of the missing CSRF defence.
 */
import nextConfig from '../../../../next.config';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

// The CSP carries a per-request nonce, so proxy.ts sets it (lib/csp.ts); the
// remaining headers are static in next.config.ts.
async function cspFor(path = '/reports'): Promise<string> {
  const res = await proxy(new NextRequest(new URL(`http://localhost${path}`)));
  return res.headers.get('Content-Security-Policy')!;
}

async function headerMap() {
  const sets = await (nextConfig as any).headers();
  expect(sets).toHaveLength(1);
  expect(sets[0].source).toBe('/:path*');
  return new Map<string, string>(sets[0].headers.map((h: any) => [h.key, h.value]));
}

describe('security headers', () => {
  it('sets every header on every path', async () => {
    const h = await headerMap();
    expect(await cspFor()).toBeTruthy();
    for (const key of [
      'Strict-Transport-Security', 'X-Content-Type-Options',
      'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy',
    ]) {
      expect(h.get(key)).toBeTruthy();
    }
  });

  it('blocks inline script, which is what stops an injected handler running', async () => {
    const prev = process.env.NODE_ENV;
    const prevAuth = process.env.AUTH_ENABLED;
    const prevAnon = process.env.AUTH_ALLOW_ANONYMOUS;
    (process.env as any).NODE_ENV = 'production';
    process.env.AUTH_ENABLED = 'false';
    process.env.AUTH_ALLOW_ANONYMOUS = 'true'; // production with auth off now needs this opt-in
    try {
      const csp = await cspFor();
      expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{20,}' 'strict-dynamic'/);
      expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
      expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
    } finally {
      (process.env as any).NODE_ENV = prev;
      if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
      if (prevAnon === undefined) delete process.env.AUTH_ALLOW_ANONYMOUS; else process.env.AUTH_ALLOW_ANONYMOUS = prevAnon;
    }
  });

  it('a 401 from the gate gets the tightest policy (it renders nothing)', async () => {
    const prevAuth = process.env.AUTH_ENABLED;
    const prevRegion = process.env.AUTH_ALB_REGION;
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_ALB_REGION = 'us-east-1';
    try {
      const res = await proxy(new NextRequest(new URL('http://localhost/api/report')));
      expect(res.status).toBe(401);
      expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    } finally {
      if (prevAuth === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = prevAuth;
      if (prevRegion === undefined) delete process.env.AUTH_ALB_REGION; else process.env.AUTH_ALB_REGION = prevRegion;
    }
  });

  it('uses a fresh nonce for every request', async () => {
    const nonce = (csp: string) => csp.match(/'nonce-([^']+)'/)![1];
    expect(nonce(await cspFor())).not.toBe(nonce(await cspFor()));
  });

  it('applies the CSP to API routes too, not only pages', async () => {
    expect(await cspFor('/api/report')).toContain("default-src 'self'");
  });

  it('denies framing and restricts form-action, base-uri and object-src', async () => {
    const csp = await cspFor();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect((await headerMap()).get('X-Frame-Options')).toBe('DENY');
  });

  it('still permits what the dashboards actually need', async () => {
    const csp = await cspFor();
    // developer_stats.avatar_url is rendered throughout.
    expect(csp).toContain('https://avatars.githubusercontent.com');
    // Recharts and the chart CSS-variable block emit inline styles.
    expect(csp).toMatch(/style-src[^;]*unsafe-inline/);
  });

  it('confines network egress to same-origin', async () => {
    expect(await cspFor()).toContain("connect-src 'self'");
  });

  it('sets a long HSTS max-age', async () => {
    const hsts = (await headerMap()).get('Strict-Transport-Security')!;
    expect(Number(hsts.match(/max-age=(\d+)/)![1])).toBeGreaterThanOrEqual(31536000);
  });
});
