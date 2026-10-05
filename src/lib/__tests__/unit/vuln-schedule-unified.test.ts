// GLOOK-59 follow-up: the Dependabot alerts sync is scheduled through the same `schedules` table
// and scheduler manager as GitHub reports. Exercised against real SQLite.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
const mockStartSync = jest.fn();
jest.mock('@/lib/report-runner', () => ({ runReport: jest.fn().mockResolvedValue(undefined), requestStop: jest.fn() }));
import fs from 'fs'; import os from 'os'; import path from 'path';

let db: any;
let vuln: typeof import('@/lib/vulnerabilities/scheduler');
let manager: typeof import('@/lib/schedule/manager');
let service: typeof import('@/lib/schedule/service');
let dbPath: string;
const prior = {
  SQLITE_PATH: process.env.SQLITE_PATH, DB_TYPE: process.env.DB_TYPE,
  VULNERABILITIES_ORG: process.env.VULNERABILITIES_ORG, VULN_SYNC_CRON: process.env.VULN_SYNC_CRON, VULN_SYNC_TZ: process.env.VULN_SYNC_TZ,
};
const g = globalThis as any;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vsched-')), 'test.db');
  process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite'; process.env.VULNERABILITIES_ORG = 'acme';
  process.env.VULN_SYNC_CRON = '0 7 * * 1-5'; process.env.VULN_SYNC_TZ = 'UTC';
  db = (await import('@/lib/db')).default;
  vuln = await import('@/lib/vulnerabilities/scheduler');
  manager = await import('@/lib/schedule/manager');
  service = await import('@/lib/schedule/service');
});
afterAll(() => {
  for (const job of (g.__glooker_schedules as Map<string, any> | undefined)?.values() ?? []) job.stop();
  g.__glooker_schedules?.clear();
  delete g.__glooker_vuln_init; delete g.__glooker_scheduler_init;
  for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fs.unlinkSync(dbPath); } catch {}
});

const vulnRows = async () => (await db.execute(`SELECT * FROM schedules WHERE kind = 'vuln_sync'`))[0] as any[];

it('seeds one vuln_sync schedule from VULN_SYNC_CRON/TZ on first boot and registers it', async () => {
  await vuln.initVulnerabilityScheduler();
  const rows = await vulnRows();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ org: 'acme', cron_expr: '0 7 * * 1-5', timezone: 'UTC', enabled: 1, kind: 'vuln_sync' });
  expect((g.__glooker_schedules as Map<string, any>).has(rows[0].id)).toBe(true);
});

it('is seed-only: a restart with a different env cron neither duplicates nor overwrites the row', async () => {
  process.env.VULN_SYNC_CRON = '0 3 * * *';
  delete g.__glooker_vuln_init;
  await vuln.initVulnerabilityScheduler();
  const rows = await vulnRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].cron_expr).toBe('0 7 * * 1-5');
});

it('getVulnSchedule reports the row, and the next run follows a Settings edit', async () => {
  const [row] = await vulnRows();
  await service.updateSchedule(row.id, { org: 'ignored', periodDays: 3, cronExpr: '30 5 * * *', timezone: 'America/New_York', enabled: true });
  const s = await vuln.getVulnSchedule();
  expect(s).toMatchObject({ id: row.id, cron: '30 5 * * *', tz: 'America/New_York', enabled: true });
  expect(s!.next_run).toMatch(/T(09|10):30:00Z$/); // 05:30 New York, EDT or EST
  const [[after]] = await db.execute(`SELECT org, period_days FROM schedules WHERE id = ?`, [row.id]);
  expect(after).toMatchObject({ org: 'acme' }); // a vuln row's org is not editable
});

it('pausing the vuln schedule unregisters it and reports no next run', async () => {
  const [row] = await vulnRows();
  await service.updateSchedule(row.id, { org: 'acme', periodDays: 0, cronExpr: '30 5 * * *', timezone: 'America/New_York', enabled: false });
  expect((g.__glooker_schedules as Map<string, any>).has(row.id)).toBe(false);
  expect(await vuln.getVulnSchedule()).toMatchObject({ enabled: false, next_run: null });
});

