jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
jest.mock('@/lib/analyzer', () => ({ analyzeCommit: jest.fn() }));

import fs from 'fs';
import os from 'os';
import path from 'path';

let dbPath: string;
let db: any;
let reuse: any;
let analyzeCommit: jest.Mock;

const priorSqlitePath = process.env.SQLITE_PATH;
const priorDbType = process.env.DB_TYPE;

const commitFor = (sha: string): any => ({
  sha, repo: 'repo', author: 'u', authorName: 'U', authorEmail: 'u@x', avatarUrl: '',
  message: 'm', fullMessage: 'm', diff: '', additions: 1, deletions: 1,
  prNumber: null, prTitle: null, committedAt: '2026-10-01T00:00:00Z',
  aiCoAuthored: false, aiToolName: null,
});

beforeAll(async () => {
  dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-reuse-')), 'test.db');
  process.env.SQLITE_PATH = dbPath;
  process.env.DB_TYPE = 'sqlite';
  db = (await import('@/lib/db')).default;
  analyzeCommit = (await import('@/lib/analyzer')).analyzeCommit as jest.Mock;
  reuse = await import('@/lib/canonical/reuse');
  const rb = await import('@/lib/canonical/rebuild');

  await db.execute("INSERT INTO reports (id, org, period_days, status) VALUES ('r1', 'acme', 14, 'completed')");
  await db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, type, impact_summary, risk_level, maybe_ai, committed_at)
     VALUES ('r1', 'u', 'repo', 'aaa', 7, 'bug', 'fixed it', 'high', 1, '2026-10-01 00:00:00')`,
  );
  await db.execute(
    `INSERT INTO commit_analyses (report_id, github_login, repo, commit_sha, complexity, committed_at)
     VALUES ('r1', 'u', 'repo', 'bbb', NULL, '2026-10-01 00:00:00')`,
  );
  await rb.rebuildCanonical();
});
afterAll(() => {
  if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH;
  else process.env.SQLITE_PATH = priorSqlitePath;
  if (priorDbType === undefined) delete process.env.DB_TYPE;
  else process.env.DB_TYPE = priorDbType;
  try { fs.unlinkSync(dbPath); } catch {}
});
beforeEach(() => {
  analyzeCommit.mockReset();
  analyzeCommit.mockImplementation(async (c: any) => ({
    sha: c.sha, complexity: 1, type: 'other', impactSummary: 'llm', riskLevel: 'low', maybeAi: false,
  }));
});

it('reuses an analysis from an earlier completed report without calling the LLM', async () => {
  const r = await reuse.analyzeWithReuse('acme', commitFor('aaa'), true);
  expect(r).toEqual({
    reused: true,
    analysis: { sha: 'aaa', complexity: 7, type: 'bug', riskLevel: 'high', maybeAi: true, impactSummary: 'fixed it' },
  });
  expect(analyzeCommit).not.toHaveBeenCalled();
});

it('calls the LLM when the stored copy has no complexity', async () => {
  const r = await reuse.analyzeWithReuse('acme', commitFor('bbb'), true);
  expect(analyzeCommit).toHaveBeenCalledTimes(1);
  expect(r.reused).toBe(false);
});

it('never reuses before the org is built', async () => {
  const r = await reuse.analyzeWithReuse('acme', commitFor('aaa'), false);
  expect(analyzeCommit).toHaveBeenCalledTimes(1);
  expect(r.reused).toBe(false);
});

it('never reuses across orgs', async () => {
  const r = await reuse.analyzeWithReuse('other', commitFor('aaa'), true);
  expect(analyzeCommit).toHaveBeenCalledTimes(1);
  expect(r.reused).toBe(false);
});

it('falls back to the LLM when the reuse lookup throws', async () => {
  const spy = jest.spyOn(db, 'execute').mockRejectedValueOnce(new Error('db down'));
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  const r = await reuse.analyzeWithReuse('acme', commitFor('aaa'), true);
  expect(r.reused).toBe(false);
  expect(r.analysis.impactSummary).toBe('llm');
  expect(analyzeCommit).toHaveBeenCalledTimes(1);
  spy.mockRestore(); warn.mockRestore();
});

it('batch lookup returns only analysed copies of the org', async () => {
  const m = await reuse.findReusableAnalyses('acme', ['aaa', 'bbb', 'zzz']);
  expect([...m.keys()]).toEqual(['aaa']);
  expect(m.get('aaa').complexity).toBe(7);
});

it('uses a prefetched map without querying per commit', async () => {
  const prefetched = await reuse.findReusableAnalyses('acme', ['aaa', 'bbb']);
  const spy = jest.spyOn(db, 'execute');
  const hit = await reuse.analyzeWithReuse('acme', commitFor('aaa'), true, prefetched);
  const miss = await reuse.analyzeWithReuse('acme', commitFor('bbb'), true, prefetched);
  expect(spy).not.toHaveBeenCalled();
  expect(hit.reused).toBe(true);
  expect(miss.reused).toBe(false);
  expect(analyzeCommit).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
