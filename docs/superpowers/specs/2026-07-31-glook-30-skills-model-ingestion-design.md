# GLOOK-30 / GLOOK-29: Skills + model-breakdown ingestion and developer self-view

## Goal

Ingest two new per-developer dimensions from the Anthropic Analytics API — **skills usage** (per product) and **model breakdown** (cost + requests per model) — on the same cadence and through the same machinery as the existing cc-spend pull. Then surface a developer's own numbers (cost, skills, models) on their profile page.

Covers GLOOK-30 (skills ingestion), the model-breakdown half of GLOOK-31, and GLOOK-29 (self-view).

## API findings

Both facts below were established by probing the live API with the existing `ANTHROPIC_ANALYTICS_API_KEY`; they are not inferred from docs.

### Skills — `GET /v1/organizations/analytics/users`

- Params: `date=YYYY-MM-DD` **or** `starting_date` + `ending_date` (**not** the `starting_at`/`ending_at` timestamps the cost endpoint uses), plus `limit` and a `next_page` cursor. Same auth headers as the cost endpoint.
- **~2-day data lag.** `ending_date=<today>` returns HTTP 400 `"Latest available data for this query is <date>."`
- Rows are per user, keyed on `user.email_address`. Skills counts are **scattered across product buckets**, not a single top-level field:
  - `chat_metrics.distinct_skills_used_count` — chat reports **only** distinct, no total
  - `office_metrics.{excel,word,powerpoint,outlook}.{skills_used_count, distinct_skills_used_count}`
  - `cowork_metrics.{skills_used_count, distinct_skills_used_count}`
  - `science_metrics.skills_used_count`
- The endpoint returns **counts only — never skill names.** "Which specific skill is most used" is unanswerable from this source.

### Models — `GET /v1/organizations/analytics/user_cost_report?group_by[]=model`

- The **existing** cost endpoint plus a grouping param. Rows retain `actor`, so the result is per-(developer, model): e.g. `claude-opus-4-8`, `claude-sonnet-5`.
- **The `[]` is required.** `group_by=model` is silently ignored and returns `model: null` — an easy trap.
- Valid dimensions: `product`, `model`, `context_window`, `inference_geo`, `speed`, `slack_channel_id`, `rbac_group_id`, `claude_project_id`, `cost_type`, `token_type`. `actor` is *not* a valid dimension (it is always present).
- **Totals do not reconcile exactly.** Σ(per-model cost) ≠ `cc_total_cost` in general: the API revises figures for ~30 days as late events settle, and repeated probes of the same user/day returned drifting amounts. Each is stored as its own truth; no reconciliation is attempted or asserted.

### Tokens — not available

`group_by[]=token_type` yields `uncached_input_tokens` / `output_tokens` / `cache_read_input_tokens`, but `amount` remains **cost** (e.g. `1.026`, `3045.4`) and `requests` becomes null. There is no raw token-count field anywhere in this API. Token ingestion is therefore **out of scope** (see Follow-ups).

## Storage

Two symmetric per-(report, developer, dimension) breakdown tables. Both are extensible by design: a new product bucket or a new model is a new **row**, never a schema change.

```sql
CREATE TABLE cc_skills_usage (
  report_id       TEXT    NOT NULL,
  github_login    TEXT    NOT NULL,
  product         TEXT    NOT NULL,   -- 'chat' | 'cowork' | 'office.excel' | 'science' | future buckets
  skills_used     INTEGER NOT NULL DEFAULT 0,
  skills_distinct INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login, product)
);

CREATE TABLE cc_model_usage (
  report_id    TEXT    NOT NULL,
  github_login TEXT    NOT NULL,
  model        TEXT    NOT NULL,      -- 'claude-opus-4-8' | 'claude-sonnet-5' | future models
  cost         REAL    NOT NULL DEFAULT 0,   -- same unit as developer_stats.cc_total_cost
  requests     INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  UNIQUE (report_id, github_login, model)
);

-- Lone rollup, so existing per-developer tooling picks up a headline number unchanged.
ALTER TABLE developer_stats ADD COLUMN cc_skills_used INTEGER NOT NULL DEFAULT 0;
```

