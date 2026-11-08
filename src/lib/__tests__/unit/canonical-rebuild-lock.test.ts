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
