// a 'running' vulnerability_syncs row that outlives its process (crash, kill -9) must not sit
// forever — it wedges isSyncRunning-style UI state and blocks visibility into whether syncs are
// actually healthy. startSync cleans up any such row older than 2h, right before starting a new one.
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/github', () => ({
  getGitHubProvider: () => ({
    listOrgReposForVulns: async () => [],
    listOrgRepoProperties: async () => ({ rows: [], keysSeen: { team: true, tier: true, codebase: true } }),
    listOrgDependabotAlerts: async () => [],
    getRepoDependabotStatus: async () => ({ status: 'ok' }),
  }),
}));

import fs from 'fs';
import os from 'os';
import path from 'path';

let db: any; let startSync: any; let isSyncRunning: any; let dbPath: string;
const prior = {
  SQLITE_PATH: process.env.SQLITE_PATH, DB_TYPE: process.env.DB_TYPE, VULNERABILITIES_ORG: process.env.VULNERABILITIES_ORG,
};
const restore = (k: keyof typeof prior) => { if (prior[k] === undefined) delete process.env[k]; else process.env[k] = prior[k]; };

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vwatchdog-')), 'test.db');
  process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite'; process.env.VULNERABILITIES_ORG = 'o';
  db = (await import('@/lib/db')).default;
  ({ startSync, isSyncRunning } = await import('@/lib/vulnerabilities/scheduler'));
});
afterAll(async () => {
  // Let any fire-and-forget runSync from the last test settle before the DB file is removed.
  for (let i = 0; i < 20 && isSyncRunning(); i++) await new Promise(r => setImmediate(r));
  restore('SQLITE_PATH'); restore('DB_TYPE'); restore('VULNERABILITIES_ORG');
  try { fs.unlinkSync(dbPath); } catch {}
});
beforeEach(async () => {
  await db.execute('DELETE FROM vulnerability_syncs');
  delete (globalThis as any).__glooker_vuln_sync_running;
});

async function waitUntilIdle() {
  for (let i = 0; i < 50 && isSyncRunning(); i++) await new Promise(r => setImmediate(r));
}

it('a running row older than 2h is marked failed by the watchdog when a new sync starts', async () => {
  const old = new Date(Date.now() - 3 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  await db.execute(
    `INSERT INTO vulnerability_syncs (org, trigger_kind, triggered_by, status, started_at) VALUES ('o','manual',NULL,'running',?)`, [old]);
  await startSync('manual', 'a@x');
  await waitUntilIdle();
  const [[row]] = await db.execute(`SELECT status, issues FROM vulnerability_syncs WHERE started_at = ?`, [old]);
  expect(row.status).toBe('failed');
  expect(JSON.parse(row.issues)).toEqual([{ kind: 'watchdog', message: 'marked failed: still running after 2h' }]);
});

it('a running row 10 minutes old is left alone', async () => {
  const recent = new Date(Date.now() - 10 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  await db.execute(
    `INSERT INTO vulnerability_syncs (org, trigger_kind, triggered_by, status, started_at) VALUES ('o','manual',NULL,'running',?)`, [recent]);
  await startSync('manual', 'a@x');
  await waitUntilIdle();
  const [[row]] = await db.execute(`SELECT status FROM vulnerability_syncs WHERE started_at = ?`, [recent]);
  expect(row.status).toBe('running');
});
