# GLOOK-26: Glooker MCP Server

## Goal

Expose Glooker's data — raw commits/PRs/Jiras, per-developer stats, and the LLM-generated
project/team/highlight analysis — as an MCP server so managers, executives, and engineers
can query it from Claude Code and Claude.ai. Beyond single-report drill-downs, the server
supports **cross-report analysis over time** (e.g. "commits per week over the last 6 months",
"impact-score trend per developer").

Authentication reuses Smartling's canonical MCP pattern: an `mcp-okta-proxy` sidecar in front
of a plain, unauthenticated MCP endpoint in the existing Next.js app.

## Approach

**Curated entity tools (not raw SQL passthrough).** Each tool is a named, schema-validated
function over one entity or one piece of analysis. Safer than a `query(sql)` tool, self-documenting
to the LLM, and easy to test. The trade-off — you can only ask what a tool was designed for — is
acceptable because the tool set covers the entities plus a general time-series aggregator.

**Reuse the service layer, not the HTTP endpoints.** Every existing API route is a thin wrapper
over a function in `src/lib/`. MCP tool handlers call those same functions in-process — no HTTP
hop, no re-serialization. New logic is limited to cross-report queries that no endpoint currently
performs.

---

## Architecture

Three thin layers so no business logic lives in the MCP route:

```
src/app/api/mcp/route.ts     transport: Streamable HTTP (POST), parses MCP request,
                             dispatches to the tool registry, wrapped in withRequestLog()
src/lib/mcp/tools.ts         tool registry: { name, description, zod input schema, handler }
                             per tool. Handlers validate args → call a service/query fn → return JSON
src/lib/mcp/queries.ts       NEW cross-report query functions (dedup + time bucketing)
src/lib/mcp/resolve.ts       resolveReportId(report_id?) helper
        │
        └─ reuses existing services:
           getReportCommits, getJiraIssues, getReportHighlights, getTeamPulse,
           getDevSummary, getDevReport, getEpicSummary, getEpicRingStats,
           getProjectInsights (extracted — see Refactors), getReleaseNotes (extracted)
```

### Transport

- **Streamable HTTP** via `@modelcontextprotocol/sdk` (new dependency). This is the transport
  `claude mcp add --transport http` and Claude.ai custom connectors expect.
- **Stateless** request/response — no server-side MCP session state. Matches the stateless proxy
  and Glooker's single-org model. `Mcp-Session-Id` (if sent) is ignored.
- The route handler is wrapped with `withRequestLog()` like every other route (enforced by the
  existing Jest test).

### Default report resolution

`resolveReportId(report_id?)` — if `report_id` is omitted, returns the id of the latest
`completed` report (`ORDER BY completed_at DESC LIMIT 1`). Every report-scoped tool calls it, so
callers can ask about "the latest" without knowing report IDs. If no completed report exists, the
tool returns a structured `{ error: "no completed reports" }` result (not an exception).

### Read-only

Every tool is a read. No tool mutates the DB or triggers report runs. A leaked token can read
analytics — it cannot launch jobs or change data.

### Cross-report dedup

`commit_analyses` and `jira_issues` rows repeat across overlapping report windows. The
cross-report query functions (`query_commits`, `query_jira_issues`, `get_metric_timeseries`)
**dedup by `commit_sha` / `issue_key`, keeping the row with the earliest `committed_at` /
`resolved_at`**, and use that timestamp as the timeline. Report-scoped calls (explicit
`report_id`) skip dedup and return exactly that report's rows.

Dedup lives in `queries.ts` and uses the shared `db` abstraction, so it works on both SQLite and
MySQL. Any MySQL-specific SQL added here must round-trip through the SQLite `translateSQL()`.

---

## Tool Set

~14 tools. Report-scoped tools accept an optional `report_id` (defaults to latest completed).

### Discovery & scoping

| Tool | Impl | Returns |
|---|---|---|
| `list_reports(org?, status?, limit?)` | new query | report id, org, period_days, status, created_at, completed_at |
| `get_org_summary(report_id?)` | new query | totals: commits, PRs, Jiras, active devs, date range, AI % |

### Raw entities (flat rows for analysis)

