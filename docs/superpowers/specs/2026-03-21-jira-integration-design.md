# Jira Integration Design

**Date**: 2026-03-21
**Status**: Draft
**Branch**: jira-data

## Overview

Extend Glooker to collect Jira issue data alongside GitHub activity. For each developer in a report, discover their Jira account via commit author emails, fetch resolved issues for the report period, and display them in the UI. Impact score formula update is deferred — this phase focuses on data gathering, storage, and display.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Jira client library | `jira-client` (npm) | Supports both Cloud and Server, OO wrapper with `searchJira` and user search built in |
| User mapping strategy | Auto-discover via commit emails, persist to `user_mappings`, editable in Settings UI | Zero manual setup for most cases, editable table covers mismatches |
| "Done" detection | `statusCategory = "Done"` (JQL) | Works across all custom workflows without configuration |
| LLM analysis of Jira items | Deferred — schema supports it (nullable columns) but no analysis runs yet | Reduce scope; gather data first |
| Impact score update | Deferred — `total_jira_issues` stored but not used in formula yet | User will decide weighting later |
| Jira instance type | Abstract layer for Cloud (v3) and Server (v2); Cloud first | `jira-client` supports both via `apiVersion` config |
| Project scoping | All projects by default, optional `JIRA_PROJECTS` filter | Zero config to start, escape hatch for noisy instances |

## 1. Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `JIRA_ENABLED` | No | `false` | Enable Jira integration |
| `JIRA_HOST` | Yes (if enabled) | — | e.g., `mycompany.atlassian.net` |
| `JIRA_USERNAME` | Yes (if enabled) | — | Email for Cloud, username for Server |
| `JIRA_API_TOKEN` | Yes (if enabled) | — | API token (Cloud) or PAT (Server) |
| `JIRA_API_VERSION` | No | `3` | `3` for Cloud, `2` for Server |
| `JIRA_PROJECTS` | No | — | Optional comma-separated project key filter |

### App Config Service

Extend `src/lib/app-config/service.ts`:
- Add `jira` section to `AppConfig` type
- When `JIRA_ENABLED=true`, validate that `JIRA_HOST`, `JIRA_USERNAME`, `JIRA_API_TOKEN` are present
- Surface missing vars in the existing `ready` / missing-vars check

### Settings UI

Add "Jira" section to the Settings page:
- Toggle for `JIRA_ENABLED`
- Fields (visible when enabled): Host, Username, API Token (masked), API Version (dropdown: 2/3), Projects (optional comma-separated)
- "Test Connection" button — calls Jira `/myself` endpoint, shows success/failure inline

## 2. Database Schema

### New Table: `jira_issues`

```sql
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
  labels                    JSON         NULL,
  story_points              DECIMAL(6,2) NULL,
  original_estimate_seconds INT          NULL,
  issue_url                 VARCHAR(500) NULL,
  created_at                TIMESTAMP    NULL,
  resolved_at               TIMESTAMP    NULL,
  -- LLM fields (nullable, deferred)
  complexity                TINYINT      NULL,
  type                      ENUM('feature','bug','refactor','infra','docs','test','other') NULL,
  impact_summary            TEXT         NULL,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE KEY uq_report_issue (report_id, issue_key)
);
```

### New Table: `user_mappings`

```sql
CREATE TABLE IF NOT EXISTS user_mappings (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  org             VARCHAR(255) NOT NULL,
  github_login    VARCHAR(255) NOT NULL,
  jira_account_id VARCHAR(128) NOT NULL,
  jira_email      VARCHAR(255) NULL,
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_org_gh_login (org, github_login)
);
```

### Alter `developer_stats`

Add column: `total_jira_issues INT NOT NULL DEFAULT 0`

### SQLite Translation

Add to `conflictCols` in `src/lib/db/sqlite.ts`:
- `jira_issues: 'report_id, issue_key'`
- `user_mappings: 'org, github_login'`

## 3. Jira Service

### New File: `src/lib/jira.ts`

```
JiraClient class
├── constructor(host, username, apiToken, apiVersion)
│   └── Initializes jira-client (JiraApi) instance
├── testConnection(): Promise<JiraUser>
│   └── GET /myself — validates credentials
├── findUserByEmail(email: string): Promise<JiraUser | null>
│   └── GET /user/search?query={email}
│   └── Returns first match with matching emailAddress
├── searchDoneIssues(accountId, periodDays, projects?): Promise<JiraIssue[]>
│   └── Builds JQL, calls searchJira with pagination
│   └── Fetches all pages (50 per request)
└── buildJql(accountId, periodDays, projects?): string
    └── "assignee = {accountId} AND statusCategory = Done
         AND resolved >= -{days}d
         [AND project IN (P1, P2)]
         ORDER BY resolved DESC"
```

