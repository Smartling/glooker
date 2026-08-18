import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { DB } from './index';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS reports (
  id           TEXT    NOT NULL PRIMARY KEY,
  org          TEXT    NOT NULL,
  period_days  INTEGER NOT NULL,
  status       TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','stopped')),
  error        TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS developer_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  github_name     TEXT,
  avatar_url      TEXT,
  total_prs       INTEGER NOT NULL DEFAULT 0,
  total_commits   INTEGER NOT NULL DEFAULT 0,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  avg_complexity  REAL,
  impact_score    REAL,
  pr_percentage   INTEGER NOT NULL DEFAULT 0,
  ai_percentage   INTEGER NOT NULL DEFAULT 0,
  total_jira_issues INTEGER NOT NULL DEFAULT 0,
  type_breakdown  TEXT,
  active_repos    TEXT,
  cc_total_cost   REAL    NOT NULL DEFAULT 0,
  cc_requests     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login)
);

CREATE TABLE IF NOT EXISTS commit_analyses (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  author_email    TEXT,
  repo            TEXT    NOT NULL,
  commit_sha      TEXT    NOT NULL,
  pr_number       INTEGER,
  pr_title        TEXT,
  commit_message  TEXT,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  complexity      INTEGER,
  type            TEXT CHECK(type IN ('feature','bug','refactor','infra','docs','test','other')),
  impact_summary  TEXT,
  risk_level      TEXT CHECK(risk_level IN ('low','medium','high')),
  ai_co_authored  INTEGER NOT NULL DEFAULT 0,
  ai_tool_name    TEXT,
  maybe_ai        INTEGER NOT NULL DEFAULT 0,
  committed_at    TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, commit_sha)
);

CREATE TABLE IF NOT EXISTS jira_issues (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id                 TEXT    NOT NULL,
  github_login              TEXT    NOT NULL,
  jira_account_id           TEXT,
  jira_email                TEXT,
  project_key               TEXT    NOT NULL,
  issue_key                 TEXT    NOT NULL,
  issue_type                TEXT,
  summary                   TEXT,
  description               TEXT,
  status                    TEXT,
  labels                    TEXT,
  story_points              REAL,
  original_estimate_seconds INTEGER,
  issue_url                 TEXT,
  created_at                TEXT,
  resolved_at               TEXT,
  complexity                INTEGER,
  type                      TEXT CHECK(type IN ('feature','bug','refactor','infra','docs','test','other')),
  impact_summary            TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, issue_key)
);

CREATE TABLE IF NOT EXISTS user_mappings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  org             TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  jira_account_id TEXT    NOT NULL,
  jira_email      TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (org, github_login)
);

CREATE TABLE IF NOT EXISTS developer_summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  summary_text    TEXT    NOT NULL,
  badges_json     TEXT,
  generated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login)
);

CREATE TABLE IF NOT EXISTS report_comparisons (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id_a     TEXT    NOT NULL,
  report_id_b     TEXT    NOT NULL,
  highlights_json TEXT    NOT NULL,
  generated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (report_id_a) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (report_id_b) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id_a, report_id_b)
);

