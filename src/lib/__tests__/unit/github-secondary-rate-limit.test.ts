/**
 * GLOOK-13 regression, trigger half (2026-09-02).
 *
 * GitHub has two rate limits. The primary one is reported by /rate_limit and
 * carries x-ratelimit-reset. The *secondary* (abuse-detection) limit is not
 * reflected in /rate_limit at all — during the incident the search quota read
 * 30/30 while search calls were being rejected with:
 *
 *   403 "You have exceeded a secondary rate limit. Please wait a few minutes
 *        before you try again."
 *
 * withRetry treated that as a primary rate limit and computed its wait from
 * x-ratelimit-reset, which describes the *primary* window. With the primary
 * quota unexhausted that reset is near, so the wait collapsed to the 10s floor,
 * the retry re-tripped the same secondary limit, and the 5-attempt budget was
 * spent in under a minute. The member then threw and was SKIPped.
 */
// @octokit/rest is ESM-only; github.ts imports it, so it must be mocked before
// the import or the whole suite fails to load (documented in CLAUDE.md).
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { isSecondaryRateLimit, rateLimitWaitSeconds } from '@/lib/github';

const NOW = 1_800_000_000;

function err(status: number, message: string, headers: Record<string, string> = {}) {
  return { status, message, response: { status, headers } };
}

describe('isSecondaryRateLimit', () => {
  it('detects the secondary-limit 403 by its message', () => {
    expect(isSecondaryRateLimit(err(403, 'You have exceeded a secondary rate limit. Please wait a few minutes'))).toBe(true);
  });

  it('detects it on a 429 too', () => {
    expect(isSecondaryRateLimit(err(429, 'You have exceeded a secondary rate limit.'))).toBe(true);
  });

  it('does not treat a primary rate limit as secondary', () => {
    expect(isSecondaryRateLimit(err(403, 'API rate limit exceeded for user ID 123'))).toBe(false);
  });

  it('does not treat unrelated errors as secondary', () => {
    expect(isSecondaryRateLimit(err(404, 'Not Found'))).toBe(false);
    expect(isSecondaryRateLimit(undefined)).toBe(false);
  });
});

describe('rateLimitWaitSeconds', () => {
  it('ignores x-ratelimit-reset for a secondary limit', () => {
    // This is the bug: reset is 8s away because the PRIMARY quota is healthy,
    // so the old code waited 10s and immediately re-tripped the secondary limit.
    const e = err(403, 'You have exceeded a secondary rate limit.', {
      'x-ratelimit-reset': String(NOW + 8),
    });
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBeGreaterThanOrEqual(60);
  });

  it('honours retry-after when GitHub sends one', () => {
    const e = err(403, 'You have exceeded a secondary rate limit.', { 'retry-after': '90' });
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(90);
  });

  it('grows the secondary wait across attempts but caps it', () => {
    const e = err(403, 'You have exceeded a secondary rate limit.');
    const w0 = rateLimitWaitSeconds(e, 0, NOW);
    const w1 = rateLimitWaitSeconds(e, 1, NOW);
    const w9 = rateLimitWaitSeconds(e, 9, NOW);
    expect(w1).toBeGreaterThan(w0);
    // Capped so one unrecoverable member cannot stall the whole run for an hour.
    expect(w9).toBeLessThanOrEqual(300);
  });

  it('still uses x-ratelimit-reset for a primary limit', () => {
    const e = err(403, 'API rate limit exceeded', { 'x-ratelimit-reset': String(NOW + 240) });
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(240);
  });

  it('falls back to exponential backoff for a primary limit with no headers', () => {
    const e = err(403, 'API rate limit exceeded');
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(30);
    expect(rateLimitWaitSeconds(e, 2, NOW)).toBe(120);
  });

  it('never returns a wait below the 10s primary floor', () => {
    const e = err(403, 'API rate limit exceeded', { 'x-ratelimit-reset': String(NOW - 500) });
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBeGreaterThanOrEqual(10);
  });
});
