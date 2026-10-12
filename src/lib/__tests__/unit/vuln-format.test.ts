// src/lib/__tests__/unit/vuln-format.test.ts
// the shared SWR fetcher (src/app/vulnerabilities/format.ts) hardened —
// status carried on the thrown error, a lenient error-body parse on the !ok path only, and a
// shouldRetryOnError predicate so SWR doesn't retry a 4xx.
import { fetcher, shouldRetryVulnFetch, deltaBaselineCaption, resolvedCaption } from '@/app/vulnerabilities/format';
import type { DeltaResult } from '@/lib/vulnerabilities/aggregate';

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

describe('deltaBaselineCaption', () => {
  const baseline = (takenOn: string) => ({ source: 'sync' as const, key: 'sync:1', takenOn, measuredAt: `${takenOn}T06:00:00Z` });

  it('returns "vs <takenOn as a display date>" for an available delta with a baseline', () => {
    const delta: DeltaResult = { available: true, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null };
    expect(deltaBaselineCaption(delta, '2099-06-01')).toBe('vs Jan 1');
    expect(deltaBaselineCaption(delta, '2100-06-01')).toBe('vs Jan 1, 2099');
  });

  it('returns null when the delta is unavailable', () => {
    const delta: DeltaResult = { available: false, baseline: baseline('2099-01-01'), reposNotInBaseline: 0, teams: [], total: null };
    expect(deltaBaselineCaption(delta)).toBeNull();
  });

  it('returns null when available but baseline is null', () => {
    const delta: DeltaResult = { available: true, baseline: null, reposNotInBaseline: 0, teams: [], total: null };
    expect(deltaBaselineCaption(delta)).toBeNull();
  });

  it('returns null for undefined/null input', () => {
    expect(deltaBaselineCaption(undefined)).toBeNull();
    expect(deltaBaselineCaption(null)).toBeNull();
  });
});

describe('resolvedCaption', () => {
  it('reads "since <display date>", "all time" with no start date, and "since —" when the value is invalid', () => {
    // "today" is in 2031, a year the suite never runs in, so a caption that ignored the argument would fail.
    expect(resolvedCaption({ date: '2020-01-08', invalid: false }, '2031-10-07')).toBe('since Jan 8, 2020');
    expect(resolvedCaption({ date: '2031-03-02', invalid: false }, '2031-10-07')).toBe('since Mar 2');
    expect(resolvedCaption({ date: null, invalid: false })).toBe('all time');
    expect(resolvedCaption({ date: '2020-01-08', invalid: true })).toBe('since —');
  });
});
