import { createAnthropicCcSpendProvider } from '@/lib/cc-spend/anthropic-provider';

const originalFetch = global.fetch;
const originalKey = process.env.ANTHROPIC_ADMIN_API_KEY;

// Retry path includes a real 2.5s sleep; we stub setTimeout so retry tests don't hang.
beforeEach(() => {
  process.env.ANTHROPIC_ADMIN_API_KEY = 'sk-ant-admin-test';
  (global.fetch as any) = jest.fn();
  jest.spyOn(global, 'setTimeout').mockImplementation(((cb: any) => { cb(); return 0 as any; }) as any);
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ANTHROPIC_ADMIN_API_KEY;
  else process.env.ANTHROPIC_ADMIN_API_KEY = originalKey;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function mockOk(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function buildUserRow(email: string, sessions: number, costCents: number, inputTokens: number, outputTokens: number) {
  return {
    actor: { email_address: email },
    num_sessions: sessions,
    model_breakdown: [
      {
        tokens: { input: inputTokens, output: outputTokens, cache_read: 0, cache_creation: 0 },
        estimated_cost: { amount: String(costCents) },
      },
    ],
  };
}

describe('AnthropicCcSpendProvider.pullByPeriod', () => {
  it('iterates one day per call over the period (inclusive)', async () => {
    (global.fetch as any).mockResolvedValue(mockOk({ data: [], next_page: null }));
    const provider = createAnthropicCcSpendProvider();
    await provider.pullByPeriod('2026-04-01', '2026-04-03');
    expect((global.fetch as any)).toHaveBeenCalledTimes(3);
    const urls = (global.fetch as any).mock.calls.map((c: unknown[]) => c[0] as string);
    expect(urls[0]).toContain('starting_at=2026-04-01');
    expect(urls[1]).toContain('starting_at=2026-04-02');
    expect(urls[2]).toContain('starting_at=2026-04-03');
  });

  it('sends auth headers on every request', async () => {
    (global.fetch as any).mockResolvedValue(mockOk({ data: [], next_page: null }));
    const provider = createAnthropicCcSpendProvider();
    await provider.pullByPeriod('2026-04-01', '2026-04-01');
    const init = (global.fetch as any).mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk-ant-admin-test',
      'anthropic-version': '2023-06-01',
    });
  });

  it('aggregates costCents/tokens/sessions per email across days and model_breakdown', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({
        data: [
          buildUserRow('alice@example.com', 2, 500, 100, 50),
          buildUserRow('bob@example.com', 1, 300, 80, 40),
        ],
        next_page: null,
      }))
      .mockResolvedValueOnce(mockOk({
        data: [
          buildUserRow('alice@example.com', 3, 700, 150, 75),
        ],
        next_page: null,
      }));

    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-02');
    const byEmail = new Map(result.map(r => [r.email, r]));
    expect(byEmail.get('alice@example.com')).toEqual({
      email: 'alice@example.com',
      sessions: 5,
      costCents: 1200,
      inputTokens: 250,
      outputTokens: 125,
    });
    expect(byEmail.get('bob@example.com')).toEqual({
      email: 'bob@example.com',
      sessions: 1,
      costCents: 300,
      inputTokens: 80,
      outputTokens: 40,
    });
  });

  it('follows cursor pagination within a day', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow('alice@example.com', 1, 100, 10, 5)],
        next_page: 'CURSOR_2',
      }))
      .mockResolvedValueOnce(mockOk({
        data: [buildUserRow('bob@example.com', 1, 200, 20, 10)],
        next_page: null,
      }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-01');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    expect((global.fetch as any).mock.calls[1][0]).toContain('page=CURSOR_2');
    expect(result.length).toBe(2);
  });

  it('retries once on 5xx, then succeeds', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({}, 503))
      .mockResolvedValueOnce(mockOk({ data: [buildUserRow('alice@example.com', 1, 100, 10, 5)], next_page: null }));
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-01');
    expect((global.fetch as any)).toHaveBeenCalledTimes(2);
    expect(result.length).toBe(1);
  });

  it('aborts the whole pull on 401', async () => {
    (global.fetch as any).mockResolvedValue(mockOk({ error: 'unauthorized' }, 401));
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.pullByPeriod('2026-04-01', '2026-04-05')).rejects.toThrow(/401/);
    expect((global.fetch as any)).toHaveBeenCalledTimes(1);
  });

  it('throws AnthropicAdminKeyMissingError before any HTTP call when env var unset', async () => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    const provider = createAnthropicCcSpendProvider();
    await expect(provider.pullByPeriod('2026-04-01', '2026-04-01')).rejects.toThrow(/ANTHROPIC_ADMIN_API_KEY/);
    expect((global.fetch as any)).not.toHaveBeenCalled();
  });

  it('skips a day after retry exhaustion (logs but does not abort the period)', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce(mockOk({}, 503)) // day 1 first try
      .mockResolvedValueOnce(mockOk({}, 503)) // day 1 retry
      .mockResolvedValueOnce(mockOk({ data: [buildUserRow('alice@example.com', 1, 100, 10, 5)], next_page: null })); // day 2
    const logs: string[] = [];
    const provider = createAnthropicCcSpendProvider();
    const result = await provider.pullByPeriod('2026-04-01', '2026-04-02', (m) => logs.push(m));
    expect(result.length).toBe(1);
    expect(logs.some(l => l.includes('2026-04-01') && /skip|fail|retry/i.test(l))).toBe(true);
  });
});
