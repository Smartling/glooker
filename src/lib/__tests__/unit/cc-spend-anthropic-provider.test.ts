import {
  createAnthropicCcSpendProvider,
  AnthropicAnalyticsKeyMissingError,
} from '@/lib/cc-spend/anthropic-provider';

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;

// Tracks setTimeout(ms) values from the module under test. Filled in beforeEach.
let setTimeoutDelays: number[] = [];

// Retry path includes a real 2.5s sleep; we stub setTimeout so retry tests don't hang.
// We DON'T fire the abort-timer callback (the 30s one); we fire only the short retry sleeps
// so the abort signal never trips during a fetch that's already resolved.
beforeEach(() => {
  process.env.ANTHROPIC_ANALYTICS_API_KEY = 'sk-ant-analytics-test';
  (global.fetch as any) = jest.fn();
  setTimeoutDelays = [];
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: any, ms?: number) => {
    setTimeoutDelays.push(typeof ms === 'number' ? ms : 0);
    // The abort-timer is exactly 30_000ms — never fire it (would abort the mocked fetch).
    // Everything else (retry sleeps, up to 60_000ms cap) fires immediately.
    if (ms !== 30_000) cb();
    return 0 as any;
  }) as any);
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_ANALYTICS_API_KEY;
  else process.env.ANTHROPIC_ANALYTICS_API_KEY = originalKey;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mockOk(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (_k: string) => null as string | null },
    json: async () => body,
  };
}

function buildUserRow(opts: {
  email: string;
  amount: string;
  requests: number;
  type?: string;
  deleted?: boolean;
}) {
  return {
    product: null,
    model: null,
    context_window: null,
    inference_geo: null,
    speed: null,
    actor: {
      type: opts.type ?? 'user_actor',
      user_id: `user_${opts.email}`,
      name: opts.email,
      email: opts.email,
      deleted: opts.deleted ?? false,
    },
    currency: 'USD',
    amount: opts.amount,
    list_amount: opts.amount,
    cost_type: null,
    token_type: null,
    requests: opts.requests,
  };
}

