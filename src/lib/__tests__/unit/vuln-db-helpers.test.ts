// db-helpers.ts had no dedicated test file — rowToAlertFact/rowToRepoFact are
// the one place a stored row becomes the shape the aggregation layer trusts, so their mapping rules
// deserve independent coverage, not just incidental exercise through sync.ts's tests.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { rowToAlertFact, rowToRepoFact } from '@/lib/vulnerabilities/db-helpers';

const baseAlertRow = {
  repo_id: '1', number: '1', html_url: 'u', state: 'open', severity: 'critical', severity_changed_at: null,
  ghsa_id: 'G1', cve_id: 'CVE-1', summary: 's', cvss_score: null, epss_percentage: null,
  advisory_withdrawn_at: null, package_name: 'p', ecosystem: 'npm', manifest_path: 'm',
  relationship: 'direct', scope: null, created_at: '2026-09-01T00:00:00Z', gh_updated_at: null,
  fixed_at: null, dismissed_at: null, auto_dismissed_at: null, dismissed_reason: null,
  reopened_count: 0, last_reopened_at: null, missing_since: null,
};

describe('rowToAlertFact', () => {
  it('an open alert has resolvedAt null', () => {
    expect(rowToAlertFact({ ...baseAlertRow, state: 'open' }).resolvedAt).toBeNull();
  });
  it('a dismissed alert takes dismissed_at', () => {
    const fact = rowToAlertFact({ ...baseAlertRow, state: 'dismissed', dismissed_at: '2026-09-10T00:00:00Z' });
    expect(fact.resolvedAt).toBe('2026-09-10T00:00:00Z');
  });
  it('a DECIMAL string becomes a number', () => {
    const fact = rowToAlertFact({ ...baseAlertRow, cvss_score: '9.10', epss_percentage: '0.00500' });
    expect(fact.cvssScore).toBe(9.1);
    expect(fact.epssPercentage).toBe(0.005);
  });
  it('withdrawn is true when advisory_withdrawn_at is set', () => {
    expect(rowToAlertFact({ ...baseAlertRow, advisory_withdrawn_at: '2026-09-11T00:00:00Z' }).withdrawn).toBe(true);
    expect(rowToAlertFact({ ...baseAlertRow, advisory_withdrawn_at: null }).withdrawn).toBe(false);
  });
});

describe('rowToRepoFact', () => {
  it('archived 1 -> true, 0 -> false', () => {
    const base = { repo_id: '1', full_name: 'o/r', team: null, service_tier: 'production', codebase_type: 'backend', dependabot_status: 'ok', dependabot_status_detail: null };
    expect(rowToRepoFact({ ...base, archived: 1 }).archived).toBe(true);
    expect(rowToRepoFact({ ...base, archived: 0 }).archived).toBe(false);
  });
});

describe('insertRows batching (real SQLite)', () => {
  let dbPath: string; let db: any; let insertRows: any;
  const priorSqlitePath = process.env.SQLITE_PATH;
  const priorDbType = process.env.DB_TYPE;

  beforeAll(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vdbh-')), 'test.db');
    process.env.SQLITE_PATH = dbPath; process.env.DB_TYPE = 'sqlite';
    db = (await import('@/lib/db')).default;
    ({ insertRows } = await import('@/lib/vulnerabilities/db-helpers'));
  });
  afterAll(() => {
    if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
    if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('inserts more rows than the default batch size (200), in chunks, without dropping any', async () => {
    const cols = ['org', 'source', 'sync_id', 'source_file', 'taken_on', 'measured_at', 'repo_id', 'full_name',
      'team_at_time', 'service_tier_at_time', 'codebase_type_at_time', 'archived', 'open_critical', 'open_high',
      'resolved_critical_since_start', 'resolved_high_since_start'];
    const rows = Array.from({ length: 450 }, (_, i) => [
      'o', 'sync', 1, null, '2026-09-22', '2026-09-22T10:00:00Z', i + 1, `o/r${i + 1}`, null, 'production', 'backend', 0, 1, 0, 0, 0,
    ]);
    await insertRows(db, 'vulnerability_repo_snapshots', cols, rows, 200);
    const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_repo_snapshots');
    expect(count.n).toBe(450);
  });
});
