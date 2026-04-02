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

export function createMySQLDB(): DB {
  const pool = mysql.createPool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     Number(process.env.DB_PORT || 3306),
    user:     process.env.DB_USER     || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME     || 'glooker',
    waitForConnections: true,
    connectionLimit:    10,
  });

  // Auto-create schedules table if it doesn't exist
  pool.execute(SCHEDULES_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create schedules table:', err);
  });
  pool.execute(JIRA_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create jira_issues table:', err);
  });
  pool.execute(USER_MAPPINGS_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create user_mappings table:', err);
  });
  pool.execute(EPIC_SUMMARIES_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create epic_summaries table:', err);
  });
  pool.execute(UNTRACKED_SUMMARIES_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create untracked_summaries table:', err);
  });
  pool.execute(EPIC_STATS_SCHEMA).catch((err) => {
    console.error('[db/mysql] Failed to create epic_stats table:', err);
  });

  // Migrations
  pool.execute('ALTER TABLE developer_stats ADD COLUMN total_jira_issues INT NOT NULL DEFAULT 0').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add total_jira_issues:', err);
  });
  pool.execute('ALTER TABLE commit_analyses ADD COLUMN author_email VARCHAR(255) NULL AFTER github_login').catch((err) => {
    if (err.code !== 'ER_DUP_FIELDNAME') console.error('[db/mysql] Failed to add author_email:', err);
  });
  pool.execute('ALTER TABLE untracked_summaries MODIFY COLUMN groups_json MEDIUMTEXT NOT NULL').catch(() => {});

  return {
    execute: <T = any>(sql: string, params?: any[]): Promise<[T[], any]> =>
      pool.execute(sql, params) as Promise<[T[], any]>,
  };
}