CREATE TABLE IF NOT EXISTS schedules (
  id             TEXT    NOT NULL PRIMARY KEY,
  org            TEXT    NOT NULL,
  period_days    INTEGER NOT NULL,
  cron_expr      TEXT    NOT NULL,
  timezone       TEXT    NOT NULL DEFAULT 'UTC',
  enabled        INTEGER NOT NULL DEFAULT 1,
  test_mode      INTEGER NOT NULL DEFAULT 0,
  last_run_at    TEXT,
  last_report_id TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (last_report_id) REFERENCES reports(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT    NOT NULL PRIMARY KEY,
  org         TEXT    NOT NULL,
  name        TEXT    NOT NULL,
  color       TEXT    NOT NULL DEFAULT '#3B82F6',
  created_at  TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (org, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id      TEXT    NOT NULL,
  github_login TEXT    NOT NULL,
  added_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE (team_id, github_login)
);

CREATE TABLE IF NOT EXISTS jira_projects (
  id            TEXT NOT NULL PRIMARY KEY,
  org           TEXT NOT NULL,
  project_key   TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  active_status TEXT NOT NULL,
  middle_status TEXT,
  hierarchy     TEXT NOT NULL DEFAULT 'goal-initiative',
  position      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (org, project_key)
);

CREATE TABLE IF NOT EXISTS epic_summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_key        TEXT    NOT NULL,
  org             TEXT    NOT NULL,
  summary_text    TEXT    NOT NULL,
  jira_resolved   INTEGER NOT NULL DEFAULT 0,
  jira_remaining  INTEGER NOT NULL DEFAULT 0,
  commit_count    INTEGER NOT NULL DEFAULT 0,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  repos           TEXT,
  generated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (epic_key, org)
);

CREATE TABLE IF NOT EXISTS untracked_summaries (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  team_name       TEXT    NOT NULL,
  org             TEXT    NOT NULL,
  groups_json     TEXT    NOT NULL,
  total_commits   INTEGER NOT NULL DEFAULT 0,
  generated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (team_name, org)
);

CREATE TABLE IF NOT EXISTS epic_stats (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  epic_key        TEXT    NOT NULL,
  org             TEXT    NOT NULL,
  total_jiras     INTEGER NOT NULL DEFAULT 0,
  resolved_jiras  INTEGER NOT NULL DEFAULT 0,
  remaining_jiras INTEGER NOT NULL DEFAULT 0,
  commit_count    INTEGER NOT NULL DEFAULT 0,
  dev_count       INTEGER NOT NULL DEFAULT 0,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  repos           TEXT,
  generated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (epic_key, org)
);

CREATE TABLE IF NOT EXISTS release_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  latest_commit_sha TEXT    NOT NULL,
  summary         TEXT    NOT NULL,
  commit_count    INTEGER NOT NULL DEFAULT 0,
  generated_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (latest_commit_sha)
);

CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id    TEXT    NOT NULL,
  team_name    TEXT    NOT NULL,
  org          TEXT    NOT NULL,
  summary_text TEXT    NOT NULL,
  health_json  TEXT    NOT NULL,
  projects     TEXT,
  prompt_version TEXT  NOT NULL DEFAULT 'v1',
  generated_at TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, team_name)
);

CREATE TABLE IF NOT EXISTS unmerged_prs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  repo            TEXT    NOT NULL,
  pr_number       INTEGER NOT NULL,
  pr_title        TEXT,
  pr_url          TEXT,
  is_draft        INTEGER,
  pr_commits      INTEGER,
  pr_additions    INTEGER,
  pr_deletions    INTEGER,
  pr_created_at   TEXT,
  pr_updated_at   TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, repo, pr_number)
);

CREATE TABLE IF NOT EXISTS unmerged_commits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  repo            TEXT    NOT NULL,
  branch          TEXT,
  pr_number       INTEGER,
  commit_sha      TEXT    NOT NULL,
  commit_message  TEXT,
  lines_added     INTEGER NOT NULL DEFAULT 0,
  lines_removed   INTEGER NOT NULL DEFAULT 0,
  committed_at    TEXT,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, repo, commit_sha)
);

CREATE TABLE IF NOT EXISTS cc_skills_usage (
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  product         TEXT    NOT NULL,
  skills_used     INTEGER NOT NULL DEFAULT 0,
  skills_distinct INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login, product)
);

CREATE TABLE IF NOT EXISTS cc_model_usage (
  report_id    TEXT    NOT NULL,
  github_login TEXT    NOT NULL,
  model        TEXT    NOT NULL,
  cost         REAL    NOT NULL DEFAULT 0,
  requests     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login, model)
);

