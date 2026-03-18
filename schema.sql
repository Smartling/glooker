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
  type_breakdown  JSON           NULL,
  active_repos    JSON           NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_dev (report_id, github_login)
);

CREATE TABLE IF NOT EXISTS commit_analyses (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  report_id       VARCHAR(36)  NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
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
