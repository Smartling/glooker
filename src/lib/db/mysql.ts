import mysql from 'mysql2/promise';
import type { DB } from './index';

const JIRA_SCHEMA = `
CREATE TABLE IF NOT EXISTS jira_issues (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  report_id                 VARCHAR(36)  NOT NULL,
  github_login              VARCHAR(255) NOT NULL,
  jira_account_id           VARCHAR(128) NULL,
  jira_email                VARCHAR(255) NULL,
  project_key               VARCHAR(50)  NOT NULL,
  issue_key                 VARCHAR(50)  NOT NULL,
  issue_type                VARCHAR(100) NULL,
  summary                   VARCHAR(500) NULL,
  description               TEXT         NULL,
  status                    VARCHAR(100) NULL,
  labels                    TEXT         NULL,
  story_points              DECIMAL(6,2) NULL,
  original_estimate_seconds INT          NULL,
  issue_url                 VARCHAR(500) NULL,
  created_at                TIMESTAMP    NULL,
  resolved_at               TIMESTAMP    NULL,
  complexity                TINYINT      NULL,
  type                      ENUM('feature','bug','refactor','infra','docs','test','other') NULL,
  impact_summary            TEXT         NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_issue (report_id, issue_key)
);
`;

const USER_MAPPINGS_SCHEMA = `
CREATE TABLE IF NOT EXISTS user_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org             VARCHAR(255) NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  jira_email      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_gh_login (org, github_login)
);
`;

const SCHEDULES_SCHEMA = `
CREATE TABLE IF NOT EXISTS schedules (
  id             VARCHAR(36)  NOT NULL PRIMARY KEY,
  org            VARCHAR(255) NOT NULL,
  period_days    INT          NOT NULL,
  cron_expr      VARCHAR(100) NOT NULL,
  timezone       VARCHAR(50)  NOT NULL DEFAULT 'UTC',
  enabled        TINYINT      NOT NULL DEFAULT 1,
  test_mode      TINYINT      NOT NULL DEFAULT 0,
  last_run_at    DATETIME,
  last_report_id VARCHAR(36),
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (last_report_id) REFERENCES reports(id) ON DELETE SET NULL
);
`;

