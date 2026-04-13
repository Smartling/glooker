import { ClaudeCodeClient } from '@/lib/claude-code/client';

describe('ClaudeCodeClient', () => {
  const mockFetch = jest.fn();

  beforeAll(() => {
    global.fetch = mockFetch as any;
  });

  beforeEach(() => {
    mockFetch.mockReset();
  });

  function mockResponse(data: any[], nextPage?: string) {
    return {
      ok: true,
      json: () => Promise.resolve({
        data,
        has_more: Boolean(nextPage),
        next_page: nextPage || null,
      }),
    };
  }

  function makeRecord(email: string, cost: number, input: number, output: number, sessions: number) {
    return {
      actor: { type: 'user_actor', email_address: email },
      num_sessions: sessions,
      model_breakdown: [
        {
          model: 'claude-sonnet-4-20250514',
          tokens: { input, output, cache_read: 100, cache_creation: 50 },
          estimated_cost: { amount: String(cost), currency: 'USD' },
        },
      ],
    };
  }

  it('fetches and aggregates daily spend records', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      makeRecord('alice@test.com', 500, 1000, 200, 3),
      makeRecord('bob@test.com', 300, 800, 150, 2),
    ]));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(2);
    expect(records[0]).toEqual({
      email: 'alice@test.com',
      totalCost: 500,
      inputTokens: 1150, // 1000 + 100 cache_read + 50 cache_creation
      outputTokens: 200,
      sessions: 3,
    });
  });

  it('handles pagination', async () => {
    mockFetch
      .mockResolvedValueOnce(mockResponse(
        [makeRecord('alice@test.com', 500, 1000, 200, 3)],
        'cursor-page-2',
      ))
      .mockResolvedValueOnce(mockResponse(
        [makeRecord('bob@test.com', 300, 800, 150, 2)],
      ));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[1][0]).toContain('page=cursor-page-2');
  });

  it('skips non-user actors (API keys)', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      makeRecord('alice@test.com', 500, 1000, 200, 3),
      {
        actor: { type: 'api_actor', api_key_name: 'CI key' },
        num_sessions: 10,
        model_breakdown: [{
          model: 'claude-sonnet-4-20250514',
          tokens: { input: 5000, output: 1000, cache_read: 0, cache_creation: 0 },
          estimated_cost: { amount: '2000', currency: 'USD' },
        }],
      },
    ]));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(1);
    expect(records[0].email).toBe('alice@test.com');
  });

  it('sums across multiple models for same user', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([
      {
        actor: { type: 'user_actor', email_address: 'alice@test.com' },
        num_sessions: 5,
        model_breakdown: [
          {
            model: 'claude-sonnet-4-20250514',
            tokens: { input: 1000, output: 200, cache_read: 100, cache_creation: 50 },
            estimated_cost: { amount: '300', currency: 'USD' },
          },
          {
            model: 'claude-opus-4-20250514',
            tokens: { input: 2000, output: 500, cache_read: 200, cache_creation: 100 },
            estimated_cost: { amount: '800', currency: 'USD' },
          },
        ],
      },
    ]));

    const client = new ClaudeCodeClient('sk-ant-admin-test');
    const records = await client.fetchDailySpend('2026-04-01');

    expect(records).toHaveLength(1);
    expect(records[0].totalCost).toBe(1100);
    expect(records[0].inputTokens).toBe(3450); // (1000+100+50) + (2000+200+100)
    expect(records[0].outputTokens).toBe(700);
  });

  it('sends correct auth headers', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse([]));

    const client = new ClaudeCodeClient('sk-ant-admin-test-key');
    await client.fetchDailySpend('2026-04-01');

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/v1/organizations/usage_report/claude_code'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-api-key': 'sk-ant-admin-test-key',
          'anthropic-version': '2023-06-01',
        }),
      }),
    );
  });

  it('throws on non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve('Unauthorized'),
    });

    const client = new ClaudeCodeClient('bad-key');
    await expect(client.fetchDailySpend('2026-04-01')).rejects.toThrow('401');
  });
});
