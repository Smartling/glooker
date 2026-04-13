# Claude Code Spend Analytics — Phase 1 Design

## Overview

Add Claude Code spend tracking to Glooker. Admins can see per-developer spend on the org report page (with Pareto analysis and outlier detection). Individual developers can see their own spend on their detail page. The feature is off by default and requires auth to be enabled.

This is Phase 1 — data ingestion, storage, and basic spend visibility. Phase 2 (future) covers budget limits, monthly projections, alerts, and the consolidated feature-toggle config class.

## Data Source

**Anthropic Claude Code Analytics API**

- Endpoint: `GET https://api.anthropic.com/v1/organizations/usage_report/claude_code`
- Auth: Admin API key (`sk-ant-admin...`) via `x-api-key` header, plus `anthropic-version: 2023-06-01`
- Returns all users' Claude Code usage for a single day, paginated (max 1000 per page)
- Per-user fields we consume: `actor.email_address`, `num_sessions`, per-model `tokens.input`, `tokens.output`, `tokens.cache_read`, `tokens.cache_creation`, `estimated_cost.amount` (cents USD)
- Daily granularity only, ~1 hour data delay
- Free to call, no rate limit concerns at our scale

We only ingest cost and session data. Productivity metrics (lines of code, commits, PRs from Claude Code's perspective) are intentionally excluded — GitHub remains the source of truth for those.

## Feature Toggle

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_ENABLED` | No | Set to `true` to enable. Off by default. |
| `ANTHROPIC_ADMIN_API_KEY` | When enabled | Anthropic Admin API key (`sk-ant-admin...`) |

### Constraints

- `CLAUDE_CODE_ENABLED=true` requires `AUTH_ENABLED=true`. Without auth, there's no way to gate spend visibility per user. Startup validation warns if this constraint is violated.
- When disabled, no API calls are made during report runs and no spend columns appear in the UI. The ALTER TABLE migrations still run (columns exist but stay at 0).

### Configuration

Added to `getAppConfig()` as a `claudeCode` section:

```typescript
claudeCode: {
  enabled: boolean;       // CLAUDE_CODE_ENABLED === 'true'
  adminApiKey: string;    // ANTHROPIC_ADMIN_API_KEY
}
```

Follows the existing `jira` config pattern.

Conditional validation added to `env-validation.ts`:

```typescript
{
  when: () => process.env.CLAUDE_CODE_ENABLED === 'true',
  featureLabel: 'CLAUDE_CODE_ENABLED=true',
  vars: [
    { name: 'ANTHROPIC_ADMIN_API_KEY', description: 'Anthropic Admin API key (sk-ant-admin...)' },
    { name: 'AUTH_ENABLED', description: 'Auth must be enabled for spend visibility gating' },
  ]
}
```

## Database Schema

Four new columns on `developer_stats`:

| Column | SQLite Type | MySQL Type | Description |
|--------|-------------|------------|-------------|
| `cc_total_cost` | REAL NOT NULL DEFAULT 0 | DECIMAL(10,2) NOT NULL DEFAULT 0 | Total estimated cost in cents USD |
| `cc_input_tokens` | INTEGER NOT NULL DEFAULT 0 | BIGINT NOT NULL DEFAULT 0 | Total input tokens (uncached + cache_read + cache_creation) |
| `cc_output_tokens` | INTEGER NOT NULL DEFAULT 0 | BIGINT NOT NULL DEFAULT 0 | Total output tokens |
| `cc_sessions` | INTEGER NOT NULL DEFAULT 0 | INT NOT NULL DEFAULT 0 | Total Claude Code sessions |

Added via ALTER TABLE migrations in both `sqlite.ts` and `mysql.ts` (same pattern as `total_reviews` — try/catch to ignore duplicate column errors on existing DBs).

Cost is stored as cents (matching the API response format) to avoid floating-point issues. UI formats to dollars.

## File Structure

```
src/lib/claude-code/
├── client.ts        # API client — fetchDailySpend(), types
├── mock-client.ts   # Mock provider for dev/test (random spend data)
└── index.ts         # Re-exports + getClaudeCodeClient()
```

Follows the `src/lib/jira/` pattern.

## API Client

### `src/lib/claude-code/client.ts`

Types:

```typescript
interface ClaudeCodeDailyRecord {
  email: string;
  totalCost: number;       // cents USD, summed across all models
  inputTokens: number;     // uncached + cache_read + cache_creation
  outputTokens: number;
  sessions: number;
}

interface ClaudeCodeClient {
  fetchDailySpend(date: string): Promise<ClaudeCodeDailyRecord[]>;
}
```

`fetchDailySpend(date)`:
1. Calls `GET /v1/organizations/usage_report/claude_code?starting_at={date}&limit=1000`
2. Handles pagination (loop while `next_page` cursor exists)
3. For each record, sums `estimated_cost.amount` and token counts across the model breakdown array
4. Returns one `ClaudeCodeDailyRecord` per user (identified by `actor.email_address`)
5. Skips records where `actor.type` is not `user_actor` (API actors are excluded)

Auth: `x-api-key: {ANTHROPIC_ADMIN_API_KEY}`, `anthropic-version: 2023-06-01`.

Uses direct `fetch` calls (no external SDK), consistent with the Jira client pattern.

### `src/lib/claude-code/mock-client.ts`

Returns random spend data for developers listed in `scripts/mock-identities.ts`. Activated by `CLAUDE_CODE_PROVIDER=mock` env var (following the `GITHUB_PROVIDER=mock` pattern). Also activated as part of `npm run dev:mock`.

## Ingestion Flow (report-runner.ts)

After the Jira step and before final aggregation, a new "Claude Code spend" step runs if `claudeCode.enabled` is true:

1. **Build date range** — generate an array of date strings (`YYYY-MM-DD`) covering the report period (e.g., 14 dates for a 14-day report).

2. **Fetch all days** — for each date, call `client.fetchDailySpend(date)`. Accumulate into a `Map<email, { cost, inputTokens, outputTokens, sessions }>`, summing across days.

3. **Build email-to-login map** — query distinct `(github_login, author_email)` pairs from `commit_analyses` for this report. Build a `Map<email, github_login>`. A developer may have multiple commit emails; all are checked.

4. **Match and assign** — for each entry in the spend map, look up the email in the email-to-login map. If matched, set `s.ccTotalCost`, `s.ccInputTokens`, `s.ccOutputTokens`, `s.ccSessions` on the corresponding developer stats. Unmatched emails (non-engineers, external users) are silently skipped.

5. **Recalculate impact score** — spend does NOT affect the impact score. No recalculation needed.

6. **Save** — the new columns are included in both the progressive per-member INSERT and the final aggregation INSERT (same pattern as `total_reviews`). Note: progressive saves will have `cc_*` = 0 since spend is fetched after all members are processed. The final aggregation overwrites with actual values.

### Logging

Progress updates follow the existing pattern:

```
[jira] @msogin: 12 resolved issues
[claude-code] Fetching spend data (14 days)...
[claude-code] @msogin: $142.80 (89 sessions)
[claude-code] @vbarhatov: $98.45 (62 sessions)
[claude-code] Spend collection complete: $847.23 total across 15 matched developers (5 unmatched emails skipped)
```

### Resume behavior

On resume, spend data is re-fetched (not cached). The API is free and fast, and the data may have updated since the original run. The final INSERT uses ON DUPLICATE KEY UPDATE, so re-fetching is idempotent.

## API Changes

### `GET /api/report/[id]/org`

Response includes new fields on each developer in the stats array:

```typescript
{
  cc_total_cost: number;    // cents
  cc_input_tokens: number;
  cc_output_tokens: number;
  cc_sessions: number;
}
```

These fields are always present (default 0 when Claude Code is disabled). The UI decides whether to render them based on feature flag + auth role.

### `GET /api/report/[id]/dev/[login]`

Same new fields on the developer object. The API does not gate access — the page component handles visibility based on auth.

### `GET /api/llm-config`

Already returns feature flags. Add `claudeCodeEnabled: boolean` so the frontend knows whether to render spend UI.

## UI — Org Report Page

### Main Table: Spend Column

- New "Spend" column in the developer table, after the existing columns
- Shows formatted cost: `$142.80`
- **Visibility:** only rendered when `claudeCodeEnabled && isAdmin`
- Sortable (descending by default on click)

### Spend Tab (Admin Only)

A new tab on the org report page. Hidden when `!claudeCodeEnabled || !isAdmin`.

**Summary bar** (4 tiles):
- Total Org Spend (sum of all matched engineers)
- Average per Developer (mean)
- Median (p50)
- Top 20% Share — percentage of total spend from the top 20% of developers, with count and dollar breakdown (e.g., "4 devs = $661 of $847")

**Pareto concentration bar:**
A horizontal stacked bar showing the top-20% / bottom-80% split visually. Gradient from amber to red for the top segment.

**Top Spenders table:**
- Toggle: Top 10 / Top 20 / All (defaults to Top 10)
- Columns: Rank, Developer, Spend, % of Total, Cumulative %, Sessions, $/Session, Impact
- Outlier badge: "high $/impact" shown on developers whose spend-per-impact-point exceeds 2x the median $/impact across all developers
- Collapsed summary row for developers outside the current view (e.g., "5 more developers — $198.40 combined (23.4%)")

**Spend vs Impact scatter plot:**
- X-axis: Impact Score
- Y-axis: Spend ($)
- Each dot = one developer
- Outlier dots (2x median $/impact) rendered in red with a highlight border
- Quadrant labels: "high spend / low impact" (top-left) and "high spend / high impact" (top-right)
- Hover tooltip with developer name, spend, and impact

### Outlier Detection

Computed client-side from the data already on the page:

1. For each developer with spend > 0 and impact > 0, compute `costPerImpact = ccTotalCost / impactScore`
2. Compute the median `costPerImpact` across all developers
3. Flag developers where `costPerImpact > 2 * median` as outliers

Developers with 0 spend or 0 impact are excluded from the outlier calculation (new team members, people on vacation, etc.).

## UI — Developer Detail Page

### Spend Tile

A single tile in the existing metrics row showing:
- Label: "CC Spend"
- Value: formatted cost (e.g., "$142.80")
- Subtitle: session count (e.g., "89 sessions")

**Visibility rules:**
1. `CLAUDE_CODE_ENABLED` must be true
2. `AUTH_ENABLED` must be true
3. Viewer must be either:
   - The developer themselves (viewer email matches developer's commit email), OR
   - An admin

Implementation: the dev detail page calls `getAuthInfo(req)` (already available) to get the viewer's identity and role. The tile is conditionally rendered based on these checks.

When auth is disabled, the spend tile is never shown (we can't verify who's viewing).

## Access Control Summary

| View | Condition |
|------|-----------|
| Org table Spend column | `claudeCodeEnabled && isAdmin` |
| Org Spend tab | `claudeCodeEnabled && isAdmin` |
| Dev detail Spend tile (own) | `claudeCodeEnabled && authEnabled && isOwnProfile` |
| Dev detail Spend tile (others) | `claudeCodeEnabled && isAdmin` |

## Testing

### Unit Tests

- `claude-code/client.ts` — mock fetch responses, verify pagination handling, token/cost aggregation, email extraction, API actor filtering
- `aggregator.ts` — verify spend columns pass through aggregate() unchanged (they're set by report-runner, not computed by aggregator)
- `report-runner.ts` — verify Claude Code step is skipped when disabled, verify email matching logic, verify spend data flows to final INSERT

### Integration Tests

- Full report run with mock Claude Code client — verify `cc_*` columns are populated in `developer_stats`
- Report run with Claude Code disabled — verify `cc_*` columns are all 0

### Manual Testing

- Run report locally with `CLAUDE_CODE_PROVIDER=mock` (or real API key if available)
- Verify Spend column appears in org table for admin, hidden for viewer
- Verify Spend tab appears for admin only
- Verify dev detail page shows spend tile for own profile, hidden for others (unless admin)
- Verify Pareto metrics compute correctly
- Verify outlier badge appears on the right developers

## Future Work (Phase 2+)

- **Budget limits and projections** — admin-configured monthly budgets, projected month-end spend based on current trajectory, overspend alerts
- **Monthly spend dashboard** — calendar-month view independent of report periods
- **Spend trend over time** — cross-report trajectory using historical report data
- **Consolidated feature toggle config** — unify JIRA_ENABLED, AUTH_ENABLED, CLAUDE_CODE_ENABLED into a single configuration class with validation and dependency checking
- **Alerting** — email/Slack notifications when individual or org spend exceeds thresholds
- **Cost-per-commit / cost-per-PR** — deeper efficiency metrics combining spend with GitHub output

## Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data source | Anthropic Claude Code Analytics API | Only API with per-user breakdowns; server-side fetch fits report-runner pattern |
| User matching | Email auto-match via commit_analyses.author_email | Automatic, no manual mapping needed; consistent with Jira auto-discovery |
| Ingestion approach | Inline in report-runner (Approach A) | Simple, follows Jira pattern, API is free/fast, 14-30 calls negligible vs LLM analysis time |
| Storage granularity | Aggregate per report in developer_stats | Aligned with existing data model; trajectory comes from comparing across reports |
| What to ingest | Cost + sessions only (not productivity metrics) | GitHub is source of truth for commits/PRs/lines; avoid conflicting numbers |
| Spend limits | Phase 2 | Anthropic API doesn't expose limits; show data first, add budgets once patterns are visible |
| Non-engineering users | Excluded (unmatched emails skipped) | Only interested in engineers found in GitHub; admins can use Anthropic Console for full org view |
| Monthly views | Phase 2 | Per-report view is consistent with existing patterns; monthly views come with budget tracking |
| Outlier detection | Client-side, 2x median $/impact | Simple, no LLM needed, computed from data already on the page |
| Auth requirement | CLAUDE_CODE_ENABLED requires AUTH_ENABLED | Can't gate spend visibility without knowing who's viewing |
