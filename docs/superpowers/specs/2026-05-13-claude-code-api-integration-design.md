# Claude Code Spend — API ingestion (replace CSV upload)

**Date:** 2026-05-13
**Status:** approved (brainstormed; not yet implemented)

## Goal

Replace the manual CSV upload of Claude Code spend data with a pull from Anthropic's [Claude Code Analytics API](https://platform.claude.com/docs/en/manage-claude/claude-code-analytics-api.md). Auto-pull during report generation; provide a manual "Refresh CC spend" button for backfill and re-runs. Existing downstream (`developer_stats.cc_*` columns, `reports.cc_period_*`, Spend tab on the org page) stays unchanged.

## Scope

In:
- New CC-spend provider abstraction following the `GITHUB_PROVIDER` / `JIRA_PROVIDER` pattern.
- `anthropic` provider hitting `/v1/organizations/usage_report/claude_code`.
- `mock` provider for `npm run dev:mock`.
- Auto-pull integrated into `runReport()`; failure is non-fatal (warn + skip).
- Manual "Refresh CC spend" button on the Settings page replaces the CSV upload form.
- Anthropic Admin API key test-connection UI matching the GitHub/Jira pattern.

Out:
- New schema columns (lines-of-code-by-CC, commits-by-CC, tool acceptance rates). API exposes these; capturing them is a separate, future feature.
- Custom date-range picker on the manual refresh button. Re-uses the report's `period_days` window.
- Migration of historical reports' CC values. Admins can backfill via the button.

## API choice & constraints

| Concern | Choice |
|---|---|
| Endpoint | `GET https://api.anthropic.com/v1/organizations/usage_report/claude_code` |
| Auth | Admin API key (`sk-ant-admin-...`) in `x-api-key` header, plus `anthropic-version: 2023-06-01`. |
| Granularity | **Single-day only** — endpoint requires `starting_at=YYYY-MM-DD`. No `ending_at` / `bucket_width`. To cover a period, iterate one call per day. |
| Pagination | `limit` (max 1000) per day; `next_page` cursor when needed. 70-dev orgs fit in one page. |
| Freshness | ~1h lag; data older than 1h is fully consistent. |
| Stability | Public, documented Admin API — not beta. |
| SDK | Anthropic's `@anthropic-ai/sdk` does not yet cover Admin APIs. Use raw `fetch`. |

The general Cost/Usage API supports date ranges but only groups by workspace_id, not user — not viable for per-developer spend.

## Field mapping (CSV → API)

| Existing column | CSV source | API source |
|---|---|---|
| `cc_total_cost` (cents) | sum of `total_net_spend_usd` × 100 | `sum(model_breakdown[].estimated_cost.amount)` (already cents) |
| `cc_input_tokens` | sum of `total_prompt_tokens` | `sum(model_breakdown[].tokens.input)` |
| `cc_output_tokens` | sum of `total_completion_tokens` | `sum(model_breakdown[].tokens.output)` |
| `cc_sessions` | `total_requests` (**misnamed** — was actually request count) | `num_sessions` (true CC session count) |

**Note on `cc_sessions` semantic change:** the CSV path stored API-request count under the `sessions` label, which never reflected actual Claude Code session count. The new API gives true sessions. Values will be lower than CSV-era values for the same period. Document in the PR/changelog.

`cache_read` and `cache_creation` tokens are not summed into `cc_input_tokens` — matches the CSV's prompt-token semantics.

## Architecture

### Module layout

```
src/lib/cc-spend/
  provider.ts            (new)  CcSpendProvider interface + getCcSpendProvider() factory
  anthropic-provider.ts  (new)  Anthropic API impl with pagination + retry
  mock-provider.ts       (new)  Fixture for dev:mock
  apply.ts               (new)  Email→login + UPDATE dev_stats + UPDATE reports.cc_period_*
  service.ts             (edit) Orchestrator: provider.pullByPeriod → applyCcSpend
  filename.ts            (delete) Filename-period parser no longer needed
```

### Provider interface

```ts
export interface PerEmailAggregate {
  email: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  sessions: number;
}

export interface CcSpendProvider {
  /** Pull per-user CC spend aggregated across the [start, end] window (inclusive). */
  pullByPeriod(periodStart: string, periodEnd: string): Promise<PerEmailAggregate[]>;
  /** Cheap connectivity/auth probe. Returns user count for the given date. */
  probe(date: string): Promise<{ userCount: number; sampleEmail?: string }>;
}

export function getCcSpendProvider(): CcSpendProvider;
```

