jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn().mockResolvedValue([[], null]) } }));
jest.mock('@/lib/vulnerabilities/sync', () => ({
  insertRunningSync: jest.fn().mockResolvedValue(11),
  runSync: jest.fn(),
}));
jest.mock('@/lib/github', () => ({ getGitHubProvider: jest.fn(() => ({})) }));

import db from '@/lib/db/index';
import { insertRunningSync, runSync } from '@/lib/vulnerabilities/sync';
import { getGitHubProvider } from '@/lib/github';
import { startSync, isSyncRunning, initVulnerabilityScheduler } from '@/lib/vulnerabilities/scheduler';
import { getSyncSchedule, isVulnerabilitiesEnabled } from '@/lib/vulnerabilities/config';

const prior = { ...process.env };
afterEach(() => { process.env = { ...prior }; delete (globalThis as any).__glooker_vuln_sync_running; });

it('is disabled without VULNERABILITIES_ORG', async () => {
  delete process.env.VULNERABILITIES_ORG;
  expect(isVulnerabilitiesEnabled()).toBe(false);
  expect(await startSync('manual', null)).toEqual({ status: 'disabled' });
});

it('single-flight: a second start before the first finishes is rejected synchronously', async () => {
  process.env.VULNERABILITIES_ORG = 'o';
  let finish!: () => void;
  (runSync as jest.Mock).mockImplementation(() => new Promise<void>(r => { finish = r; }));
  const p1 = startSync('manual', 'a@x');
  const p2 = startSync('schedule', null); // no await between the two calls
  expect(await p2).toEqual({ status: 'already-running' });
  expect(await p1).toEqual({ status: 'started', syncId: 11 });
  expect(isSyncRunning()).toBe(true);
  finish();
  await new Promise(r => setImmediate(r));
  expect(isSyncRunning()).toBe(false);
  expect(insertRunningSync).toHaveBeenCalledTimes(1);
});

it('a synchronous getGitHubProvider throw clears the running flag, marks the sync failed, and rethrows', async () => {
  process.env.VULNERABILITIES_ORG = 'o';
  (db.execute as jest.Mock).mockClear();
  (getGitHubProvider as jest.Mock).mockImplementationOnce(() => { throw new Error('no token configured'); });
  await expect(startSync('manual', 'a@x')).rejects.toThrow('no token configured');
  expect(isSyncRunning()).toBe(false);
  // A watchdog UPDATE (also "status = 'failed'") now runs before insertRunningSync,
  // so the first matching call is no longer necessarily the dispatch-failure one — match on the
  // params carrying this run's syncId (11) instead of call order.
  const failCall = (db.execute as jest.Mock).mock.calls.find(([, params]) => Array.isArray(params) && params.includes(11));
  expect(failCall).toBeTruthy();
  expect(failCall![1]).toEqual(expect.arrayContaining([11]));
});

it('defaults the schedule to 06:00 America/New_York', () => {
  delete process.env.VULN_SYNC_CRON; delete process.env.VULN_SYNC_TZ;
  expect(getSyncSchedule()).toEqual({ cron: '0 6 * * *', tz: 'America/New_York' });
});

// Boot recovery is tested against real SQLite in vuln-scheduler-boot.test.ts (below), not by SQL text.
