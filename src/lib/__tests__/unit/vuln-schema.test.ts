import fs from 'fs';
import os from 'os';
import path from 'path';
import { readFileSync } from 'fs';

const root = path.join(__dirname, '../../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');
const TABLES = ['vulnerability_repos', 'vulnerability_alerts', 'vulnerability_syncs', 'vulnerability_repo_snapshots'];

describe('vulnerability tables exist in every schema location, without a pinned charset', () => {
  it.each(TABLES)('%s', (t) => {
    for (const f of ['schema.sql', 'src/lib/db/mysql.ts', 'src/lib/db/sqlite.ts']) {
      expect(read(f)).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
    const sql = read('schema.sql');
    const block = sql.slice(sql.indexOf(`CREATE TABLE IF NOT EXISTS ${t}`));
    expect(block.slice(0, block.indexOf(');'))).not.toMatch(/CHARSET|COLLATE/i);
  });
  it('never names a column `trigger` (reserved in MySQL)', () => {
    expect(read('schema.sql')).not.toMatch(/^\s*trigger\s/m);
  });
});

describe('SQLite upserts on the new tables', () => {
  let dbPath: string;
  let db: any;
  let upsertRows: any;
  const priorSqlitePath = process.env.SQLITE_PATH;
  const priorDbType = process.env.DB_TYPE;

  beforeAll(async () => {
    dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-vuln-')), 'test.db');
    process.env.SQLITE_PATH = dbPath;
    process.env.DB_TYPE = 'sqlite';
    db = (await import('@/lib/db')).default;
    ({ upsertRows } = await import('@/lib/vulnerabilities/db-helpers'));
  });
  afterAll(() => {
    if (priorSqlitePath === undefined) delete process.env.SQLITE_PATH; else process.env.SQLITE_PATH = priorSqlitePath;
    if (priorDbType === undefined) delete process.env.DB_TYPE; else process.env.DB_TYPE = priorDbType;
    try { fs.unlinkSync(dbPath); } catch {}
  });

  it('vulnerability_repos conflicts on repo_id and updates, keeping first_seen_at', async () => {
    const cols = ['repo_id', 'org', 'full_name', 'team', 'service_tier', 'codebase_type', 'archived',
      'dependabot_status', 'dependabot_status_detail', 'first_seen_at', 'last_seen_at'];
    const upd = cols.filter(c => c !== 'repo_id' && c !== 'first_seen_at');
    await upsertRows(db, 'vulnerability_repos', cols, upd,
      [[1, 'o', 'o/a', 'T1', 'production', 'backend', 0, 'ok', null, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z']]);
    await upsertRows(db, 'vulnerability_repos', cols, upd,
      [[1, 'o', 'o/a-renamed', 'T2', 'production', 'backend', 1, 'archived', null, '2026-09-02T00:00:00Z', '2026-09-02T00:00:00Z']]);
    const [rows] = await db.execute('SELECT * FROM vulnerability_repos');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ full_name: 'o/a-renamed', team: 'T2', archived: 1, first_seen_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-02T00:00:00Z' });
  });

  it('vulnerability_alerts conflicts on (repo_id, number), in batches larger than batchSize', async () => {
    const cols = ['repo_id', 'number', 'org', 'html_url', 'state', 'severity', 'created_at', 'first_seen_sync_id', 'last_seen_sync_id'];
    const rows = Array.from({ length: 450 }, (_, i) => [1, i + 1, 'o', `u${i}`, 'open', 'critical', '2026-09-01T00:00:00Z', 1, 1]);
    await upsertRows(db, 'vulnerability_alerts', cols, ['state', 'last_seen_sync_id'], rows, 200);
    await upsertRows(db, 'vulnerability_alerts', cols, ['state', 'last_seen_sync_id'],
      [[1, 7, 'o', 'u6', 'fixed', 'critical', '2026-09-01T00:00:00Z', 1, 2]]);
    const [[count]] = await db.execute('SELECT COUNT(*) AS n FROM vulnerability_alerts');
    expect(count.n).toBe(450);
    const [[a7]] = await db.execute('SELECT state, first_seen_sync_id, last_seen_sync_id FROM vulnerability_alerts WHERE repo_id = 1 AND number = 7');
    expect(a7).toEqual({ state: 'fixed', first_seen_sync_id: 1, last_seen_sync_id: 2 });
  });
});
