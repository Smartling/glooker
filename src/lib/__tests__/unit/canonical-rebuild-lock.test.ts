/** Lock order (I1/M1): rebuildOrg and refreshReport take canonical_builds FOR UPDATE first. */
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() }));
const txLog: string[][] = [];
let current: string[] = [];
const txExecute = jest.fn(async (sql: string, _params?: unknown[]) => { current.push(sql); return [[], null]; });
const poolExecute = jest.fn();
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: {
    execute: (...a: any[]) => poolExecute(...a),
    transaction: async (fn: any) => { current = []; txLog.push(current); return fn({ execute: txExecute }); },
  },
}));
jest.mock('@/lib/canonical/pick', () => ({
  CANONICAL_BATCH: 500,
  chunks: (xs: any[]) => (xs.length ? [xs] : []),
  expectedCommitPicks: jest.fn(async () => new Map([['a', 1]])),
  expectedJiraPicks: jest.fn(async () => new Map([['K-1', 2]])),
  insertCommitsByIds: jest.fn(async (tx: any) => tx.execute('INSERT INTO commit_canonical ...')),
  insertJiraByIds: jest.fn(async (tx: any) => tx.execute('INSERT INTO jira_canonical ...')),
  refreshCommitKeys: jest.fn(async (tx: any) => tx.execute('REFRESH commit_canonical')),
  refreshJiraKeys: jest.fn(async (tx: any) => tx.execute('REFRESH jira_canonical')),
}));

import { runRebuild } from '@/lib/canonical/rebuild';

const LOCK = /^SELECT org FROM canonical_builds WHERE org = \? FOR UPDATE$/;

it('rebuildOrg and the late-report refresh both lock canonical_builds first', async () => {
  poolExecute.mockImplementation(async (sql: string) => {
    if (/SELECT id, org FROM reports/.test(sql)) return [[{ id: 'late', org: 'acme' }], null];
    if (/FROM canonical_builds/.test(sql)) return [[{ org: 'acme', built_at: 'x', duration_ms: 1, commit_rows: 1, jira_rows: 1 }], null];
    if (/SELECT DISTINCT org FROM reports/.test(sql)) return [[{ org: 'acme' }], null];
    if (/SELECT id FROM reports/.test(sql)) return [[{ id: 'r1' }], null];
    return [[], null];
  });
  await runRebuild('h', { completedIds: new Set(['r1']) });
  expect(txLog).toHaveLength(2); // rebuildOrg + refreshReport('late')
  for (const stmts of txLog) {
    expect(stmts[0]).toMatch(LOCK);
    expect(stmts.slice(1).some((s) => LOCK.test(s))).toBe(false);
  }
  expect(txExecute.mock.calls.find((c) => LOCK.test(c[0]))![1]).toEqual(['acme']);
  expect(txLog[0][1]).toMatch(/^DELETE FROM commit_canonical/);
});

const poolDefault = async (sql: string) => {
  if (/SELECT id, org FROM reports/.test(sql)) return [[{ id: 'late', org: 'acme' }], null];
  if (/FROM canonical_builds/.test(sql)) return [[{ org: 'acme', built_at: 'x', duration_ms: 1, commit_rows: 1, jira_rows: 1 }], null];
  if (/SELECT DISTINCT org FROM reports/.test(sql)) return [[{ org: 'acme' }], null];
  if (/SELECT id FROM reports/.test(sql)) return [[{ id: 'r1' }], null];
  return [[], null];
};
const deadlock = () => Object.assign(new Error('Deadlock found'), { errno: 1213, code: 'ER_LOCK_DEADLOCK' });

it('retries the rebuild transaction on a deadlock', async () => {
  txLog.length = 0;
  poolExecute.mockImplementation(poolDefault);
  let thrown = false;
  txExecute.mockImplementation(async (sql: string) => {
    current.push(sql);
    if (!thrown && /DELETE FROM commit_canonical/.test(sql)) { thrown = true; throw deadlock(); }
    return [[], null];
  });
  const [res] = await runRebuild('h', { completedIds: new Set(['r1']) });
  expect(res.ok).toBe(true);
  expect(txLog.length).toBe(3); // failed rebuildOrg attempt, retry, late refresh
});

it('a failed late-report catch-up marks its org failed but keeps the results', async () => {
  txLog.length = 0;
  poolExecute.mockImplementation(poolDefault);
  txExecute.mockImplementation(async (sql: string) => {
    current.push(sql);
    if (/REFRESH commit_canonical/.test(sql)) throw new Error('boom');
    return [[], null];
  });
  const results = await runRebuild('h', { completedIds: new Set(['r1']) });
  expect(results).toHaveLength(1);
  expect(results[0]).toMatchObject({ org: 'acme', ok: false, commitRows: 1 });
  expect(results[0].error).toMatch(/catch-up of report late failed: boom/);
  expect(poolExecute.mock.calls.some((c) => /DELETE FROM canonical_rebuild_lock/.test(c[0]))).toBe(true);
});

it('bumps the lock heartbeat after each org', async () => {
  txExecute.mockImplementation(async (sql: string) => { current.push(sql); return [[], null]; });
  poolExecute.mockClear();
  poolExecute.mockImplementation(poolDefault);
  await runRebuild('h', { completedIds: new Set(['r1', 'late']) });
  const beat = poolExecute.mock.calls.find((c) => /UPDATE canonical_rebuild_lock SET started_at/.test(c[0]));
  expect(beat![1][1]).toBe('h');
});
