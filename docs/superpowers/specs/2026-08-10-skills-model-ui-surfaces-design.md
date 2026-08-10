# Skills + model breakdown UI surfaces

## Goal

Surface the skills-usage and model-breakdown data ingested by GLOOK-30 in two places beyond the profile self-view: per-engineer detail on the engineer page, and an org-level **Model Mix** aggregate on the Spend tab.

This is the UI half of what GLOOK-31 anticipated. It ships as additional commits on `feat/glook-30-skills-model-ingestion` (one combined PR, by explicit choice), so the whole-branch review is re-run at the end over the combined work.

## Starting position

The two surfaces are in opposite states, which shapes the work:

- **Engineer page** (`src/app/report/[id]/dev/[login]/page.tsx`) already *receives* `skills`, `models` and `developer.cc_skills_used` from `/api/report/[id]/dev/[login]` and silently drops all three — `DevStats` (lines 19-28) declares none of them and the destructuring block (118-124) never reads them. This half is purely presentational: no lib, route or SQL change.
- **Spend tab** (`SpendTab` in `src/app/report/[id]/org/page.tsx:999-1263`) has nothing. `src/lib/report/org.ts` contains zero references to `cc_skills_usage`, `cc_model_usage` or `cc_skills_used`. This half needs new queries, a payload extension, and route gating.

Two data realities from the live pull that drive design decisions:

- **Model data is rich:** ~250-280 rows per report across 9 distinct models, with a real cost spread (`claude-sonnet-5` 57% of spend, `claude-haiku-4-5` 1% on 28k requests). Worth a full panel.
- **Skills data is sparse:** 9 invocations org-wide; 14 of the rows are `chat`, which reports `distinct` only and therefore contributes 0 to `skills_used`. A dedicated skills panel would read as empty, so skills get one compact line instead.

## Surface 1 — Engineer page

Replace the standalone **Anthropic Spend** tile (`page.tsx:250-259`) with a fuller **Claude Code Usage** card in the same slot — between the percentile grid and the Commit Types / Active Repos row.

The card reuses the visual language already established by `src/app/profile/profile-content.tsx:126-169` (GLOOK-29) verbatim, because that component renders exactly this data from exactly this payload shape:

1. **3-up stat row** — Spend · Requests · Skills invoked
2. **Skills by product** list — rendered only when `skills.length > 0`
3. **Models** list — model name, `$cost · N req`, plus a share-of-this-developer's-spend mini-bar

Card shell `bg-gray-900 rounded-xl p-5 mb-6`; list rows `flex items-center justify-between text-sm py-0.5` with `text-gray-400` label and `text-gray-300 tabular-nums` value; mini-bar `w-24 h-1.5 bg-gray-800 rounded-full overflow-hidden` with an `bg-accent-light` fill.

**Visibility:** the card renders when *any* of (cost present and > 0, skills rows, model rows) has data — so it disappears entirely on installs with no Anthropic data, matching the tile it replaces. Each stat renders `—` when its own field is absent. A model row renders its cost only when `cost != null`.

**Types:** `DevStats` gains `cc_skills_used?: number`; two new interfaces mirror the payload:
```ts
interface SkillRow { product: string; skills_used: number; skills_distinct: number }
interface ModelRow { model: string; cost?: number; requests?: number }
```
Both `cost` and `requests` are optional because the dev route strips both for viewers who cannot see that developer's cost.

**Deliberately excluded:** skills is *not* added to the percentile grid. The conditional-metric spread (`...(hasJiraData ? [...] : [])`) makes it easy, and it would require adding `cc_skills_used` to `dev.ts`'s `allDevRows` SELECT — but at 9 invocations org-wide the percentiles would be noise. Revisit when adoption grows.

## Surface 2 — Spend tab Model Mix

A new section inserted **after** the Pareto "Spend Concentration" block (`page.tsx:1101-1119`) and **before** the Top Spenders table (1121).

