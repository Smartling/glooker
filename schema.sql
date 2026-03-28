CREATE DATABASE IF NOT EXISTS glooker;
USE glooker;

CREATE TABLE IF NOT EXISTS reports (
  id           VARCHAR(36)  NOT NULL PRIMARY KEY,
  org          VARCHAR(255) NOT NULL,
  period_days  INT          NOT NULL,
  status       ENUM('pending','running','completed','failed','stopped') NOT NULL DEFAULT 'pending',
  error        TEXT         NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP    NULL
);

CREATE TABLE IF NOT EXISTS developer_stats (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)    NOT NULL,
  github_login    VARCHAR(255)   NOT NULL,
  github_name     VARCHAR(255)   NULL,
  avatar_url      VARCHAR(500)   NULL,
  total_prs       INT            NOT NULL DEFAULT 0,
  total_commits   INT            NOT NULL DEFAULT 0,
  lines_added     INT            NOT NULL DEFAULT 0,
  lines_removed   INT            NOT NULL DEFAULT 0,
  avg_complexity  DECIMAL(4,2)   NULL,
  impact_score    DECIMAL(4,2)   NULL,
  pr_percentage   INT            NOT NULL DEFAULT 0,
  ai_percentage   INT            NOT NULL DEFAULT 0,
  total_jira_issues INT          NOT NULL DEFAULT 0,
  type_breakdown  JSON           NULL,
  active_repos    JSON           NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_dev (report_id, github_login)
);

CREATE TABLE IF NOT EXISTS commit_analyses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  author_email    VARCHAR(255) NULL,
  repo            VARCHAR(255) NOT NULL,
  commit_sha      VARCHAR(40)  NOT NULL,
  pr_number       INT          NULL,
  pr_title        VARCHAR(500) NULL,
  commit_message  TEXT         NULL,
  lines_added     INT          NOT NULL DEFAULT 0,
  lines_removed   INT          NOT NULL DEFAULT 0,
  complexity      TINYINT      NULL,
  type            ENUM('feature','bug','refactor','infra','docs','test','other') NULL,
  impact_summary  TEXT         NULL,
  risk_level      ENUM('low','medium','high') NULL,
  ai_co_authored  TINYINT(1)   NOT NULL DEFAULT 0,
  ai_tool_name    VARCHAR(50)  NULL,
  maybe_ai        TINYINT(1)   NOT NULL DEFAULT 0,
  committed_at    TIMESTAMP    NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_commit (report_id, commit_sha)
);

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

CREATE TABLE IF NOT EXISTS user_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org             VARCHAR(255) NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  jira_email      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_gh_login (org, github_login)
);

CREATE TABLE IF NOT EXISTS report_comparisons (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id_a     VARCHAR(36)  NOT NULL,
  report_id_b     VARCHAR(36)  NOT NULL,
  highlights_json JSON         NOT NULL,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id_a) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (report_id_b) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_pair (report_id_a, report_id_b)
);

CREATE TABLE IF NOT EXISTS developer_summaries (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  summary_text    TEXT         NOT NULL,
  badges_json     JSON         NULL,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_dev_summary (report_id, github_login)
);

CREATE TABLE IF NOT EXISTS teams (
  id          VARCHAR(36)  NOT NULL PRIMARY KEY,
  org         VARCHAR(255) NOT NULL,
  name        VARCHAR(255) NOT NULL,
  color       VARCHAR(7)   NOT NULL DEFAULT '#3B82F6',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_team (org, name)
);

CREATE TABLE IF NOT EXISTS team_members (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  team_id     VARCHAR(36)  NOT NULL,
  github_login VARCHAR(255) NOT NULL,
  added_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  UNIQUE KEY uq_team_member (team_id, github_login)
);

CREATE TABLE IF NOT EXISTS release_notes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  latest_commit_sha VARCHAR(40) NOT NULL,
  summary         TEXT         NOT NULL,
  commit_count    INT          NOT NULL DEFAULT 0,
  generated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_commit_sha (latest_commit_sha)
);

CREATE INDEX idx_devstats_login ON developer_stats(github_login);
CREATE INDEX idx_reports_org_status_created ON reports(org, status, created_at);