| Tool | Impl | Notes |
|---|---|---|
| `query_commits(report_id?, login?, repo?, type?, since?, until?, min_complexity?, ai_only?, limit?)` | new query | flat commit rows; cross-report + dedup when `report_id` omitted |
| `query_jira_issues(report_id?, login?, project_key?, issue_type?, status?, since?, until?, limit?)` | new query | flat issue rows; cross-report + dedup when `report_id` omitted |
| `query_developer_stats(report_id?, login?, sort_by?, limit?)` | new query | ranked per-dev stats from `developer_stats` |
| `query_unmerged_work(report_id?, login?, repo?)` | new query | open PRs (`unmerged_prs`) + unmerged branch commits (`unmerged_commits`) |

### LLM-generated / semantic (cannot be derived from row queries)

| Tool | Impl | Notes |
|---|---|---|
| `get_project_insights(report_id?)` | `getProjectInsights` (extracted) | clustered projects w/ Jira/PR/commit attribution + "Other" |
| `get_project_details(project_name, report_id?)` | `getProjectInsights` (extracted) | one project's full drill-down |
| `get_highlights(report_id?)` | `getReportHighlights` | narrative comparison analysis |
| `get_team_pulse(report_id?, team?)` | `getTeamPulse` | team health summaries |
| `get_developer_summary(login, report_id?)` | `getDevSummary` | LLM narrative + badges for one dev |
| `get_release_notes(limit?)` | `getReleaseNotes` (extracted) | recent release notes |
| `get_epic_summaries(org?, epic_key?)` | new query + `getEpicSummary` / `getEpicRingStats` | epic-level rollups |

`get_epic_summaries`: with `epic_key`, returns that epic's summary + ring stats via the existing
functions. Without `epic_key`, a small `SELECT` over `epic_summaries` / `epic_stats` lists all epics
(key, org, resolved/remaining, commit_count) for the org so the caller can then drill into one.

### Time-series

| Tool | Impl | Notes |
|---|---|---|
| `get_metric_timeseries(metric, group_by?, org?, since?, until?)` | new query | workhorse for "over time" questions |

`get_metric_timeseries` parameters:
- `metric` ∈ `commits` \| `prs` \| `lines_added` \| `jira_resolved` \| `impact_score` \| `ai_percentage`
- `group_by` ∈ `week` \| `month` \| `report` \| `developer` \| `repo` \| `type` (default `week`)
- Returns bucketed aggregates (`{ bucket, value }[]`) so Claude gets a clean series without
  re-aggregating raw rows. Row-based metrics (commits, prs, lines_added, jira_resolved) use the
  deduped cross-report timeline; report-based metrics (impact_score, ai_percentage) aggregate
  `developer_stats` per report.

### Identity type shapes

Tool inputs are zod schemas; outputs are plain JSON. Field names mirror the DB columns
(`github_login`, `committed_at`, `lines_added`, `impact_score`, …) so an analyst sees the same
vocabulary across tools. `DECIMAL`/`REAL` columns are coerced with `Number()` before returning
(both DB drivers can hand back numeric columns as strings).

---

## Refactors (targeted, in service of this feature)

Two routes hold their logic inline instead of in a service. Extract so the route and the MCP tool
share one implementation:

1. **`src/app/api/project-insights/route.ts`** → extract the report-resolution, DB fetch, LLM call,
   enrichment, and caching into `src/lib/projects/insights.ts` exporting
   `getProjectInsights(reportId?)`. The route becomes a thin wrapper. `get_project_insights` and
   `get_project_details` call the function directly. `get_project_details` filters the returned
   projects by `project_name` (case-insensitive exact match; if none, returns
   `{ error: "project not found", available: string[] }`).
2. **`src/app/api/release-notes/route.ts`** → extract into `src/lib/release-notes/service.ts`
   exporting `getReleaseNotes()`. The route becomes a thin wrapper.

No unrelated refactoring.

---

## Auth & Deployment

**No new auth code in Glooker.** `mcp-okta-proxy` fronts the MCP endpoint and injects identity in
the shape Glooker already parses. Set `OKTA_MCP_PROXY_USERINFO_HEADER_NAME=x-amzn-oidc-data` on the
proxy; the `/api/mcp` route reuses the existing `AUTH_ENABLED` identity extraction (from
`x-amzn-oidc-data`) **only for request-log attribution**. Every tool is read-only, so tools are not
gated on the admin group — any authenticated Okta user may query. Locally / in mock mode the header
is absent → identity `anonymous`, tools work unauthenticated (same no-op pattern as
`AUTH_ENABLED=false`).

