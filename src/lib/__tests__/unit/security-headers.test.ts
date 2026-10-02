/**
 * The app previously set no response security headers at all. These were the
 * layers that would have contained the stored-XSS sinks and the UI-redress
 * variant of the missing CSRF defence.
 */
import nextConfig from '../../../../next.config';

async function headerMap() {
  const sets = await (nextConfig as any).headers();
  expect(sets).toHaveLength(1);
  expect(sets[0].source).toBe('/:path*');
  return new Map<string, string>(sets[0].headers.map((h: any) => [h.key, h.value]));
}

describe('security headers', () => {
  it('sets every header on every path', async () => {
    const h = await headerMap();
    for (const key of [
      'Content-Security-Policy', 'Strict-Transport-Security', 'X-Content-Type-Options',
      'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy',
    ]) {
      expect(h.get(key)).toBeTruthy();
    }
  });

  it('blocks inline script, which is what stops an injected handler running', async () => {
    const csp = (await headerMap()).get('Content-Security-Policy')!;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-eval/);
  });

  it('denies framing and restricts form-action, base-uri and object-src', async () => {
    const csp = (await headerMap()).get('Content-Security-Policy')!;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("form-action 'self'");
    expect((await headerMap()).get('X-Frame-Options')).toBe('DENY');
  });

  it('still permits what the dashboards actually need', async () => {
    const csp = (await headerMap()).get('Content-Security-Policy')!;
    // developer_stats.avatar_url is rendered throughout.
    expect(csp).toContain('https://avatars.githubusercontent.com');
    // Recharts and the chart CSS-variable block emit inline styles.
    expect(csp).toMatch(/style-src[^;]*unsafe-inline/);
  });

  it('confines network egress to same-origin', async () => {
    expect((await headerMap()).get('Content-Security-Policy')).toContain("connect-src 'self'");
  });

  it('sets a long HSTS max-age', async () => {
    const hsts = (await headerMap()).get('Strict-Transport-Security')!;
    expect(Number(hsts.match(/max-age=(\d+)/)![1])).toBeGreaterThanOrEqual(31536000);
  });
});
