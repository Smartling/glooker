// getSyncProgressView (queries.ts) pulls in scheduler.ts -> github.ts -> @octokit/rest
// transitively, so this file needs the factory mock (a bare jest.mock('@octokit/rest') auto-mocks
// but still loads the real ESM module, which dies with "unexpected token").
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let db: any; let insertRunningSync: any; let getSyncProgressView: any; let SyncNotFoundError: any; let initSyncProgress: any;
let dbPath: string;
const priorSqlitePath = process.env.SQLITE_PATH; const priorDbType = process.env.DB_TYPE;
const priorOrg = process.env.VULNERABILITIES_ORG;

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vprogview-')), 'test.db');
  process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite';
  process.env.VULNERABILITIES_ORG = 'o';
  db = (await import('@/lib/db')).default;
  ({ insertRunningSync } = await import('@/lib/vulnerabilities/sync'));
  ({ getSyncProgressView, SyncNotFoundError } = await import('@/lib/vulnerabilities/queries'));
  ({ initSyncProgress } = await import('@/lib/vulnerabilities/progress'));
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
  if (priorOrg === undefined) delete process.env.VULNERABILITIES_ORG; else process.env.VULNERABILITIES_ORG = priorOrg;
  try { fs.unlinkSync(dbPath); } catch {}
});
beforeEach(async () => {
  await db.execute('DELETE FROM vulnerability_syncs');
});

it('a store hit returns the store data directly', async () => {
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  initSyncProgress(id);
  const view = await getSyncProgressView(id);
  expect(view).toEqual({ status: 'running', step: 'Starting…', done: 0, total: 0, logs: [] });
});

it('store miss + a running DB row falls back to a generic Running… view', async () => {
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  // deliberately no initSyncProgress(id) — simulates a fresh process after a restart, where the
  // in-memory store never saw this sync at all.
  const view = await getSyncProgressView(id);
  expect(view).toEqual({ status: 'running', step: 'Running…', done: 0, total: 0, logs: [] });
});

it('store miss + a finished (succeeded) DB row reports its status with step Done', async () => {
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  await db.execute(`UPDATE vulnerability_syncs SET status = 'succeeded', finished_at = ? WHERE id = ?`, ['2026-09-22T10:05:00Z', id]);
  const view = await getSyncProgressView(id);
  expect(view).toEqual({ status: 'succeeded', step: 'Done', done: 0, total: 0, logs: [] });
});

it('store miss + a finished (partial) DB row reports partial with step Done', async () => {
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  await db.execute(`UPDATE vulnerability_syncs SET status = 'partial', finished_at = ? WHERE id = ?`, ['2026-09-22T10:05:00Z', id]);
  const view = await getSyncProgressView(id);
  expect(view).toEqual({ status: 'partial', step: 'Done', done: 0, total: 0, logs: [] });
});

it('store miss + a finished (failed) DB row reports failed with step Failed', async () => {
  const id = await insertRunningSync('o', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  await db.execute(`UPDATE vulnerability_syncs SET status = 'failed', finished_at = ? WHERE id = ?`, ['2026-09-22T10:05:00Z', id]);
  const view = await getSyncProgressView(id);
  expect(view).toEqual({ status: 'failed', step: 'Failed', done: 0, total: 0, logs: [] });
});

it('an unknown id throws SyncNotFoundError', async () => {
  await expect(getSyncProgressView(999999)).rejects.toThrow(SyncNotFoundError);
});

it('a row belonging to a different org is treated as unknown (org-scoped lookup)', async () => {
  const id = await insertRunningSync('p', 'manual', 'a@x', new Date('2026-09-22T10:00:00Z'));
  await expect(getSyncProgressView(id)).rejects.toThrow(SyncNotFoundError);
});