**Deployment (separate task, not in the implementation plan):**

```
   https://glooker-mcp.internal-tools.dev.smartling.net  (Route53 → shared ALB, host_header)
                                 │
                                 ▼
                ECS task (glooker cluster)
                ┌──────────────────────────────────────┐
                │  mcp-okta-proxy    :8080 (ALB)         │
                │       │  x-amzn-oidc-data              │
                │       ▼ http://localhost:3000/api/mcp  │
                │  glooker (Next.js) :3000               │
                └──────────────────────────────────────┘
```

- Add `docker-registry-v2.smartling.net/smartling/mcp-okta-proxy:latest` as a second container in
  the existing Glooker ECS task definition (`glooker-deploy/terraform`).
- Proxy env: `OKTA_MCP_PROXY_UPSTREAM_URL=http://localhost:3000`,
  `OKTA_MCP_PROXY_MCP_PUBLIC_URL=https://glooker-mcp.internal-tools.dev.smartling.net`,
  `OKTA_MCP_PROXY_USERINFO_HEADER_NAME=x-amzn-oidc-data`, plus Okta config from three SSM params
  (`okta_domain`, `okta_client_id`, `okta_audience`).
- One new Okta app registration for the Glooker MCP.
- New ALB host_header rule + Route53 record for `glooker-mcp` subdomain.

**Connecting from Claude Code:**
```
claude mcp add --transport http glooker https://glooker-mcp.internal-tools.dev.smartling.net/mcp
```
→ Okta browser OAuth → token cached → all tool calls authenticated. Same as KB/Logs/Looker MCPs.
The same URL registers as a Claude.ai custom connector for org-wide distribution.

**Scope boundary:** this spec and its implementation plan cover the **Glooker MCP server code
only**. The Terraform/ECS/Okta-registration work is deployment, tracked separately (consistent
with keeping local and AWS deploys separate).

---

## Files Changed

| File | Change |
|---|---|
| `src/app/api/mcp/route.ts` | NEW — Streamable HTTP transport, dispatch to registry, `withRequestLog()` |
| `src/lib/mcp/tools.ts` | NEW — tool registry (schema + handler per tool) |
| `src/lib/mcp/queries.ts` | NEW — cross-report query + dedup + time bucketing |
| `src/lib/mcp/resolve.ts` | NEW — `resolveReportId()` helper |
| `src/lib/projects/insights.ts` | NEW — extracted `getProjectInsights()` |
| `src/app/api/project-insights/route.ts` | Refactor to thin wrapper over `getProjectInsights()` |
| `src/lib/release-notes/service.ts` | NEW — extracted `getReleaseNotes()` |
| `src/app/api/release-notes/route.ts` | Refactor to thin wrapper over `getReleaseNotes()` |
| `src/lib/mcp/__tests__/queries.test.ts` | NEW — dedup correctness, date bucketing, both dialects |
| `src/lib/mcp/__tests__/tools.test.ts` | NEW — every tool has schema + handler, round-trips a mock call |
| `package.json` | Add `@modelcontextprotocol/sdk` |

---

## Testing

- **`queries.ts`**: dedup keeps earliest timestamp per sha/issue_key; date bucketing (week/month
  boundaries); filters (login/repo/type/date-range); runs on both SQLite and MySQL via the existing
  test harness.
- **`tools.ts`**: registry completeness (every tool has name/description/schema/handler); each tool
  round-trips a mock invocation against seeded data; `resolveReportId` falls back to latest completed
  and errors cleanly when none exist.
- **Enforcement**: the existing `logger-enforcement.test.ts` will require `/api/mcp/route.ts` to
  import `withRequestLog` — satisfied by the transport layer.
- **Mock mode**: tools work under `npm run dev:mock` against seeded data with `anonymous` identity.

---

## Performance Notes

- Row queries hit indexed `report_id` / timestamp columns; `limit` defaults bound result size.
- `get_project_insights` is LLM-backed but cached (`_v: 3`) — first call ~30–60s, cached thereafter.
  The MCP tool inherits the same cache as the web UI (shared function).
- Cross-report dedup is a single query with `GROUP BY` / window over ≤ a few thousand rows —
  negligible.
