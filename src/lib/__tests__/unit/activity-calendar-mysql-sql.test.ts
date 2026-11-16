// On MySQL, days must be UTC whatever the session time_zone is: TIMESTAMP columns are bucketed by
// epoch seconds (UNIX_TIMESTAMP) and bounded with FROM_UNIXTIME, never by their session-zone text.
const calls: Array<{ sql: string; params: any[] }> = [];
const execute = jest.fn(async (sql: string, params: any[]) => {
  calls.push({ sql, params });
  if (sql.includes('developer_stats')) return [[], null];
  // 2026-11-01 = day 20758 since 1970-01-01
  return [[{ login: 'ann', day: 20758, value: 2 }], null];
});
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute } }));

const priorDbType = process.env.DB_TYPE;
beforeAll(() => { process.env.DB_TYPE = 'mysql'; });
afterAll(() => {
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
});

import { getTeamCalendar } from '@/lib/activity-calendar/service';

it('buckets TIMESTAMP columns by epoch day and bounds them with epoch seconds', async () => {
  const r = await getTeamCalendar('acme', ['Ann'], 'commits', new Date('2026-11-10T15:00:00Z'));
  const q = calls.find((c) => c.sql.includes('commit_canonical'))!;
  expect(q.sql).toContain('FLOOR(UNIX_TIMESTAMP(committed_at) / 86400)');
  expect(q.sql).toContain('committed_at >= FROM_UNIXTIME(?) AND committed_at < FROM_UNIXTIME(?)');
  expect(q.sql).not.toContain('SUBSTR(committed_at');
  expect(q.params).toEqual(['acme', 'ann', Date.UTC(2025, 10, 11) / 1000, Date.UTC(2026, 10, 11) / 1000]);
  expect(r.rows[0]).toMatchObject({ login: 'Ann', total: 2, days: { '2026-11-01': 2 } });
});
