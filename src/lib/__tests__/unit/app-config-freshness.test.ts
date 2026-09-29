jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/vulnerabilities/config', () => ({
  isVulnerabilitiesEnabled: jest.fn(() => true), getVulnerabilitiesOrg: jest.fn(() => 'acme'),
}));
jest.mock('@/lib/vulnerabilities/queries', () => ({ getSyncStatus: jest.fn() }));

import db from '@/lib/db';
import { getReportFreshness, getVulnerabilityFreshness } from '@/lib/app-config/service';
import { getSyncStatus } from '@/lib/vulnerabilities/queries';
import { isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';
const exec = db.execute as jest.Mock;
const now = new Date('2026-09-28T13:00:00Z');

beforeEach(() => jest.clearAllMocks());

function route(completed: any[], latest: any[], schedules: any[]) {
  exec.mockImplementation(async (sql: string) => {
    if (sql.includes("status = 'completed'")) return [completed, null];
    if (sql.includes('FROM schedules')) return [schedules, null];
    return [latest, null];
  });
}

it('flags a latest failed run and is not stale without schedules', async () => {
  route([{ created_at: '2026-09-20T10:00:00Z' }], [{ status: 'failed' }], []);
  expect(await getReportFreshness(now)).toEqual({
    latestCompletedAt: '2026-09-20T10:00:00Z', latestRunStatus: 'failed', latestRunFailed: true, stale: false,
  });
});

it('is not failed when the latest run is stopped', async () => {
  route([{ created_at: '2026-09-20T10:00:00Z' }], [{ status: 'stopped' }], []);
  expect(await getReportFreshness(now)).toEqual({
    latestCompletedAt: '2026-09-20T10:00:00Z', latestRunStatus: 'stopped', latestRunFailed: false, stale: false,
  });
});

it('is stale when the latest completed report is older than the schedule allows', async () => {
  route([{ created_at: '2026-09-20T10:00:00Z' }], [{ status: 'completed' }],
    [{ cron_expr: '0 9 * * *', timezone: 'America/New_York', enabled: 1 }]);
  const f = await getReportFreshness(now);
  expect(f?.stale).toBe(true);
  expect(f?.latestRunFailed).toBe(false);
});

it('returns null instead of throwing on a DB error', async () => {
  exec.mockRejectedValue(new Error('db down'));
  expect(await getReportFreshness(now)).toBeNull();
});

it('maps the vulnerability sync status and is null when disabled', async () => {
  (getSyncStatus as jest.Mock).mockResolvedValue({
    lastSuccessfulAt: '2026-09-28T10:04:00Z', stale: false, lastStatus: 'failed', running: false,
    issuesCount: 1, issues: [{ kind: 'fetch', message: 'token expired' }],
  });
  expect(await getVulnerabilityFreshness(now)).toEqual({
    lastSuccessfulAt: '2026-09-28T10:04:00Z', stale: false, lastStatus: 'failed', issue: 'token expired',
  });
  (isVulnerabilitiesEnabled as jest.Mock).mockReturnValue(false);
  expect(await getVulnerabilityFreshness(now)).toBeNull();
});