Contents:
- Section label **Model Mix** plus the visible total.
- A segmented cost-share bar built from plain divs, following the Pareto pattern (`h-6 bg-gray-800 rounded-full overflow-hidden flex`): the top models by cost, with the remainder collapsed into "Other". Segment labels render only when the segment is wide enough, as the Pareto bar already does.
- A table: **model · spend · % · requests · $/req · devs**, using the established header/row classes.
- One compact skills line beneath, e.g. *"Skills: 9 invocations by 14 developers (cowork 9, chat distinct-only)"*. Ungated, always shown when any skills rows exist.

**Under partial cost visibility** (`fullCostVisibility === false`, computed at 1010): relabel the section to **Your teams' model mix** and add the existing amber scope note. The `%` column and the share bar are **kept**.

This deliberately diverges from how "Top 20% Share" and the Pareto block are treated, and the distinction matters. Those are *concentration* statistics — claims about how unevenly spend is distributed across the org population — and they genuinely break when computed over a permission-filtered subset. A **composition** share does not: "62% of my team's spend went to opus" is a valid, useful statement about any well-defined subset, and it is precisely the question a team member opens this panel to answer. Suppressing it would remove the feature's value for exactly the audience team-scoped visibility exists to serve. The requirement is therefore that the *scope* is unambiguous in the label, not that the ratio is hidden.

**Scope coherence is a hard requirement.** The org route strips `cost`/`requests` per developer but keeps the row and its `model`. If `computeModelMix` aggregated over every row, a team member would see org-wide model names and dev counts alongside team-only cost — mismatched scopes in a single table (e.g. `claude-opus-5 · $0.00 · 0 req · 44 devs`). `computeModelMix` therefore considers **only rows whose `cost` is present**, so the models listed, the dev counts, the request totals and the spend total are all scoped identically to the developers whose spend the viewer may see. An admin sees the org; a team member sees their team(s); an unmapped viewer sees the panel not render at all.

The Top Spenders table is **not** changed. A per-row model-mix column was considered and rejected: that table already carries 8-11 columns and a hardcoded `colSpan={spendWindow ? 11 : 8}`.

## Data layer

`src/lib/report/org.ts` gains two queries and one column:

```ts
modelUsage:  Array<{ github_login: string; model: string; cost?: number; requests?: number }>
skillsUsage: Array<{ github_login: string; product: string; skills_used: number; skills_distinct: number }>
```
plus `cc_skills_used` appended to the existing `developer_stats` SELECT (lines 20-29). Both new queries are `WHERE report_id = ?` with deterministic ordering, and values are coerced with `Number()` because DECIMAL/REAL come back as strings from both drivers.

Payload cost is acceptable: ~250-280 model rows and ~20 skills rows per report, small flat objects.

### Aggregation happens client-side — deliberately

A new pure function in the org page, mirroring `computeSpendMetrics` (`page.tsx:956-985`):

```ts
function computeModelMix(modelUsage: ModelUsageRow[]): {
  rows: Array<{ model: string; cost: number; requests: number; devs: number; pct: number; costPerRequest: number }>;
  total: number;
}
```

Server-side aggregation was rejected on security grounds. `getOrgReport` has no requester context, so an aggregate computed there would sum **every** developer's model cost; the route strips per-developer fields *after* the fact and could not retroactively correct a pre-summed total. A partial-visibility viewer would receive org-wide cost totals they are not entitled to — the same leak class the GLOOK-30 final review caught in per-model `requests`. Aggregating on the client over the already-stripped rows makes the aggregate structurally incapable of exceeding what the viewer may see, and matches how `computeSpendMetrics` already works.

## Visibility model

| Field | Visibility |
|---|---|
| all `cc_skills_usage` data, `cc_skills_used` | ungated |
| `cc_model_usage.model` | ungated |
| `cc_model_usage.cost`, `cc_model_usage.requests` | **gated** — existing `canSeeCost(devLogin)` |

Per-model `requests` is gated because `Σ requests` reconstructs the gated `cc_requests`; this was established during the GLOOK-30 final review and is preserved unchanged here.

### One refactor this forces