describe('AnthropicCcSpendProvider.pullByPeriod', () => {
  it('sends one request with correct URL params for a 14-day range', async () => {
    (global.fetch as any).mockResolvedValue(mockOk({ data: [], has_more: false, next_page: null }));
    const provider = createAnthropicCcSpendProvider();
    await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect((global.fetch as any)).toHaveBeenCalledTimes(1);
    const url = (global.fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/v1/organizations/analytics/user_cost_report');
    expect(url).toContain('starting_at=2026-04-01T00%3A00%3A00Z');
    expect(url).toContain('ending_at=2026-04-14T23%3A59%3A59Z');
    expect(url).toContain('limit=1000');
  });

  it('sends auth headers', async () => {
    (global.fetch as any).mockResolvedValue(mockOk({ data: [], has_more: false, next_page: null }));
    const provider = createAnthropicCcSpendProvider();
    await provider.pullByPeriod('2026-04-01', '2026-04-14');
    const init = (global.fetch as any).mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-analytics-test',
      'anthropic-version': '2023-06-01',
    });
  });

  it('aggregates costCents (rounds fractional cents) and requests per email, lowercases email', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({
      data: [
        buildUserRow({ email: 'Bkoval@Smartling.com', amount: '81977.726735', requests: 6968 }),
        buildUserRow({ email: 'alice@example.com', amount: '500.25', requests: 12 }),
      ],
      has_more: false,
      next_page: null,
    }));

    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    const byEmail = new Map(result.map(r => [r.email, r]));
    expect(byEmail.get('bkoval@smartling.com')).toEqual({
      email: 'bkoval@smartling.com',
      costCents: 81978, // Math.round(81977.726735)
      requests: 6968,
    });
    expect(byEmail.get('alice@example.com')).toEqual({
      email: 'alice@example.com',
      costCents: 500, // Math.round(500.25)
      requests: 12,
    });
  });

  it('follows cursor pagination via page=<next_page> param, combines results', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 })],
        has_more: true,
        next_page: 'CURSOR_2',
      }))
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow({ email: 'bob@example.com', amount: '200', requests: 9 })],
        has_more: false,
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    expect((global.fetch as any).mock.calls[1][0]).toContain('page=CURSOR_2');
    expect(result.length).toBe(2);
    const byEmail = new Map(result.map(r => [r.email, r]));
    expect(byEmail.get('alice@example.com')?.requests).toBe(5);
    expect(byEmail.get('bob@example.com')?.requests).toBe(9);
  });

  it('skips actor.type !== user_actor (e.g. api_actor)', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({
      data: [
        buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 }),
        buildUserRow({ email: 'ci-bot@example.com', amount: '999', requests: 99, type: 'api_actor' }),
      ],
      has_more: false,
      next_page: null,
    }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('alice@example.com');
  });

  it('skips actor.deleted=true users', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({
      data: [
        buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 }),
        buildUserRow({ email: 'former@example.com', amount: '500', requests: 50, deleted: true }),
      ],
      has_more: false,
      next_page: null,
    }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect(result.length).toBe(1);
    expect(result[0].email).toBe('alice@example.com');
  });

  it('retries once on 503, then succeeds', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({}, 503))
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 })],
        has_more: false,
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(1);
  });

  it('retries twice on 429 (MAX_RETRIES=2), succeeds on third attempt', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({}, 429))
      .mockResolvedValueOnce(mockOk({}, 429))
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 })],
        has_more: false,
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect((global.fetch as any)).toHaveBeenCalledTimes(3);
    expect(result.length).toBe(1);
  });

  it('honors Retry-After: <seconds> header (caps at 60s)', async () => {
    const headersWith = (h: Record<string, string>) => ({
      get: (k: string) => h[k.toLowerCase()] ?? null,
    });
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: headersWith({ 'retry-after': '5' }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: headersWith({ 'retry-after': '999' }), // should clamp to 60_000
        json: async () => ({}),
      })
      .mockResolvedValueOnce(mockOk({
        data: [],
        has_more: false,
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    await provider.pullByPeriod('2026-04-01', '2026-04-14');
    // First retry sleep should be 5000ms, second should clamp to 60000ms.
    // Filter out the 30_000ms abort timer; keep everything else.
    const retryDelays = setTimeoutDelays.filter(d => d > 0 && d !== 30_000);
    expect(retryDelays).toContain(5000);
    expect(retryDelays).toContain(60_000);
  });

  it('honors Retry-After: <HTTP-date> header (clamps to 60s)', async () => {
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(realNow);
    const fiveSecLater = new Date(realNow + 5_000).toUTCString();
    const fiveMinLater = new Date(realNow + 5 * 60_000).toUTCString();

    const headersWith = (h: Record<string, string>) => ({
      get: (k: string) => h[k.toLowerCase()] ?? null,
    });
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: headersWith({ 'retry-after': fiveSecLater }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: headersWith({ 'retry-after': fiveMinLater }),
        json: async () => ({}),
      })
      .mockResolvedValueOnce(mockOk({ data: [], has_more: false, next_page: null }));

    const provider = createAnthropicCcSpendProvider();
    await provider.pullByPeriod('2026-04-01', '2026-04-14');
    const retryDelays = setTimeoutDelays.filter(d => d > 0 && d !== 30_000);
    // 5s in future -> ~5000ms (allow ±1s for parsing slop).
    expect(retryDelays.some(d => Math.abs(d - 5000) < 1500)).toBe(true);
    // 5 min in future -> clamped to 60_000.
    expect(retryDelays).toContain(60_000);
  });

  it('retries on AbortError (network-level rejection)', async () => {
    const abortErr = Object.assign(new Error('aborted'), { name: 'AbortError' });
    (global.fetch as any)
      .mockRejectedValueOnce(abortErr)
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 })],
        has_more: false,
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(1);
  });

  it('retries on ECONNRESET (network-level rejection)', async () => {
    const netErr = Object.assign(new Error('ECONNRESET'), { code: 'ECONNRESET' });
    (global.fetch as any)
      .mockRejectedValueOnce(netErr)
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 })],
        has_more: false,
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-14');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(1);
  });

  it('exhausts retry budget on persistent network errors, then throws', async () => {
    const netErr = Object.assign(new Error('ETIMEDOUT'), { code: 'ETIMEDOUT' });
    (global.fetch as any)
      .mockRejectedValueOnce(netErr)
      .mockRejectedValueOnce(netErr)
      .mockRejectedValueOnce(netErr);
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.pullByPeriod('2026-04-01', '2026-04-14')).rejects.toThrow(/ETIMEDOUT/);
    expect((global.fetch as any)).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('aborts after MAX_PAGES (100) cursor pages', async () => {
    // Every fetch returns a page with a next_page cursor — should hit the cap.
    (global.fetch as any).mockResolvedValue(mockOk({
      data: [buildUserRow({ email: 'alice@example.com', amount: '1', requests: 1 })],
      has_more: true,
      next_page: 'CURSOR',
    }));
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.pullByPeriod('2026-04-01', '2026-04-14')).rejects.toThrow(/100 pages/);
  });

  it('throws on 401 with /401/ message', async () => {
    (global.fetch as any).mockResolvedValue(mockOk({ error: 'unauthorized' }, 401));
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.pullByPeriod('2026-04-01', '2026-04-14')).rejects.toThrow(/401/);
  });

  it('throws AnthropicAnalyticsKeyMissingError before any HTTP when env unset', async () => {
    delete process.env.ANTHROPIC_ANALYTICS_API_KEY;
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.pullByPeriod('2026-04-01', '2026-04-14')).rejects.toThrow(AnthropicAnalyticsKeyMissingError);
    expect((global.fetch as any)).not.toHaveBeenCalled();
  });
});

describe('AnthropicCcSpendProvider.probe', () => {
  it('returns userCount + sampleEmail on success', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({
      data: [
        buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 }),
        buildUserRow({ email: 'bob@example.com', amount: '200', requests: 9 }),
      ],
      has_more: false,
      next_page: null,
    }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.probe('2026-04-15');
    expect(result.userCount).toBe(2);
    expect(result.sampleEmail).toBe('alice@example.com');
  });

  it('dedupes users by email (counts distinct, not rows)', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({
      data: [
        buildUserRow({ email: 'alice@example.com', amount: '100', requests: 5 }),
        buildUserRow({ email: 'Alice@Example.com', amount: '50', requests: 2 }), // same after lowercase
        buildUserRow({ email: 'bob@example.com', amount: '200', requests: 9 }),
      ],
      has_more: false,
      next_page: null,
    }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.probe('2026-04-15');
    expect(result.userCount).toBe(2);
  });

  it('returns userCount=0 when no users in date range', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({ data: [], has_more: false, next_page: null }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.probe('2026-04-15');
    expect(result.userCount).toBe(0);
    expect(result.sampleEmail).toBeUndefined();
  });

  it('throws on 401', async () => {
    (global.fetch as any).mockResolvedValueOnce(mockOk({}, 401));
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.probe('2026-04-15')).rejects.toThrow(/401/);
  });

  it('throws when env var unset', async () => {
    delete process.env.ANTHROPIC_ANALYTICS_API_KEY;
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.probe('2026-04-15')).rejects.toThrow(AnthropicAnalyticsKeyMissingError);
  });
});
