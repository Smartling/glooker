// src/lib/__tests__/unit/vuln-format.test.ts
// the shared SWR fetcher (src/app/vulnerabilities/format.ts) hardened —
// status carried on the thrown error, a lenient error-body parse on the !ok path only, and a
// shouldRetryOnError predicate so SWR doesn't retry a 4xx.
import { fetcher, shouldRetryVulnFetch } from '@/app/vulnerabilities/format';

beforeEach(() => {
  (global as any).fetch = undefined;
});

describe('fetcher', () => {
  it('a 502 whose body is not JSON rejects with "HTTP 502" and status 502, not a JSON SyntaxError', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    const err: any = await fetcher('/x').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('HTTP 502');
    expect(err.status).toBe(502);
  });

  it('a 400 { error: "bad" } rejects with message "bad", status 400, and info.error "bad"', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false, status: 400, json: async () => ({ error: 'bad' }),
    });
    const err: any = await fetcher('/x').catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('bad');
    expect(err.status).toBe(400);
    expect(err.info?.error).toBe('bad');
  });

  it('an ok response with bad JSON still fails visibly (strict parse on the ok path)', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); },
    });
    await expect(fetcher('/x')).rejects.toBeInstanceOf(SyntaxError);
  });
});

describe('shouldRetryVulnFetch', () => {
  it('returns false for a 400 and a 404 (client errors don\'t fix themselves by retrying)', () => {
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 404 }))).toBe(false);
  });

  it('returns true for a 500 and for a network error with no status', () => {
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
    expect(shouldRetryVulnFetch(new Error('network down'))).toBe(true);
  });

  // 408 (Request Timeout) and 429 (Too Many Requests) are transient by
  // design despite being in the 4xx range, so they're retried like a 5xx; every other 4xx (the
  // 400-499 boundaries included) is not.
  it('retries 408 and 429 despite being 4xx; boundary values 399 and 499 are not off-by-one', () => {
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 399 }))).toBe(true);
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 400 }))).toBe(false);
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 408 }))).toBe(true);
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 429 }))).toBe(true);
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 499 }))).toBe(false);
    expect(shouldRetryVulnFetch(Object.assign(new Error('x'), { status: 500 }))).toBe(true);
  });
});
