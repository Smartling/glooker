jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
import fs from 'fs'; import os from 'os'; import path from 'path';

let db: any; let init: any; let dbPath: string;
const prior = { SQLITE_PATH: process.env.SQLITE_PATH, DB_TYPE: process.env.DB_TYPE, VULNERABILITIES_ORG: process.env.VULNERABILITIES_ORG };
beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vboot-')), 'test.db');
  process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite'; process.env.VULNERABILITIES_ORG = 'o';
  db = (await import('@/lib/db')).default;
  ({ initVulnerabilityScheduler: init } = await import('@/lib/vulnerabilities/scheduler'));
});
afterAll(() => {
  (globalThis as any).__glooker_vuln_job?.stop();   // croner timers would otherwise keep Jest alive
  delete (globalThis as any).__glooker_vuln_init;
  for (const [k, v] of Object.entries(prior)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { fs.unlinkSync(dbPath); } catch {}
});

it('marks running syncs failed with "interrupted by restart" and registers the job', async () => {
  await db.execute(`INSERT INTO vulnerability_syncs (org, trigger_kind, status, started_at) VALUES ('o','schedule','running','2026-09-22T06:00:00Z')`);
  await init();
  const [[row]] = await db.execute('SELECT status, finished_at, issues FROM vulnerability_syncs');
  expect(row.status).toBe('failed');
  expect(row.finished_at).not.toBeNull();
  expect(JSON.parse(row.issues)).toEqual([{ kind: 'restart', message: 'interrupted by restart' }]);
  expect((globalThis as any).__glooker_vuln_job).toBeDefined();
});