The dev route strips per-model cost inline (`src/app/api/report/[id]/dev/[login]/route.ts:25-28`). The org route now needs identical logic. Rather than copy it — the duplicated-field-list problem was the most-repeated finding in the GLOOK-27 review, and the GLOOK-30 final review explicitly noted "no shared `stripModelCost`-style helper; fine for one call site, not two" — extract into `src/lib/cost-visibility.ts`:

```ts
export function stripModelCost<T extends { model: string }>(
  models: T[], canSeeCost: (login: string) => boolean, devLogin: string,
): Array<Omit<T, 'cost' | 'requests'> & Partial<Pick<T, 'cost' | 'requests'>>>;
```

Both routes call it. For the org route the models array is per-login, so the strip is applied per `github_login`, and the surviving array is re-sorted deterministically by model name so array order carries no cost signal — the same guarantee the dev route already provides.

## Testing

- **Engineer page** (behavioural, jsdom + `@testing-library/react`, `.tsx`): renders spend/requests/skills-invoked and both lists from a payload; renders a model row with `cost`/`requests` absent without printing `$undefined`/`NaN`; hides the whole card when no dimension has data.
- **`computeModelMix`** (unit, pure): correct totals, percentages, `$/request`, dev counts; a model appearing for several developers is merged. **Scope coherence:** given a mix of rows with and without `cost`, a model present *only* on cost-stripped rows must not appear at all, and dev counts must count only visible developers — not `NaN`, not `$0` phantom rows.
- **Spend tab** (behavioural): Model Mix renders under full visibility labelled "Model Mix"; under partial visibility the label becomes "Your teams' model mix", the amber scope note is present, and the `%` column and share bar are still rendered (this is the composition-vs-concentration distinction, so it is asserted explicitly rather than left implicit).
- **Org route** (route test): per-model `cost` and `requests` are stripped for a developer the requester cannot see, `model` survives, order is by model name; skills are never stripped.
- **Leak-surface guard:** `/api/report/[id]/org` is a brand-new surface for per-model cost, so it gets an explicit test that a non-admin non-teammate receives no per-model cost or requests for another developer.
- `stripModelCost` unit tests, including that it is the only implementation (no inline copy remains in either route).

## Out of scope

- Per-row model columns in the Top Spenders table (rejected above).
- Skills in the percentile grid (rejected above).
- Team page and MCP exposure — unchanged, still out of scope as in the GLOOK-30 spec.
- Token counts and per-skill names — still unavailable from the API.

## Files

| File | Change |
|---|---|
| `src/lib/report/org.ts` | Two new queries + `cc_skills_used` column; return `modelUsage`, `skillsUsage` |
| `src/lib/cost-visibility.ts` | NEW `stripModelCost` helper |
| `src/app/api/report/[id]/org/route.ts` | Strip per-model cost/requests per login via the helper |
| `src/app/api/report/[id]/dev/[login]/route.ts` | Replace inline strip with the shared helper |
| `src/app/report/[id]/dev/[login]/page.tsx` | Claude Code Usage card replacing the spend tile; types |
| `src/app/report/[id]/org/page.tsx` | `computeModelMix` + Model Mix section + skills line |
| tests | Suites listed above |

## Housekeeping folded into this branch

Two local-dev changes currently uncommitted in the working tree get committed here rather than left loose where they could sweep into the PR unnoticed (the GLOOK-30 final review caught exactly that failure mode): an `AUTH_TEST_EMAIL` override in `src/lib/auth.ts`'s existing test-mode branch, and its passthrough in `docker-compose.yml`. It lets a local run be exercised as a real developer whose `user_mappings` row already resolves, instead of the synthetic unmapped default — which is what made this feature locally verifiable at all.

## Follow-ups (unchanged from the GLOOK-30 review, still open)

Generic-walk descendant double-count; `MAX_PAGES` off-by-one plus a same-email cross-page merge test; merged `distinct` should use `max` not `sum`; an integration test asserting all three dimensions land; profile empty-state copy split by cause; the `cc-breakdown-schema` flake.