CREATE INDEX IF NOT EXISTS idx_devstats_login ON developer_stats(github_login);
CREATE INDEX IF NOT EXISTS idx_reports_org_status_created ON reports(org, status, created_at);
`;

export function createSQLiteDB(): DB {
  const dbPath = process.env.SQLITE_PATH || path.join(process.cwd(), 'glooker.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  db.exec('DROP TABLE IF EXISTS unmerged_work');

  // Migrations: safe for existing DBs (ignore "duplicate column" errors)
  try { db.exec('ALTER TABLE developer_stats ADD COLUMN total_jira_issues INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
  try { db.exec('ALTER TABLE commit_analyses ADD COLUMN author_email TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE developer_stats ADD COLUMN total_reviews INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
  // cc-spend migration: drop tokens+sessions columns (replaced by single requests count),
  // ensure cc_total_cost + cc_requests columns exist.
  try { db.exec('ALTER TABLE developer_stats DROP COLUMN cc_input_tokens'); } catch (_) {}
  try { db.exec('ALTER TABLE developer_stats DROP COLUMN cc_output_tokens'); } catch (_) {}
  try { db.exec('ALTER TABLE developer_stats DROP COLUMN cc_sessions'); } catch (_) {}
  try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_total_cost REAL NOT NULL DEFAULT 0'); } catch (_) {}
  try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_requests INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
  // GLOOK-30: rollup so existing per-developer tooling picks up a headline
  // "skills invoked" number without special-casing. Breakdown lives in cc_skills_usage.
  try { db.exec('ALTER TABLE developer_stats ADD COLUMN cc_skills_used INTEGER NOT NULL DEFAULT 0'); } catch (_) {}
  try { db.exec('ALTER TABLE reports ADD COLUMN cc_period_start TEXT'); } catch (_) {}
  try { db.exec('ALTER TABLE reports ADD COLUMN cc_period_end TEXT'); } catch (_) {}
  try { db.exec("ALTER TABLE team_pulse_summaries ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'v1'"); } catch (_) {}
  // GLOOK-11: add projects column for per-team Current Projects card
  try { db.exec('ALTER TABLE team_pulse_summaries ADD COLUMN projects TEXT'); } catch (_) {}
  // GLOOK-13: report integrity (run_metadata column + skip-allowlist table)
  try { db.exec('ALTER TABLE reports ADD COLUMN run_metadata TEXT'); } catch (_) {}
  // GLOOK-38: per-team board config lives in the jira_projects table (see
  // CREATE TABLE above). `teams.board_config` never existed outside this
  // branch — no DROP is needed.
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS report_skip_allowlist (
      github_login  TEXT NOT NULL PRIMARY KEY,
      reason        TEXT NOT NULL,
      added_by      TEXT,
      added_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    )`);
  } catch (_) {}
  try {
    db.exec(`INSERT OR IGNORE INTO report_skip_allowlist (github_login, reason, added_by)
             VALUES ('oshpak', 'Private GitHub profile; not in org-visible members for non-mutual permissions', 'seed')`);
  } catch (_) {}

  const dbApi: DB = {
    execute: <T = any>(sql: string, params?: any[]): Promise<[T[], any]> => {
      const translated = translateSQL(sql);
      const normalizedParams = (params || []).map((p) =>
        p === undefined ? null : p
      );

      try {
        const stmt = db.prepare(translated);
        // Route by the prepared statement's own `.reader` flag rather than
        // regex-matching SQL keywords: correct for every SELECT/SHOW/PRAGMA
        // form (including setter-only pragmas like `PRAGMA foreign_keys = ON`,
        // which have `.reader === false` and would throw if run through
        // `.all()`) and any future statement type, without hand-maintaining
        // a keyword allowlist.
        if (stmt.reader) {
          const rows = stmt.all(...normalizedParams) as T[];
          return Promise.resolve([rows, null]);
        } else {
          // Match the mysql2/promise shape for non-SELECT queries: the first
          // element of the tuple is a ResultSetHeader-like object (not an
          // array of rows). Callers do `const [r] = await db.execute(...)`
          // followed by `r.affectedRows`, which only works if `r` is the
          // header object directly. Wrapping it in `[{...}]` was a pre-existing
          // bug that silently broke matched-count logic in apply.ts and
          // affectedRows checks in report/service.ts under SQLite.
          const result = stmt.run(...normalizedParams);
          return Promise.resolve([
            { affectedRows: result.changes, insertId: result.lastInsertRowid } as any,
            null,
          ]);
        }
      } catch (err) {
        return Promise.reject(err);
      }
    },
    transaction: async <T>(fn: (tx: DB) => Promise<T>): Promise<T> => {
      // better-sqlite3 is synchronous and serializes queries; using async fn
      // here is safe because the underlying handle is single-threaded.
      db.exec('BEGIN');
      try {
        const result = await fn(dbApi);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    },
  };
  return dbApi;
}