**JQL fields requested**: `summary, description, status, issuetype, labels, customfield_10016` (story points), `timeoriginalestimate, created, resolutiondate`

**Rate limiting**: 1s delay between Jira API calls.

## 4. User Mapping Flow

For each `github_login` during report generation:

1. **Check `user_mappings`** table for existing mapping (by org + github_login)
   - If found → use `jira_account_id`, proceed to issue fetch
2. **Auto-discover** (if no mapping):
   a. Collect unique commit author emails from `commit_analyses` for this user/report
   b. For each email, call `jira.findUserByEmail(email)`
   c. First match → **auto-persist** to `user_mappings` table (so next report skips API call)
3. **No match** → skip Jira data for this user, log warning

## 5. Pipeline Integration

Updated flow in `report-runner.ts`:

```
1. List org members
2. Per-member: fetch commits + PRs → LLM analysis → save commit_analyses
3. *Per-member: resolve Jira user (user_mappings → commit emails → Jira API)
4. *Per-member: fetch done Jira issues via JQL → save jira_issues
5. Per-member: aggregate (now includes total_jira_issues) → save developer_stats
6. Final aggregation
```

- Steps 3-4 **skipped entirely** if `JIRA_ENABLED !== true`
- Steps 3-4 run **after** commit analysis (need commit emails for mapping)
- If Jira mapping fails for a member → log warning, continue with GitHub-only data
- **Resume**: skip Jira fetch for users who already have `jira_issues` rows in this report
- **Progress**: add step messages like `"[3/25] Fetching Jira issues: @alice"`

## 6. API Endpoints

### New Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/report/[id]/jira-issues?login=...` | Jira issues for a developer in a report |
| `GET` | `/api/settings/user-mappings?org=...` | All mappings for an org (includes unmatched members) |
| `PUT` | `/api/settings/user-mappings` | Update a mapping (edit jira_email, resolve account) |
| `POST` | `/api/settings/jira/test-connection` | Test Jira credentials |

## 7. UI Changes

### Org Report Table (`/report/[id]/org`)

- Add **"Jira Issues"** column (after existing columns, before Impact)
- Shows issue count
- **Hover popover**: list of issue keys as clickable links to Jira, with summary text (same interaction pattern as commits)
- Column **hidden** if report has zero Jira data

### Developer Detail Page (`/report/[id]/dev/[login]`)

- Add **"Jira Issues"** section below the commits table
- Table columns: Issue Key (link to Jira), Type, Summary, Story Points, Labels, Resolved Date
- Sortable by resolved date (default), story points, type
- Rows expandable to show description (same expand pattern as commits)
- Section **not rendered** if no Jira data for this developer

### Settings Page

- **Jira Configuration** section: toggle, credential fields, test connection button
- **User Mappings** section (visible when `JIRA_ENABLED=true`):
  - Table showing **all org members** from latest report
  - Matched rows: GitHub Login, Jira Email (editable), Jira Account ID
  - Unmatched rows: GitHub Login, Jira Email (empty, editable)
  - Save triggers `findUserByEmail` to validate before persisting
  - No add/delete — rows driven by org membership

## 8. File Changes Summary

| File | Change |
|---|---|
| `src/lib/jira.ts` | **New** — Jira client abstraction |
| `src/lib/app-config/service.ts` | Add Jira config section + validation |
| `src/lib/report-runner.ts` | Add Jira user mapping + issue fetch steps |
| `src/lib/aggregator.ts` | Include `total_jira_issues` in aggregation |
| `src/lib/db/sqlite.ts` | Add `conflictCols` entries for new tables |
| `schema.sql` | Add `jira_issues`, `user_mappings` tables; alter `developer_stats` |
| `src/app/report/[id]/org/page.tsx` | Add Jira Issues column with hover popover |
| `src/app/report/[id]/dev/[login]/page.tsx` | Add Jira Issues section |
| `src/app/settings/page.tsx` | Add Jira config section + user mappings table |
| `src/app/api/report/[id]/jira-issues/route.ts` | **New** — Jira issues API |
| `src/app/api/settings/user-mappings/route.ts` | **New** — User mappings API |
| `src/app/api/settings/jira/test-connection/route.ts` | **New** — Test connection API |
| `.env.example` | Add Jira env vars |
| `package.json` | Add `jira-client` dependency |