### Orchestrator

```ts
export interface CcRefreshResult {
  matched: number;
  unmatched: number;
  totalApiUsers: number;
  totalSpendUsd: number;
  periodStart: string;
  periodEnd: string;
}

export async function refreshCcSpendForReport(
  reportId: string,
  log?: (msg: string) => void,
): Promise<CcRefreshResult>;
```

Both callers (`runReport()` and the manual button route) call this. It:
1. Reads `report.created_at` + `report.period_days` to compute `[periodStart, periodEnd]`.
2. `provider.pullByPeriod(start, end)`.
3. `applyCcSpend(reportId, aggregates, start, end)`.

## API pull mechanics

For each day `d` in `[periodStart, periodEnd]` inclusive:
1. `fetch('/v1/organizations/usage_report/claude_code?starting_at=' + d + '&limit=1000')`
2. Follow `next_page` cursor until exhausted (rare for typical org sizes).
3. For each user record, accumulate into `Map<email, PerEmailAggregate>`:
   - `costCents += sum over model_breakdown[].estimated_cost.amount`
   - `inputTokens += sum over model_breakdown[].tokens.input`
   - `outputTokens += sum over model_breakdown[].tokens.output`
   - `sessions += num_sessions`

Return the map's values.

**Retry policy:** 1 retry on `429` / `5xx` with 2.5s back-off (matches the existing GitHub provider's pattern). On retry exhaustion, log the failed day and continue with the rest of the period — the totals will be incomplete but proportionally correct; manual refresh button can re-run.

**Hard failures:** `401` / `403` from auth issues abort the whole pull with a clear error. Missing `ANTHROPIC_ADMIN_API_KEY` env var is detected before any HTTP call and throws `AnthropicAdminKeyMissingError`.

**Pacing:** 14 sequential daily calls × ~200ms ≈ 3s for a typical 14-day window. No `p-limit` needed.

## Integration points

### Runner enrichment

`src/lib/report-runner.ts` — after the Jira phase, before final aggregation:

```ts
try {
  log('Pulling Claude Code spend from Anthropic API...');
  const result = await refreshCcSpendForReport(reportId, log);
  log(`CC spend: ${result.matched}/${result.totalApiUsers} matched, $${result.totalSpendUsd.toFixed(2)} total`);
} catch (err) {
  log(`CC spend: SKIP — ${err instanceof Error ? err.message : String(err)}`);
  // Per design: CC spend is enrichment; report continues without it.
}
```

Failure is logged to the progress store (visible in the running-report UI), never throws out of `runReport()`.

### Manual refresh route

`POST /api/report/[id]/cc-spend/refresh` — admin-gated, no body. Calls the same `refreshCcSpendForReport`. Response shape unchanged from the prior upload route:
`{ matched, unmatched, totalApiUsers, totalSpendUsd, periodStart, periodEnd }`.

Old route `POST /api/report/[id]/cc-spend/upload` and its CSV parser get deleted.

### Settings page UI

`src/app/settings/page.tsx` — the CSV upload form is replaced by:

1. **Anthropic Admin API key** status panel (mirrors the existing GitHub/Jira panels):
   - "Connected — N active CC users seen 2 days ago — 240ms" on success
   - "✗ Not configured" / "✗ Invalid: 401 Unauthorized" on failure
   - **[Test connection]** button calls `POST /api/settings/anthropic/test-connection`
2. **Refresh CC spend for a report** panel:
   - Target Report dropdown (same selector as today's CSV form)
   - **[Pull from Anthropic]** button calls `POST /api/report/[id]/cc-spend/refresh`
   - Success state shows the same matched/unmatched/total/period summary the old upload returned.
   - Last-pulled timestamp shown inline (derived from the report's `cc_period_end`).

## Test-connection route

`POST /api/settings/anthropic/test-connection` — admin-gated. Mirrors the existing GitHub/Jira test routes.

```ts
const provider = getCcSpendProvider();
const date = todayMinus(2);  // 2 days ago — safely past the 1h freshness window
const probe = await provider.probe(date);
return { success: true, userCount: probe.userCount, latencyMs };
```

On error: `{ success: false, error, latencyMs }`.

## Config

| Env var | Purpose | Required? |
|---|---|---|
| `ANTHROPIC_ADMIN_API_KEY` | Admin API key (`sk-ant-admin-...`). | Required for the anthropic provider; missing → warn-and-skip during report runs, hard error from the manual button. |
| `CC_ANALYTICS_PROVIDER` | `anthropic` (default) or `mock`. | Optional. |

`src/lib/env-validation.ts` adds a soft-warn for missing `ANTHROPIC_ADMIN_API_KEY` (same pattern as other API keys; warns but does not crash). `.env.example` gets the new vars. `CLAUDE.md` gets a short note under "Configuration".

## Mock provider

Drives `npm run dev:mock`. Returns deterministic per-email aggregates for the `MOCK_DEVELOPERS` defined in `scripts/mock-identities.ts`. Each mock dev's cost is derived from a stable hash of their email so values don't drift across runs:

- `costCents` in $200–$1,200 range
- `inputTokens` / `outputTokens` in plausible ratios
- `sessions` 5–50 per period

`probe()` returns a fixed `{userCount: MOCK_DEVELOPERS.length, sampleEmail: 'alice@mockorg.dev'}`.

The mock is selected via `CC_ANALYTICS_PROVIDER=mock`, which `npm run dev:mock` already configures via its environment block.

## Testing

| Layer | File | What |
|---|---|---|
| Anthropic provider | `src/lib/__tests__/unit/cc-spend-anthropic-provider.test.ts` | Auth headers, single-day iteration over a period, cursor pagination, retry on 429/5xx, abort on 401/403, per-email aggregation across model_breakdown + days, cents math. Mock `fetch`. |
| Mock provider | `src/lib/__tests__/unit/cc-spend-mock-provider.test.ts` | Deterministic per-email values, sane totals, `probe()` shape. |
| Apply layer | `src/lib/__tests__/unit/cc-spend-apply.test.ts` | Email→login (commit_analyses + user_mappings fallback), matched/unmatched counts, idempotent re-application, period dates written. |
| Service | `src/lib/__tests__/unit/cc-spend-service.test.ts` | `refreshCcSpendForReport` correct period math, provider dispatch, expected result shape. |
| Runner integration | edit `src/lib/__tests__/integration/report-runner.test.ts` | CC phase fires after Jira; errors are swallowed; `cc_*` columns populate when provider returns data. |
| Routes | none | Existing project convention: settings/test-connection routes are not unit-tested; the `/cc-spend/refresh` route is a thin wrapper. |

No per-page React tests, consistent with the rest of the project.

## Migration & rollout

- No schema changes.
- The `cc_sessions` semantic shift is the only user-visible regression for the same period: API-derived values will be smaller than CSV-derived values because they count sessions, not requests. Documented in the PR description and CHANGELOG.
- Historical reports keep their CSV-derived values until an admin clicks the manual button on each one. No automatic backfill.

## Out of scope (deferred)

- Capturing `lines_of_code`, `commits_by_claude_code`, `pull_requests_by_claude_code`, tool-acceptance metrics. Schema migration + UI surface needed; revisit after this lands.
- Custom date-range picker on the manual button.
- Scheduled automatic refresh of historical reports.
- Migration to the Anthropic SDK when it eventually covers Admin APIs.

## Files touched

New:
- `src/lib/cc-spend/provider.ts`
- `src/lib/cc-spend/anthropic-provider.ts`
- `src/lib/cc-spend/mock-provider.ts`
- `src/lib/cc-spend/apply.ts`
- `src/app/api/report/[id]/cc-spend/refresh/route.ts`
- `src/app/api/settings/anthropic/test-connection/route.ts`
- Five new test files (see Testing table).

Edit:
- `src/lib/cc-spend/service.ts` — orchestrator, no CSV.
- `src/lib/report-runner.ts` — enrichment phase.
- `src/app/settings/page.tsx` — Anthropic key panel + refresh button block.
- `src/lib/env-validation.ts` — soft-warn for new env var.
- `.env.example`, `CLAUDE.md` — docs.
- `scripts/mock-identities.ts` — optional fixture seed if not put inline in mock-provider.

Delete:
- `src/app/api/report/[id]/cc-spend/upload/route.ts`
- `src/lib/cc-spend/filename.ts` (if it exists)
- Any tests covering CSV parsing / filename parsing.
