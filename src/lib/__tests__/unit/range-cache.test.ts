const execute = jest.fn();
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: (...a: unknown[]) => execute(...a) } }));

import { getRangeDeveloperStats, clearRangeCache } from '@/lib/report/range';

const W = { since: '2026-07-30', until: '2026-10-28', days: 90 };
let reports: any[];

beforeEach(() => {
  clearRangeCache();
  execute.mockReset();
  reports = [{ id: 'r1', status: 'completed', period_days: 14, created_at: '2026-10-01T00:00:00Z', completed_at: '2026-10-01T01:00:00Z' }];
  execute.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM reports')) return [reports, []];
    if (sql.includes('FROM developer_stats')) return [[{ github_login: 'a', github_name: 'A', avatar_url: '', created_at: '2026-10-01' }], []];
    return [[], []];
  });
});

const heavyCalls = () => execute.mock.calls.filter(([sql]) => !String(sql).includes('FROM reports')).length;

it('serves a repeat request for the same window and report set from memory', async () => {
  const first = await getRangeDeveloperStats('org', W);
  const n = heavyCalls();
  expect(n).toBeGreaterThan(0);
  expect(await getRangeDeveloperStats('org', W)).toBe(first);
  expect(heavyCalls()).toBe(n);
});

it('shares one computation between concurrent requests', async () => {
  await Promise.all([getRangeDeveloperStats('org', W), getRangeDeveloperStats('org', W)]);
  const once = heavyCalls();
  clearRangeCache(); execute.mockClear();
  await getRangeDeveloperStats('org', W);
  expect(heavyCalls()).toBe(once);
});

it('recomputes when a new report completes', async () => {
  await getRangeDeveloperStats('org', W);
  const n = heavyCalls();
  reports.push({ id: 'r2', status: 'completed', period_days: 14, created_at: '2026-10-02T00:00:00Z', completed_at: '2026-10-02T01:00:00Z' });
  await getRangeDeveloperStats('org', W);
  expect(heavyCalls()).toBe(2 * n);
});

it('does not cache a failure', async () => {
  execute.mockImplementationOnce(async () => [reports, []]).mockImplementationOnce(async () => { throw new Error('boom'); });
  await expect(getRangeDeveloperStats('org', W)).rejects.toThrow('boom');
  await expect(getRangeDeveloperStats('org', W)).resolves.toHaveLength(1);
});