const EPIC_SUMMARIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS epic_summaries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  epic_key        VARCHAR(20)  NOT NULL,
  org             VARCHAR(255) NOT NULL,
  summary_text    TEXT         NOT NULL,
  jira_resolved   INT          NOT NULL DEFAULT 0,
  jira_remaining  INT          NOT NULL DEFAULT 0,
  commit_count    INT          NOT NULL DEFAULT 0,
  lines_added     INT          NOT NULL DEFAULT 0,
  lines_removed   INT          NOT NULL DEFAULT 0,
  repos           TEXT         NULL,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_epic_org (epic_key, org)
);
`;

const UNTRACKED_SUMMARIES_SCHEMA = `
CREATE TABLE IF NOT EXISTS untracked_summaries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  team_name       VARCHAR(255) NOT NULL,
  org             VARCHAR(255) NOT NULL,
  groups_json     MEDIUMTEXT   NOT NULL,
  total_commits   INT          NOT NULL DEFAULT 0,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_team_org (team_name, org)
);
`;

const EPIC_STATS_SCHEMA = `
CREATE TABLE IF NOT EXISTS epic_stats (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  epic_key        VARCHAR(20)  NOT NULL,
  org             VARCHAR(255) NOT NULL,
  total_jiras     INT          NOT NULL DEFAULT 0,
  resolved_jiras  INT          NOT NULL DEFAULT 0,
  remaining_jiras INT          NOT NULL DEFAULT 0,
  commit_count    INT          NOT NULL DEFAULT 0,
  dev_count       INT          NOT NULL DEFAULT 0,
  lines_added     INT          NOT NULL DEFAULT 0,
  lines_removed   INT          NOT NULL DEFAULT 0,
  repos           TEXT         NULL,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_epic_stats_org (epic_key, org)
);
`;

const TEAM_PULSE_SCHEMA = `
CREATE TABLE IF NOT EXISTS team_pulse_summaries (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  report_id    VARCHAR(36)  NOT NULL,
  team_name    VARCHAR(255) NOT NULL,
  org          VARCHAR(255) NOT NULL,
  summary_text TEXT         NOT NULL,
  health_json  TEXT         NOT NULL,
  projects     JSON         NULL,
  generated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_team_pulse (report_id, team_name)
);
`;

const UNMERGED_PRS_SCHEMA = `
CREATE TABLE IF NOT EXISTS unmerged_prs (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  repo            VARCHAR(255) NOT NULL,
  pr_number       INT          NOT NULL,
  pr_title        VARCHAR(500) NULL,
  pr_url          VARCHAR(500) NULL,
  is_draft        BOOLEAN      NULL,
  pr_commits      INT          NULL,
  pr_additions    INT          NULL,
  pr_deletions    INT          NULL,
  pr_created_at   TIMESTAMP    NULL,
  pr_updated_at   TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_unmerged_pr (report_id, repo, pr_number)
);
`;

const UNMERGED_COMMITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS unmerged_commits (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  repo            VARCHAR(255) NOT NULL,
  branch          VARCHAR(255) NULL,
  pr_number       INT          NULL,
  commit_sha      VARCHAR(40)  NOT NULL,
  commit_message  TEXT         NULL,
  lines_added     INT          NOT NULL DEFAULT 0,
  lines_removed   INT          NOT NULL DEFAULT 0,
  committed_at    TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_unmerged_commit (report_id, repo, commit_sha)
);
`;

// Neither table pins a charset, and neither may: MySQL rejects a foreign key
// whose string column differs in charset/collation from the column it
// references (ER_FK_INCOMPATIBLE_COLUMNS, errno 3780). `reports.id` inherits
// the database's default charset, as does every other table here, so these
// must inherit it too. An explicit `DEFAULT CHARSET=utf8mb4` looks harmless
// and is silently fine on a utf8mb4 database — but on the older utf8mb3
// database in dev it made CREATE TABLE fail, and since the failure is caught
// and logged rather than thrown, the tables were simply absent until the org
// report queried them and 500'd. Verified by reproduction: same DDL against a
// utf8mb3 schema errors 3780; without the clause it creates and matches.
const CC_SKILLS_USAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS cc_skills_usage (
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  -- 191 (not 64): extractSkillsEntries builds this as the full dotted walk
  -- path (office.excel, deeper if Anthropic nests further) and is deliberately
  -- unbounded so a new product bucket needs no code change. 191 is the
  -- largest VARCHAR length still safely indexable under utf8mb4's 767-byte
  -- limit alongside this table's other UNIQUE KEY columns. SQLite's product
  -- column is TEXT (no cap) — see skills-parser.ts for the shared-behavior
  -- truncation guard that keeps the two backends from diverging beyond this.
  product         VARCHAR(191) NOT NULL,
  skills_used     INT          NOT NULL DEFAULT 0,
  skills_distinct INT          NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_cc_skills (report_id, github_login, product),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
)`;

const CC_MODEL_USAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS cc_model_usage (
  report_id    VARCHAR(36)   NOT NULL,
  github_login VARCHAR(255)  NOT NULL,
  model        VARCHAR(128)  NOT NULL,
  cost         DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  requests     BIGINT        NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_cc_model (report_id, github_login, model),
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
)`;

