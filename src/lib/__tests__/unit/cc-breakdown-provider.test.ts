import { createAnthropicCcSpendProvider } from '@/lib/cc-spend/anthropic-provider';

const origFetch = global.fetch;
const origKey = process.env.ANTHROPIC_ANALYTICS_API_KEY;
beforeEach(() => { process.env.ANTHROPIC_ANALYTICS_API_KEY = 'k-test'; });
afterAll(() => { global.fetch = origFetch; process.env.ANTHROPIC_ANALYTICS_API_KEY = origKey; });

const ok = (body: any) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });

it('skills: uses date params and the page cursor, and aggregates per email', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: any) => {
    urls.push(String(url));
    if (urls.length === 1) {
      return ok({
        data: [{ user: { email_address: 'A@X.com' }, cowork_metrics: { skills_used_count: 4, distinct_skills_used_count: 2 } }],
        next_page: 'TOKEN2',
      }) as any;
    }
    return ok({
      data: [{ user: { email_address: 'b@x.com' }, chat_metrics: { distinct_skills_used_count: 5 } }],
      next_page: null,
    }) as any;
  }) as any;

  const out = await createAnthropicCcSpendProvider().pullSkillsByPeriod('2026-07-01', '2026-07-14');

  expect(urls[0]).toContain('/v1/organizations/analytics/users');
  expect(urls[0]).toContain('starting_date=2026-07-01');
  expect(urls[0]).toContain('ending_date=2026-07-14');
  expect(urls[0]).not.toContain('starting_at');
  // Only `page` advances this endpoint's cursor; next_page/cursor are ignored by the API.
  expect(urls[1]).toContain('page=TOKEN2');

  expect(out).toEqual([
    { email: 'a@x.com', products: [{ product: 'cowork', used: 4, distinct: 2 }] },
    { email: 'b@x.com', products: [{ product: 'chat', used: 0, distinct: 5 }] },
  ]);
});

it('skills: drops users with no non-zero skills usage', async () => {
  global.fetch = jest.fn(async () => ok({
    data: [{ user: { email_address: 'c@x.com' }, office_metrics: { word: { skills_used_count: 0, distinct_skills_used_count: 0 } } }],
    next_page: null,
  }) as any) as any;

  const out = await createAnthropicCcSpendProvider().pullSkillsByPeriod('2026-07-01', '2026-07-14');
  expect(out).toEqual([]);
});

it('models: sends group_by[] with brackets and groups per email', async () => {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: any) => {
    urls.push(String(url));
    return ok({
      data: [
        { actor: { type: 'user_actor', email: 'A@X.com' }, model: 'claude-opus-4-8', amount: '1500.4', requests: 10 },
        { actor: { type: 'user_actor', email: 'a@x.com' }, model: 'claude-sonnet-5', amount: '500.6', requests: 20 },
        { actor: { type: 'api_actor', email: 'bot@x.com' }, model: 'claude-sonnet-5', amount: '999', requests: 1 },
        { actor: { type: 'user_actor', email: 'd@x.com', deleted: true }, model: 'claude-sonnet-5', amount: '5', requests: 1 },
        { actor: { type: 'user_actor', email: 'e@x.com' }, model: null, amount: '7', requests: 1 },
      ],
      next_page: null,
    }) as any;
  }) as any;

  const out = await createAnthropicCcSpendProvider().pullModelCostByPeriod('2026-07-01', '2026-07-14');

  expect(urls[0]).toContain('group_by%5B%5D=model');
  expect(out).toEqual([{
    email: 'a@x.com',
    models: [
      { model: 'claude-opus-4-8', costCents: 1500, requests: 10 },
      { model: 'claude-sonnet-5', costCents: 501,  requests: 20 },
    ],
  }]);
});

it('models: parses a JSON-number amount, not just a decimal string (Number(), not string-only parseFloat)', async () => {
  // Anthropic sends `amount` as a decimal string today, but nothing documents
  // that as guaranteed — a `typeof === 'string'` gate would silently read a
  // numeric amount as NaN -> 0 instead of the real cost.
  global.fetch = jest.fn(async () => ok({
    data: [{ actor: { type: 'user_actor', email: 'a@x.com' }, model: 'claude-sonnet-5', amount: 250, requests: 3 }],
    next_page: null,
  }) as any) as any;

  const out = await createAnthropicCcSpendProvider().pullModelCostByPeriod('2026-07-01', '2026-07-14');

  expect(out).toEqual([{
    email: 'a@x.com',
    models: [{ model: 'claude-sonnet-5', costCents: 250, requests: 3 }],
  }]);
});

it('models: logs the total dropped dollars once per pull when rows lack email/model attribution', async () => {
  global.fetch = jest.fn(async () => ok({
    data: [
      { actor: { type: 'user_actor', email: 'a@x.com' }, model: 'claude-sonnet-5', amount: '100', requests: 1 },
      { actor: { type: 'user_actor', email: 'a@x.com' }, model: null, amount: '7', requests: 1 },
      { actor: { type: 'user_actor', email: null },       model: 'claude-sonnet-5', amount: '3', requests: 1 },
    ],
    next_page: null,
  }) as any) as any;

  const log = jest.fn();
  const out = await createAnthropicCcSpendProvider().pullModelCostByPeriod('2026-07-01', '2026-07-14', log);

  // The two unattributed rows (7 + 3 cents) are excluded from the breakdown...
  expect(out).toEqual([{
    email: 'a@x.com',
    models: [{ model: 'claude-sonnet-5', costCents: 100, requests: 1 }],
  }]);
  // ...but logged once, as a total, not once per row.
  const dropMsgs = log.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('dropped'));
  expect(dropMsgs).toHaveLength(1);
  expect(dropMsgs[0]).toContain('10c');
});

it('models: does not log a drop message when every row is fully attributed', async () => {
  global.fetch = jest.fn(async () => ok({
    data: [{ actor: { type: 'user_actor', email: 'a@x.com' }, model: 'claude-sonnet-5', amount: '100', requests: 1 }],
    next_page: null,
  }) as any) as any;

  const log = jest.fn();
  await createAnthropicCcSpendProvider().pullModelCostByPeriod('2026-07-01', '2026-07-14', log);

  expect(log.mock.calls.map((c) => String(c[0])).some((m) => m.includes('dropped'))).toBe(false);
});
