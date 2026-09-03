// @octokit/rest is ESM-only; github.ts imports it, so it must be mocked with a
// factory before the import or the whole suite fails to load. A bare
// jest.mock() is NOT enough — that still loads the real module to auto-mock it.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { isRateLimitError, isSecondaryRateLimit, rateLimitWaitSeconds } from '@/lib/github';

const NOW = 1_700_000_000;

/** Build an Octokit-shaped error. `message` goes on `.message` like RequestError. */
function err(
  status: number,
  headers: Record<string, unknown> = {},
  message = 'boom',
  dataMessage?: string,
): unknown {
  return Object.assign(new Error(message), {
    status,
    response: { status, headers, ...(dataMessage ? { data: { message: dataMessage } } : {}) },
  });
}

const SECONDARY = 'You have exceeded a secondary rate limit. Please wait a few minutes.';
const ABUSE = 'You have triggered an abuse detection mechanism. Please wait a few minutes.';
const PRIMARY = "API rate limit exceeded for user ID 1234.";

describe('isRateLimitError — separating rate limits from permission 403s', () => {
  it('treats every 429 as a rate limit, headers or not', () => {
    expect(isRateLimitError(err(429, {}, 'slow down'))).toBe(true);
  });

  it('treats a 403 as a rate limit when GitHub sends retry-after', () => {
    expect(isRateLimitError(err(403, { 'retry-after': '60' }, 'no idea'))).toBe(true);
  });

  it('treats a 403 as a rate limit when the message names one', () => {
    expect(isRateLimitError(err(403, {}, PRIMARY))).toBe(true);
    expect(isRateLimitError(err(403, {}, SECONDARY))).toBe(true);
    expect(isRateLimitError(err(403, {}, ABUSE))).toBe(true);
  });

  it('treats a 403 as a rate limit when the primary quota is exhausted', () => {
    expect(isRateLimitError(err(403, { 'x-ratelimit-remaining': '0' }, 'forbidden'))).toBe(true);
  });

  // The reason 403 retryability had to change alongside the reset-header gate:
  // without this, a deterministic permission failure would now sleep 60s five
  // times over instead of the old 10s five times over.
  it('does NOT treat a permission 403 as a rate limit', () => {
    expect(isRateLimitError(err(403, { 'x-ratelimit-remaining': '4999' },
      'Resource not accessible by integration'))).toBe(false);
    expect(isRateLimitError(err(403, { 'x-ratelimit-remaining': '4999' },
      'You must be a member of the organization'))).toBe(false);
    expect(isRateLimitError(err(403, {}, 'SAML enforcement is enabled'))).toBe(false);
  });

  it('ignores non-403/429 statuses and junk', () => {
    for (const e of [err(404), err(500), err(401), undefined, null, {}, 'nope']) {
      expect(isRateLimitError(e)).toBe(false);
    }
  });
});

describe('isSecondaryRateLimit', () => {
  it('detects the current wording on 403 and 429', () => {
    expect(isSecondaryRateLimit(err(403, {}, SECONDARY))).toBe(true);
    expect(isSecondaryRateLimit(err(429, {}, SECONDARY))).toBe(true);
  });

  // GitHub renamed this but still emits the old phrase on some endpoints.
  it('detects the legacy "abuse detection mechanism" wording', () => {
    expect(isSecondaryRateLimit(err(403, {}, ABUSE))).toBe(true);
  });

  // Octokit always sets .message, so a ?? chain would make this unreachable.
  it('reads the phrase from response.data.message too', () => {
    expect(isSecondaryRateLimit(err(403, { 'x-ratelimit-remaining': '0' }, 'Forbidden', SECONDARY)))
      .toBe(true);
  });

  // The structural signal — this is the incident shape: quota healthy, calls rejected.
  it('detects a secondary limit with NO wording when quota remains', () => {
    expect(isSecondaryRateLimit(err(429, { 'x-ratelimit-remaining': '4999' }, 'Forbidden')))
      .toBe(true);
  });

  it('does NOT call an exhausted primary quota secondary', () => {
    expect(isSecondaryRateLimit(err(403, { 'x-ratelimit-remaining': '0' }, PRIMARY))).toBe(false);
  });

  it('is false for anything that is not a rate limit at all', () => {
    expect(isSecondaryRateLimit(err(403, { 'x-ratelimit-remaining': '4999' },
      'Resource not accessible by integration'))).toBe(false);
    expect(isSecondaryRateLimit(err(404))).toBe(false);
  });
});