export function createMySQLDB(): DB {
  const pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'glooker',
    waitForConnections: true,
    connectionLimit:    10,
    // Parse DATETIME/TIMESTAMP columns as UTC instead of the JS engine's
    // local TZ. Without this, callers that do `new Date(row.created_at)`
    // followed by `.toISOString().slice(0,10)` get period boundaries that
    // drift by a day under non-UTC container TZs — the same report
    // refreshed in two different timezones would produce different
    // periodStart/periodEnd values for downstream API pulls.
    timezone: 'Z',
  });

  // Schema creation + migrations run sequentially to avoid InnoDB deadlocks
  // when multiple ALTER TABLE statements target the same table concurrently.
  //
  // The `ready` promise gates all queries until migrations complete. Without
  // this, createMySQLDB would return a DB object while ALTER TABLE statements
  // were still in flight, allowing the first pool.execute from any module
  // imported at startup (report-runner, applyCcSpend, etc.) to race against
  // migration writes. Cross-replica safety (e.g. GET_LOCK advisory locks) is
  // intentionally deferred — Glooker today runs single-replica via
  // docker-compose, so this in-process gate is sufficient. Revisit when/if
  // horizontal scaling lands.
  const ready: Promise<void> = (async () => {
  await pool.execute(SCHEDULES_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create schedules table:', err);
  });
  await pool.execute(JIRA_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create jira_issues table:', err);
  });
  await pool.execute(USER_MAPPINGS_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create user_mappings table:', err);
  });
  await pool.execute(EPIC_SUMMARIES_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create epic_summaries table:', err);
  });
  await pool.execute(UNTRACKED_SUMMARIES_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create untracked_summaries table:', err);
  });
  await pool.execute(EPIC_STATS_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create epic_stats table:', err);
  });
  await pool.execute(TEAM_PULSE_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create team_pulse_summaries table:', err);
  });
  await pool.execute(UNMERGED_PRS_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create unmerged_prs table:', err);
  });
  await pool.execute(UNMERGED_COMMITS_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create unmerged_commits table:', err);
  });
  await pool.execute(CC_SKILLS_USAGE_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create cc_skills_usage table:', err);
  });
  await pool.execute(CC_MODEL_USAGE_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create cc_model_usage table:', err);
  });
  await pool.execute('DROP TABLE IF EXISTS unmerged_work').catch((err) => {
    console.error('[db/mysql] Failed to drop unmerged_work table:', err);
  });

  // Migrations
  await pool.execute('ALTER TABLE developer_stats ADD COLUMN total_jira_issues INT NOT NULL DEFAULT 0').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add total_jira_issues:', err);
  });
  await pool.execute('ALTER TABLE commit_analyses ADD COLUMN author_email VARCHAR(255) NULL AFTER github_login').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add author_email:', err);
  });
  await pool.execute('ALTER TABLE untracked_summaries MODIFY COLUMN groups_json MEDIUMTEXT NOT NULL').catch(() => {});
  await pool.execute('ALTER TABLE developer_stats ADD COLUMN total_reviews INT NOT NULL DEFAULT 0').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add total_reviews:', err);
  });
  await pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_total_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_total_cost:', err);
  });
  // cc-spend migration: drop tokens+sessions columns (replaced by single requests count).
  // ER_CANT_DROP_FIELD_OR_KEY (1091) means the column is already gone — ignore.
  await pool.execute('ALTER TABLE developer_stats DROP COLUMN cc_input_tokens').catch((err) => {
    if (err.errno !== 1091 && err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') console.error('[db/mysql] Failed to drop cc_input_tokens:', err);
  });
  await pool.execute('ALTER TABLE developer_stats DROP COLUMN cc_output_tokens').catch((err) => {
    if (err.errno !== 1091 && err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') console.error('[db/mysql] Failed to drop cc_output_tokens:', err);
  });
  await pool.execute('ALTER TABLE developer_stats DROP COLUMN cc_sessions').catch((err) => {
    if (err.errno !== 1091 && err.code !== 'ER_CANT_DROP_FIELD_OR_KEY') console.error('[db/mysql] Failed to drop cc_sessions:', err);
  });
  await pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_requests BIGINT NOT NULL DEFAULT 0').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_requests:', err);
  });
  await pool.execute('ALTER TABLE developer_stats ADD COLUMN cc_skills_used INT NOT NULL DEFAULT 0').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_skills_used:', err);
  });
  // Widen cc_skills_usage.product 64->191 for databases created before this
  // migration existed; CREATE TABLE IF NOT EXISTS above only sizes it
  // correctly for brand-new databases. See CC_SKILLS_USAGE_SCHEMA's comment.
  await pool.execute('ALTER TABLE cc_skills_usage MODIFY COLUMN product VARCHAR(191) NOT NULL').catch((err) => {
    console.error('[db/mysql] Failed to widen cc_skills_usage.product:', err);
  });
  await pool.execute('ALTER TABLE reports ADD COLUMN cc_period_start DATE NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_period_start:', err);
  });
  await pool.execute('ALTER TABLE reports ADD COLUMN cc_period_end DATE NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add cc_period_end:', err);
  });
  await pool.execute("ALTER TABLE team_pulse_summaries ADD COLUMN prompt_version VARCHAR(16) NOT NULL DEFAULT 'v1'").catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add prompt_version:', err);
  });
  // GLOOK-11: add projects column for per-team Current Projects card
  await pool.execute('ALTER TABLE team_pulse_summaries ADD COLUMN projects JSON NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add projects:', err);
  });
  // GLOOK-13: report integrity (run_metadata column + skip-allowlist table)
  await pool.execute('ALTER TABLE reports ADD COLUMN run_metadata JSON NULL').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add run_metadata:', err);
  });
  // GLOOK-38: board config moved from teams to the jira_projects table
  await pool.execute('ALTER TABLE teams DROP COLUMN board_config').catch(() => {});
  await pool.execute(`CREATE TABLE IF NOT EXISTS jira_projects (
    id            VARCHAR(36)  NOT NULL PRIMARY KEY,
    org           VARCHAR(255) NOT NULL,
    project_key   VARCHAR(64)  NOT NULL,
    display_name  VARCHAR(255) NOT NULL,
    active_status VARCHAR(255) NOT NULL,
    middle_status VARCHAR(255) NULL,
    hierarchy     VARCHAR(32)  NOT NULL DEFAULT 'goal-initiative',
    position      INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_org_project (org, project_key)
  )`).catch((err) => {
    console.error('[db/mysql] Failed to create jira_projects:', err);
  });
  await pool.execute(`CREATE TABLE IF NOT EXISTS report_skip_allowlist (
    github_login  VARCHAR(255) NOT NULL PRIMARY KEY,
    reason        TEXT         NOT NULL,
    added_by      VARCHAR(255) NULL,
    added_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`).catch((err) => {
    console.error('[db/mysql] Failed to create report_skip_allowlist:', err);
  });
  await pool.execute(
    `INSERT IGNORE INTO report_skip_allowlist (github_login, reason, added_by) VALUES (?, ?, ?)`,
    ['oshpak', 'Private GitHub profile; not in org-visible members for non-mutual permissions', 'seed'],
  ).catch(() => {});
  })();

  return {
    execute: async <T = any>(sql: string, params?: any[]): Promise<[T[], any]> => {
      await ready;
      return pool.execute(sql, params) as Promise<[T[], any]>;
    },
    transaction: async <T>(fn: (tx: DB) => Promise<T>): Promise<T> => {
      await ready;
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const txDb: DB = {
          execute: async <U = any>(sql: string, params?: any[]): Promise<[U[], any]> => {
            return conn.execute(sql, params) as Promise<[U[], any]>;
          },
          transaction: async () => {
            throw new Error('Nested transactions are not supported');
          },
        };
        try {
          const result = await fn(txDb);
          await conn.commit();
          return result;
        } catch (err) {
          try { await conn.rollback(); } catch (_) {}
          throw err;
        }
      } finally {
        conn.release();
      }
    },
  };
}