- **Natural composite key, no surrogate `id`.** Both tables are keyed by `(report_id, github_login, dimension)` via `UNIQUE`, deliberately omitting the `id INTEGER PRIMARY KEY AUTOINCREMENT` that older child tables carry. Nothing references these rows by id, and it sidesteps the cross-DB `id`-collision problem that made the GLOOK-34 backfill import awkward.
- **`cost` unit** matches the existing convention exactly: `Math.round(parseFloat(amount))`, the same value `applyCcSpend` writes into `cc_total_cost` (rendered by dividing by 100). MySQL uses `DECIMAL(10,2)` / `BIGINT` to match the existing cc columns; SQLite uses `REAL` / `INTEGER`.
- **`cc_skills_used`** = Σ `skills_used_count` across products. Chat contributes 0 because chat reports no non-distinct count — documented, not silently implied. It exists so `NUMERIC_DEV_FIELDS`, `DEV_SORT_COLUMNS` and `get_metric_timeseries` work without special-casing. There is deliberately **no** distinct-skills rollup (cross-product "distinct" double-counts) and **no** model rollup (the breakdown is the metric; a count is derivable).
- **No `deleteReport` change.** Child rows are removed by the existing `ON DELETE CASCADE` FK (SQLite runs `pragma foreign_keys = ON`), matching every other report-scoped table.
- Migrations follow the established pattern — there is no migration framework: add to the SQLite `CREATE TABLE` block plus the idempotent startup `ALTER` list, and add a MySQL `CREATE TABLE IF NOT EXISTS` + `ALTER` that tolerates `ER_DUP_FIELDNAME`. `schema.sql` is not edited (cc columns already live only in migrations).

## Architecture

### Provider — `src/lib/cc-spend/`

Two methods are added to the existing `CcSpendProvider` interface rather than building a parallel provider, so the API key, auth headers, retry/`Retry-After` back-off, pagination loop, `MAX_PAGES` guard, mock implementation and `CC_ANALYTICS_PROVIDER` factory gating are all reused:

```ts
pullSkillsByPeriod(periodStart: string, periodEnd: string, log?): Promise<PerEmailSkills[]>;
pullModelCostByPeriod(periodStart: string, periodEnd: string, log?): Promise<PerEmailModelCost[]>;

interface PerEmailSkills    { email: string; products: Array<{ product: string; used: number; distinct: number }> }
interface PerEmailModelCost { email: string; models:   Array<{ model: string; costCents: number; requests: number }> }
```

The skills endpoint needs its own URL builder (date params, not timestamps). The model pull reuses the cost URL builder plus `group_by[]=model`.

**Skills parsing is a generic walk, not field-by-field mapping.** Recurse each user row's metric buckets; wherever a node carries `skills_used_count` or `distinct_skills_used_count`, emit one entry whose `product` is that node's dotted path with the `_metrics` suffix stripped (`chat_metrics` → `chat`, `office_metrics.excel` → `office.excel`). A new product bucket is picked up with no code change. Entries where both counts are 0 are **skipped**, so absence means "no usage" and the table stays small (~65 developers × a handful of active products, not × every bucket).

Emails are lowercased/trimmed and `actor.type === 'user_actor'` / `deleted !== true` filtering is applied, consistent with the existing cost accumulator.

### Identity mapping and apply

`apply.ts` currently inlines the email→`github_login` resolution (primary: distinct `LOWER(author_email)` from `commit_analyses` for the report; fallback: `LOWER(jira_email)` from `user_mappings` for the org). That resolver is **extracted into one shared helper** and reused by all three applies — the single-source-of-truth lesson from the GLOOK-27 review, where a duplicated field list was the top recurring finding.

`applySkillsUsage()` and `applyModelUsage()` mirror `applyCcSpend`: delete this report's rows first so a partial pull cannot leave stale data, skip unmapped emails while counting them, count mapped-but-no-`developer_stats`-row cases, and return the same counter shape. `applySkillsUsage` also writes the `cc_skills_used` rollup.

**Each apply runs in its own transaction.** A skills or model failure must not roll back a good cost apply.

### Orchestration

`refreshCcSpendForReport(reportId)` gains the two extra pulls after the existing cost pull. This single function is already the shared path for both the report runner and the Settings → "Pull from Anthropic" button, so both DoD requirements — "same refresh cadence" and manual backfill — are satisfied with no new route, no new button, and no new trigger.

Each pull is independently non-fatal: a failure logs and skips, leaving that dimension at zero without failing the report run or the other pulls. This matches the existing `AnthropicAnalyticsKeyMissingError` handling in `report-runner.ts`.

**Skills window clamping:** the skills pull requests `ending_date = min(periodEnd, today − 2)` to respect the data lag. If a 400 "latest available data" still comes back, it is logged and skipped rather than raised.

## Visibility

Skills and model *identity* are activity telemetry, no different from the commits, PRs, impact scores, AI percentage and Jira counts glooker already shows org-wide to any authenticated user. They are therefore **ungated** — a deliberate decision, recorded here so it is not later read as an oversight.

Per-model **cost is money**, and money is exactly what GLOOK-27 team-scoped. Shipping it ungated would reopen the leak GLOOK-27 closed.

| Field | Visibility |
|---|---|
| all `cc_skills_usage` columns, `developer_stats.cc_skills_used` | ungated |
| `cc_model_usage.model`, `cc_model_usage.requests` | ungated |
| `cc_model_usage.cost` | **gated** — existing `canSeeCost(login)` from `cost-visibility.ts` |