/**
 * Apply `fn` only to the parts of `sql` that sit OUTSIDE single-quoted string
 * literals, leaving literal contents byte-for-byte intact.
 *
 * Every rule in translateSQL is a regex over raw SQL text, and several of them
 * inject quote characters. Without this, a literal whose contents happen to look
 * like MySQL syntax gets rewritten, and the injected quotes terminate the literal
 * and restructure the statement. Anchoring the patterns narrows that but does not
 * close it — `'DATE_ADD(a , INTERVAL 9 DAY)'` still matches an identifier capture.
 *
 * SQLite escapes a quote inside a literal by doubling it ('').
 */
function outsideStringLiterals(sql: string, fn: (chunk: string) => string): string {
  const parts: string[] = [];
  let i = 0;
  let chunkStart = 0;

  while (i < sql.length) {
    if (sql[i] !== "'") { i++; continue; }

    parts.push(fn(sql.slice(chunkStart, i)));

    let j = i + 1;
    while (j < sql.length) {
      if (sql[j] === "'") {
        if (sql[j + 1] === "'") { j += 2; continue; } // escaped quote, keep scanning
        break;
      }
      j++;
    }
    const end = Math.min(j + 1, sql.length);
    parts.push(sql.slice(i, end)); // literal, verbatim
    i = chunkStart = end;
  }

  parts.push(fn(sql.slice(chunkStart)));
  return parts.join('');
}

