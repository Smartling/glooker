/**
 * GLOOK-51 storage behaviour, driven against the REAL SQLite driver.
 *
 * A mocked-DB test is not sufficient here and would have shipped the bug: the
 * first fix bumped PROMPT_VERSION believing that invalidated poisoned rows, and
 * a mock asserting "null was passed for projects" would have passed while the
 * row still ended up '[]'. prompt_version is in the SELECT key but NOT in the
 * unique key — `UNIQUE (report_id, team_name)` — so the upsert lands on the
 * same physical row, where `COALESCE(VALUES(projects), projects)` preserves the
 * old value. Only executing the upsert shows that.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const UPSERT = `INSERT INTO team_pulse_summaries (report_id, team_name, org, summary_text, health_json, projects, prompt_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE summary_text = VALUES(summary_text), health_json = VALUES(health_json), projects = CASE WHEN VALUES(prompt_version) <> prompt_version THEN VALUES(projects) ELSE COALESCE(VALUES(projects), projects) END, prompt_version = VALUES(prompt_version), generated_at = NOW()`;

describe('team_pulse_summaries upsert — poisoned-row recovery', () => {
  const prevSqlitePath = process.env.SQLITE_PATH;
  const prevDbType = process.env.DB_TYPE;
  let tmpDir: string;
  let db: { execute: <T = any>(sql: string, params?: any[]) => Promise<[T[], any]> };

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-glook51-'));
    process.env.SQLITE_PATH = path.join(tmpDir, 'test.db');
    process.env.DB_TYPE = 'sqlite';
    const { createSQLiteDB } = await import('@/lib/db/sqlite');
    db = createSQLiteDB();
    await db.execute(
      `INSERT INTO reports (id, org, period_days, status) VALUES (?, ?, ?, ?)`,
      ['r1', 'Smartling', 14, 'completed'],
    );
  });

  afterAll(() => {
    if (prevSqlitePath === undefined) delete process.env.SQLITE_PATH;
    else process.env.SQLITE_PATH = prevSqlitePath;
    if (prevDbType === undefined) delete process.env.DB_TYPE;
    else process.env.DB_TYPE = prevDbType;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* already gone */ }
  });

  const upsert = (team: string, projects: string | null, version: string) =>
    db.execute(UPSERT, ['r1', team, 'Smartling', 'summary', '{}', projects, version]);

  const readRow = async (team: string) => {
    const [rows] = await db.execute(
      `SELECT projects, prompt_version FROM team_pulse_summaries WHERE report_id = ? AND team_name = ?`,
      ['r1', team],
    ) as [any[], any];
    return rows[0];
  };

  it('confirms the premise: prompt_version is NOT part of the unique key', async () => {
    // If it were, the second insert would create a second row and the whole
    // invalidation story would work as originally claimed.
    await upsert('KeyProbe', '[]', 'v4-inflight');
    await upsert('KeyProbe', null, 'v5-budget');
    const [rows] = await db.execute(
      `SELECT COUNT(*) AS n FROM team_pulse_summaries WHERE report_id = ? AND team_name = ?`,
      ['r1', 'KeyProbe'],
    ) as [any[], any];
    expect(Number(rows[0].n)).toBe(1);
  });

  it('a version change REPLACES a poisoned projects value with NULL', async () => {
    // The GLOOK-51 recovery. Without the CASE, COALESCE keeps '[]' here and the
    // lazy top-up guard (row.projects === null) never fires again.
    await upsert('Integrations', '[]', 'v4-inflight');
    expect((await readRow('Integrations')).projects).toBe('[]');

    await upsert('Integrations', null, 'v5-budget');
    const row = await readRow('Integrations');
    expect(row.projects).toBeNull();
    expect(row.prompt_version).toBe('v5-budget');
  });

  it('still protects the concurrency race WITHIN a version', async () => {
    // Documented at service.ts: a no-withProjects write must not clobber a
    // successfully generated value back to NULL. Deleting the COALESCE to fix
    // the case above would reintroduce exactly this.
    await upsert('Data', JSON.stringify([{ name: 'Real' }]), 'v5-budget');
    await upsert('Data', null, 'v5-budget');
    expect(await readRow('Data').then(r => r.projects)).toBe('[{"name":"Real"}]');
  });

  it('a version change still carries a good new value through', async () => {
    await upsert('GDN', '[]', 'v4-inflight');
    await upsert('GDN', JSON.stringify([{ name: 'Fresh' }]), 'v5-budget');
    expect(await readRow('GDN').then(r => r.projects)).toBe('[{"name":"Fresh"}]');
  });

  it('NEGATIVE CONTROL: the pre-fix upsert preserves the poison, proving the CASE is load-bearing', async () => {
    // This is the SQL that shipped in the first GLOOK-51 attempt. Executing it
    // shows the bump was a no-op that additionally mis-stamped the row, which
    // is what the review found and what a mocked DB could not have shown.
    const OLD = UPSERT.replace(
      'projects = CASE WHEN VALUES(prompt_version) <> prompt_version THEN VALUES(projects) ELSE COALESCE(VALUES(projects), projects) END',
      'projects = COALESCE(VALUES(projects), projects)',
    );
    await upsert('OldSql', '[]', 'v4-inflight');
    await db.execute(OLD, ['r1', 'OldSql', 'Smartling', 'summary', '{}', null, 'v5-budget']);
    const row = await readRow('OldSql');
    expect(row.projects).toBe('[]');          // still poisoned
    expect(row.prompt_version).toBe('v5-budget'); // but now claims to be fixed
  });

  it('a genuine empty result is still persisted, so the page does not re-pay', async () => {
    await upsert('Quiet', '[]', 'v5-budget');
    const row = await readRow('Quiet');
    expect(row.projects).toBe('[]');
  });
});
