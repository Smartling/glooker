jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import { withRetry } from '@/lib/github';

// Speed up tests — we don't care about the wall-clock backoff, just the call counts.
jest.useFakeTimers({ doNotFake: ['nextTick'] });
afterEach(() => jest.clearAllTimers());

async function runWithImmediateTimers<T>(p: Promise<T>): Promise<T> {
  // Drain any scheduled setTimeouts (the sleep() calls inside withRetry).
  // Flush microtasks first so any awaited rejection from fn() has a chance to
  // schedule its setTimeout before we check the timer count.
  for (let i = 0; i < 5; i++) await Promise.resolve();
  while (jest.getTimerCount() > 0) {
    jest.advanceTimersByTime(60_000);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  return p;
}

describe('withRetry — transient-error coverage (GLOOK-13)', () => {
  it('retries on 5xx server errors up to 3 attempts then propagates', async () => {
    const err500 = Object.assign(new Error('boom'), { status: 500 });
    const fn = jest.fn().mockRejectedValue(err500);
    const p = withRetry(fn).catch(e => e);
    const result = await runWithImmediateTimers(p);
    expect(fn).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
    expect(result).toBe(err500);
  });

  it('retries on network errors (ECONNRESET, ETIMEDOUT, EAI_AGAIN, ENOTFOUND)', async () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND']) {
      const err = Object.assign(new Error(`net ${code}`), { code });
      const fn = jest.fn().mockRejectedValue(err);
      const p = withRetry(fn).catch(e => e);
      await runWithImmediateTimers(p);
      expect(fn).toHaveBeenCalledTimes(4);
      fn.mockClear();
    }
  });

  it('does NOT retry on 404 (the deterministic signal that drives the threshold)', async () => {
    const err404 = Object.assign(new Error('not found'), { status: 404 });
    const fn = jest.fn().mockRejectedValue(err404);
    await expect(withRetry(fn)).rejects.toBe(err404);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry on 401 (auth)', async () => {
    const err401 = Object.assign(new Error('unauthorized'), { status: 401 });
    const fn = jest.fn().mockRejectedValue(err401);
    await expect(withRetry(fn)).rejects.toBe(err401);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('preserves existing 403/429 rate-limit retry behaviour (uses retry-after header)', async () => {
    const err429 = Object.assign(new Error('rate'), {
      status: 429,
      response: { headers: { 'retry-after': '1' } },
    });
    const fn = jest.fn().mockRejectedValueOnce(err429).mockResolvedValue('ok');
    const p = withRetry(fn);
    const result = await runWithImmediateTimers(p);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe('ok');
  });

  it('returns the value on the first successful attempt (no retry)', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('returns the value when a transient error succeeds on retry', async () => {
    const err500 = Object.assign(new Error('boom'), { status: 500 });
    const fn = jest.fn().mockRejectedValueOnce(err500).mockResolvedValue('ok');
    const p = withRetry(fn);
    const result = await runWithImmediateTimers(p);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(result).toBe('ok');
  });

  // ---- GLOOK-48: the wiring, not just the pure function -------------------
  // rateLimitWaitSeconds is unit-tested in github-secondary-rate-limit.test.ts.
  // These two pin that withRetry actually acts on it, which is the behaviour
  // the incident was about.

  async function settle() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  it('waits at least 60s before retrying a secondary rate limit', async () => {
    // x-ratelimit-reset only 5s out: this is the exact shape that used to
    // collapse to the 10s floor and immediately re-trip the same limit.
    const err = Object.assign(new Error('You have exceeded a secondary rate limit'), {
      status: 403,
      response: {
        status: 403,
        headers: { 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 5) },
      },
    });
    const fn = jest.fn().mockRejectedValueOnce(err).mockResolvedValue('ok');

    const p = withRetry(fn);
    await settle();
    expect(fn).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(59_999);
    await settle();
    expect(fn).toHaveBeenCalledTimes(1); // would have retried at 10s before the fix

    jest.advanceTimersByTime(1);
    await settle();
    expect(fn).toHaveBeenCalledTimes(2);
    await expect(p).resolves.toBe('ok');
  });

  it('does NOT retry a permission 403 (SSO / missing scope) — propagates immediately', async () => {
    // Gating the primary path on x-ratelimit-remaining would otherwise make
    // these sleep 60s five times over instead of failing fast.
    const err = Object.assign(new Error('Resource not accessible by integration'), {
      status: 403,
      response: { status: 403, headers: { 'x-ratelimit-remaining': '4999' } },
    });
    const fn = jest.fn().mockRejectedValue(err);
    await expect(withRetry(fn)).rejects.toBe(err);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