export function translateSQL(sql: string): string {
  // Token-level rewrites, applied only outside string literals.
  let s = outsideStringLiterals(sql, (chunk) => {
    let c = chunk;

    // INSERT IGNORE → INSERT OR IGNORE
    c = c.replace(/INSERT\s+IGNORE\s+INTO/gi, 'INSERT OR IGNORE INTO');

    // NOW() → datetime('now','localtime')
    c = c.replace(/NOW\(\)/gi, "datetime('now','localtime')");

    // LEFT(col, N) → SUBSTR(col, 1, N)
    c = c.replace(/LEFT\s*\(([^,]+),\s*(\d+)\)/gi, 'SUBSTR($1, 1, $2)');

    // DATE_SUB(NOW(), INTERVAL N DAY) → datetime('now', 'localtime', '-N days')
    // `localtime` is required: NOW() became datetime('now','localtime') just above,
    // so omitting it makes NOW() and DATE_SUB(NOW(), …) disagree by the host's UTC
    // offset — a silent window shift on any non-UTC host. Six callers rely on this
    // (projects/untracked.ts, projects/epic-stats.ts, projects/epic-summary.ts).
    c = c.replace(/DATE_SUB\s*\(\s*datetime\('now','localtime'\)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi,
      (_m, days) => `datetime('now', 'localtime', '-${days} days')`);

    // DATE_SUB / DATE_ADD (<bound param or column>, INTERVAL N DAY)
    // Anchored to `?` or a bare identifier: the expression is spliced through
    // verbatim, so a bound `?` stays a bound parameter and the rewrite introduces
    // no new placeholders (no positional-parameter shift).
    c = c.replace(/DATE_SUB\s*\(\s*(\?|[A-Za-z_][A-Za-z0-9_.]*)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi,
      (_m, expr, days) => `datetime(${expr}, '-${days} days')`);
    c = c.replace(/DATE_ADD\s*\(\s*(\?|[A-Za-z_][A-Za-z0-9_.]*)\s*,\s*INTERVAL\s+(\d+)\s+DAY\s*\)/gi,
      (_m, expr, days) => `datetime(${expr}, '+${days} days')`);

    // No DATE_ADD(NOW(), …) rule on purpose: nothing in the codebase writes that
    // shape, and an unexercised rule is exactly where the localtime skew hid. The
    // guard below makes the omission loud rather than silently wrong.
    return c;
  });

  // Guard against the passthrough default. translateSQL is a whitelist rewriter:
  // anything unmatched previously reached better-sqlite3 verbatim and failed at
  // request time (GLOOK-41 surfaced as `near "1": syntax error`). Mocked suites
  // never call this function, so such gaps stayed green in CI and were found by
  // users. Fail loudly instead — and mysql-date-expressions.test.ts turns any new
  // offender into a CI failure. Only non-literal text is inspected, so SQL stored
  // as data cannot trip it.
  // ON DUPLICATE KEY UPDATE ... VALUES(col) → ON CONFLICT(...) DO UPDATE SET col = excluded.col
  const odkuMatch = s.match(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]+)$/i);
  if (odkuMatch) {
    // Find the UNIQUE constraint columns from the INSERT column list
    const insertColsMatch = s.match(/INSERT\s+INTO\s+(\w+)\s*\(([^)]+)\)/i);
    const table = insertColsMatch?.[1] || '';

    // Map table → conflict columns (from our schema)
    const conflictCols: Record<string, string> = {
      developer_stats: 'report_id, github_login',
      commit_analyses: 'report_id, commit_sha',
      developer_summaries: 'report_id, github_login',
      report_comparisons: 'report_id_a, report_id_b',
      teams: 'org, name',
      team_members: 'team_id, github_login',
      jira_issues: 'report_id, issue_key',
      user_mappings: 'org, github_login',
      epic_summaries: 'epic_key, org',
      untracked_summaries: 'team_name, org',
      release_notes: 'latest_commit_sha',
      team_pulse_summaries: 'report_id, team_name',
      unmerged_prs: 'report_id, repo, pr_number',
      unmerged_commits: 'report_id, repo, commit_sha',
      report_skip_allowlist: 'github_login',
    };
    const conflict = conflictCols[table] || 'id';

    // Transform VALUES(col) → excluded.col
    let updateClause = odkuMatch[1]
      .replace(/VALUES\((\w+)\)/gi, 'excluded.$1');

    s = s.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE\s+[\s\S]+$/i,
      `ON CONFLICT(${conflict}) DO UPDATE SET ${updateClause}`);
  }

  // translateSQL is a whitelist rewriter with a passthrough default: anything it does
  // not match reaches better-sqlite3 verbatim and fails at request time with a
  // token-level parse error (GLOOK-41 was exactly this — `near "1": syntax error`).
  // Mocked test suites never call this function, so such gaps stay green in CI and are
  // found by users. Fail loudly here instead: a thrown error names the statement and is
  // greppable, and `mysql-date-expressions.test.ts` turns any new offender into a CI
  // failure rather than a production 500.
  // Only non-literal text is inspected — SQL-looking text stored as data (a commit
  // message, a Jira summary) must not be able to trip this. Reuses the same
  // tokenizer as the rewrites, so "what counts as a literal" has one definition.
  let nonLiteral = '';
  outsideStringLiterals(s, (chunk) => { nonLiteral += ` ${chunk} `; return chunk; });
  if (/\bDATE_ADD\b|\bDATE_SUB\b|\bINTERVAL\b/i.test(nonLiteral)) {
    throw new Error(
      `translateSQL: untranslated MySQL date expression reached the SQLite driver. ` +
      `Add a rule to translateSQL() in src/lib/db/sqlite.ts. SQL: ${sql}`,
    );
  }

  return s;
}