This reuses one existing predicate on one field. No new gating mechanism, and "show all for all" holds for everything that is not dollars.

Exposure in this change is limited to `/api/report/[id]/dev/[login]` (the route the profile view consumes), where per-model `cost` is stripped for developers failing `canSeeCost`. Adding these dimensions to other routes or to MCP tools is out of scope; whoever does it inherits the same rule.

## GLOOK-29 — developer self-view

No new gating code is required: `cost-visibility.ts` already returns `true` from `canSeeCost` when the developer *is* the requester, independent of team membership (the Q2 fix from the GLOOK-27 review). That already satisfies GLOOK-29's cost DoD at the data layer; what is missing is the surface.

`src/app/profile/profile-content.tsx` is a 72-line identity stub. It gains the developer's own numbers by composing existing pieces:

1. `/api/auth/me` → `user.githubLogin` (already returned).
2. `/api/report` → most recent `completed` report id.
3. `/api/report/[id]/dev/[login]` with **the requester's own login** → cost, skills, models.

`getDevReport` is extended to include the focused developer's `cc_skills_usage` and `cc_model_usage` rows. The profile page renders own cost, skills (total + per-product), and model breakdown.

The page requests only the requester's own login, and the dev route's existing gate independently prevents reading another developer's cost — so "never sees another developer's data through this path" holds by construction, and is asserted by test.

## Error handling and degradation

Degradation matches the existing cc-spend pull exactly, per DoD: unmapped or missing identities are counted and skipped, never fatal; a missing API key logs and skips; the report still completes with the affected dimension left at zero. The `resume` guard already in `report-runner.ts` is respected.

## Testing

Mirrors the six existing `cc-spend-*` suites and their patterns (`fetch` mocked for providers, real SQLite for applies):

- **Provider:** skills URL uses date params; `group_by[]=model` is sent with brackets; pagination via `next_page`; retry/`Retry-After`; the generic walk produces expected `product` paths including a **synthetic unknown bucket** (proving new products need no code change); all-zero entries skipped; `user_actor`/`deleted` filtering.
- **Service:** skills `ending_date` clamped to `today − 2`; a 400 "latest available data" is a logged skip, not a throw; a skills/model failure leaves cost data intact.
- **Apply:** matched / unmapped / no-`developer_stats`-row paths for both new applies; rows deleted before re-write; `cc_skills_used` rollup equals Σ used and excludes chat; shared email resolver used by all three.
- **Visibility:** per-model `cost` stripped for a non-teammate but `model` and `requests` retained; own-model cost visible to self; skills never stripped.
- **Cascade:** deleting a report removes its `cc_skills_usage` / `cc_model_usage` rows.
- **Self-view:** profile fetches only the requester's own login.
- **Integration:** end-to-end `refreshCcSpendForReport` against a real SQLite DB, asserting all three dimensions land.
- Mock provider and `scripts/seed-data.ts` gain deterministic fixtures (same FNV-hash approach as the existing cc fixtures) so `npm run dev:mock` and `npm run seed` exercise the new tables.

## Out of scope

- **Token counts** — not present in the API (evidence above). Needs a separate spike.
- **Per-skill names** — not present in the API. The `cc_skills_usage` shape absorbs them later as a `skill_name` column if they ever appear.
- **Team-scoping non-cost fields (GLOOK-31)** — moot under the ungated decision above; its model-cost half is handled here.
- Exposing these dimensions via MCP tools or the org/team pages.

## Files

| File | Change |
|---|---|
| `src/lib/cc-spend/provider.ts` | Interface + two method signatures, new result types |
| `src/lib/cc-spend/anthropic-provider.ts` | Skills URL builder + fetch/walk; model grouped fetch |
| `src/lib/cc-spend/mock-provider.ts` | Deterministic skills/model fixtures |
| `src/lib/cc-spend/apply.ts` | Extract shared email→login resolver; `applySkillsUsage`, `applyModelUsage` |
| `src/lib/cc-spend/service.ts` | Two extra pulls + skills window clamping, each non-fatal |
| `src/lib/db/sqlite.ts`, `src/lib/db/mysql.ts` | Two `CREATE TABLE`s, rollup `ALTER` |
| `src/lib/report/dev.ts` | Include skills + model rows for the focused developer |
| `src/app/api/report/[id]/dev/[login]/route.ts` | Strip per-model `cost` via existing `canSeeCost` |
| `src/app/profile/profile-content.tsx` | Self-view: own cost, skills, models |
| `scripts/seed-data.ts` | Seed both new tables + rollup |
| tests | Suites listed above |

## Follow-ups (separate tickets)

- Spike: do token counts exist in any Analytics surface?
- Re-scope or close GLOOK-31 (comment explaining supersession).
- Optionally expose skills/models via MCP tools and the org/team pages — inheriting the per-model-cost gate.
