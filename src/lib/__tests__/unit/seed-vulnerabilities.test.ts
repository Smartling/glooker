// src/lib/__tests__/unit/seed-vulnerabilities.test.ts
// GLOOK-43 Wave B / B4: the seed skip guard must also check for CSV-import snapshot history, not
// just vulnerability_syncs rows — otherwise an interrupted run (syncs written, CSV history not yet
// written, or vice versa) could double the CSV history on the next `npm run seed`. This test uses a
// fake `db` and only exercises the SKIP branch: seedVulnerabilities returns before its dynamic
// imports (the real sync/mock-provider modules, which use their own module-level `db`) whenever
// either guard trips, so a fake db here never risks touching the real ./glooker.db.
import { seedVulnerabilities } from '../../../../scripts/seed-vulnerabilities';

function fakeDb(counts: { syncs: number; csv: number }) {
  const calls: Array<{ sql: string }> = [];
  return {
    calls,
    execute: async (sql: string) => {
      calls.push({ sql });
      if (sql.includes('FROM vulnerability_syncs')) return [[{ n: counts.syncs }]];
      if (sql.includes('FROM vulnerability_repo_snapshots')) return [[{ n: counts.csv }]];
      throw new Error(`fakeDb: unexpected query: ${sql}`);
    },
  };
}

describe('B4: seedVulnerabilities skip guard', () => {
  let logSpy: jest.SpyInstance;
  beforeEach(() => { logSpy = jest.spyOn(console, 'log').mockImplementation(() => {}); });
  afterEach(() => { logSpy.mockRestore(); });

  it('skips when vulnerability_syncs already has rows', async () => {
    const db = fakeDb({ syncs: 3, csv: 0 });
    await seedVulnerabilities(db);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already seeded, skipping'));
  });

  it("skips when vulnerability_repo_snapshots already has csv-import rows, even with zero syncs, using a source = 'csv-import' filter", async () => {
    const db = fakeDb({ syncs: 0, csv: 5 });
    await seedVulnerabilities(db);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('already seeded, skipping'));
    // Only the two guard queries ran — no writes, confirming it returned before doing anything else
    // (in particular, before the dynamic imports that would touch the real DB via sync.ts's own
    // module-level `db`).
    expect(db.calls.length).toBe(2);
    expect(db.calls.some(c => c.sql.includes('vulnerability_repo_snapshots') && c.sql.includes('csv-import'))).toBe(true);
  });
});
