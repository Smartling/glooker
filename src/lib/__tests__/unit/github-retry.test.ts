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
});