describe('rateLimitWaitSeconds — secondary schedule', () => {
  // Pinned exactly, not as bounds: `>= 60` and `w9 <= 300` would still pass if
  // the base regressed to 30s, growth went linear, or the cap moved.
  it('is exactly 60/120/240/300/300 across the retry budget', () => {
    const e = err(403, {}, SECONDARY);
    expect([0, 1, 2, 3, 4].map(a => rateLimitWaitSeconds(e, a, NOW))).toEqual([60, 120, 240, 300, 300]);
  });

  it('never exceeds the 300s cap however high the attempt', () => {
    expect(rateLimitWaitSeconds(err(403, {}, SECONDARY), 20, NOW)).toBe(300);
  });

  it('ignores x-ratelimit-reset on a secondary limit — that is the primary window', () => {
    const e = err(403, { 'x-ratelimit-reset': String(NOW + 8) }, SECONDARY);
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(60);
  });
});

describe('rateLimitWaitSeconds — retry-after', () => {
  it('honours a longer retry-after over the schedule', () => {
    const e = err(403, { 'retry-after': '90' }, SECONDARY);
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(90);
  });

  // The flat-wait bug: retry-after used to return early, so a secondary limit
  // waited the same 60s on all 5 attempts and re-tripped at the boundary.
  it('keeps escalating on a secondary limit when retry-after is short', () => {
    const e = err(403, { 'retry-after': '60' }, SECONDARY);
    expect([0, 1, 2, 3, 4].map(a => rateLimitWaitSeconds(e, a, NOW))).toEqual([60, 120, 240, 300, 300]);
  });

  it('honours retry-after exactly on a primary limit (no escalation)', () => {
    const e = err(403, { 'retry-after': '7', 'x-ratelimit-remaining': '0' }, PRIMARY);
    expect([0, 1, 2].map(a => rateLimitWaitSeconds(e, a, NOW))).toEqual([7, 7, 7]);
  });

  it('treats retry-after: 0 as zero, not as 60', () => {
    const e = err(403, { 'retry-after': '0', 'x-ratelimit-remaining': '0' }, PRIMARY);
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(0);
  });

  it('falls through to the schedule on an unparseable retry-after', () => {
    // Previously `Number('later') || 60` silently produced 60 on the primary
    // path, from a constant named for the secondary one.
    const e = err(403, { 'retry-after': 'later', 'x-ratelimit-reset': String(NOW + 240),
      'x-ratelimit-remaining': '0' }, PRIMARY);
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(240);
  });

  it('accepts an RFC 7231 HTTP-date retry-after', () => {
    const spy = jest.spyOn(Date, 'now').mockReturnValue(NOW * 1000);
    try {
      const e = err(403, { 'retry-after': new Date((NOW + 120) * 1000).toUTCString(),
        'x-ratelimit-remaining': '0' }, PRIMARY);
      expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(120);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('rateLimitWaitSeconds — primary limit behaviour preserved', () => {
  it('waits until x-ratelimit-reset', () => {
    const e = err(403, { 'x-ratelimit-reset': String(NOW + 240), 'x-ratelimit-remaining': '0' }, PRIMARY);
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(240);
  });

  it('never waits less than the 10s floor when reset is in the past', () => {
    const e = err(403, { 'x-ratelimit-reset': String(NOW - 500), 'x-ratelimit-remaining': '0' }, PRIMARY);
    expect(rateLimitWaitSeconds(e, 0, NOW)).toBe(10);
  });

  it('falls back to 30s doubling with no usable headers', () => {
    const e = err(429, {}, 'slow down');
    expect([0, 1, 2].map(a => rateLimitWaitSeconds(e, a, NOW))).toEqual([30, 60, 120]);
  });

  it('falls back to the schedule on a non-numeric reset header', () => {
    const e = err(429, { 'x-ratelimit-reset': 'soon' }, 'slow down');
    expect(rateLimitWaitSeconds(e, 1, NOW)).toBe(60);
  });
});