it('refuses to delete the vuln schedule', async () => {
  const [row] = await vulnRows();
  await expect(service.deleteSchedule(row.id)).rejects.toBeInstanceOf(service.ScheduleNotDeletableError);
  expect(await vulnRows()).toHaveLength(1);
});

it('the manager dispatches a vuln_sync row to startSync and records last_run_at, not a report', async () => {
  const [row] = await vulnRows();
  const spy = jest.spyOn(vuln, 'startSync').mockResolvedValue({ status: 'started', syncId: 7 } as any);
  await manager.triggerSchedule(row);
  expect(spy).toHaveBeenCalledWith('schedule', null);
  const [[after]] = await db.execute(`SELECT last_run_at FROM schedules WHERE id = ?`, [row.id]);
  expect(after.last_run_at).not.toBeNull();
  const [reports] = await db.execute(`SELECT id FROM reports`);
  expect(reports).toHaveLength(0);
  spy.mockRestore();
});

it('lists the vuln row as kind vuln_sync with its latest sync status, and hides it when the feature is off', async () => {
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at, finished_at) VALUES ('acme','schedule','partial','2026-09-30T06:00:00Z','2026-09-30T06:04:00Z')`);
  const listed = (await service.listSchedules()).find((s: any) => s.kind === 'vuln_sync');
  expect(listed).toMatchObject({ org: 'acme', last_report_status: 'partial' });
  process.env.VULNERABILITIES_ORG = '';
  expect((await service.listSchedules()).some((s: any) => s.kind === 'vuln_sync')).toBe(false);
  process.env.VULNERABILITIES_ORG = 'acme';
});

it('creating through the service always makes a report schedule', async () => {
  const id = await service.createSchedule({ org: 'acme', periodDays: 14, cronExpr: '0 9 * * 1', timezone: 'UTC', enabled: false });
  const [[row]] = await db.execute(`SELECT kind FROM schedules WHERE id = ?`, [id]);
  expect(row.kind).toBe('report');
  void mockStartSync;
});

it('concurrent first-boot seeds collapse into one row with the fixed id', async () => {
  await db.execute(`DELETE FROM schedules WHERE kind = 'vuln_sync'`);
  delete g.__glooker_vuln_init;
  await Promise.all([vuln.initVulnerabilityScheduler(), (async () => { delete g.__glooker_vuln_init; await vuln.initVulnerabilityScheduler(); })()]);
  const rows = await vulnRows();
  expect(rows).toHaveLength(1);
  expect(rows[0].id).toBe(vuln.VULN_SCHEDULE_ID);
});

it("the row's org follows VULNERABILITIES_ORG on boot", async () => {
  process.env.VULNERABILITIES_ORG = 'renamed-org';
  delete g.__glooker_vuln_init;
  try {
    await vuln.initVulnerabilityScheduler();
    expect((await vulnRows())[0].org).toBe('renamed-org');
  } finally { process.env.VULNERABILITIES_ORG = 'acme'; delete g.__glooker_vuln_init; await vuln.initVulnerabilityScheduler(); }
});

it('editing the vuln row while the feature is off saves it but registers no job', async () => {
  const [row] = await vulnRows();
  manager.unregisterSchedule(row.id);
  process.env.VULNERABILITIES_ORG = '';
  try {
    await service.updateSchedule(row.id, { org: 'acme', periodDays: 0, cronExpr: '15 4 * * *', timezone: 'UTC', enabled: true });
    expect((g.__glooker_schedules as Map<string, any>).has(row.id)).toBe(false);
    const [[after]] = await db.execute(`SELECT cron_expr, enabled FROM schedules WHERE id = ?`, [row.id]);
    expect(after).toMatchObject({ cron_expr: '15 4 * * *', enabled: 1 });
  } finally { process.env.VULNERABILITIES_ORG = 'acme'; }
});
