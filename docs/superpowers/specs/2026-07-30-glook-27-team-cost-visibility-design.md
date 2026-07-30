# GLOOK-27: Team-scoped Claude Code cost visibility

## Goal

Let a team member see Claude Code cost (`cc_total_cost`, `cc_requests`) for **other members of their own team**, without exposing cost across team boundaries and without granting any new admin or mutating privileges. Today cost is strictly admin-only, gated by `isAdmin()` in three report routes.

## Trust model

A developer's cost is visible to a requester when **any** of:
- auth is disabled (`AUTH_ENABLED != 'true'`) — local/dev, everyone sees everything (matches today's `isAdmin()` returning `true`);
- the requester is an admin (in `AUTH_ADMIN_GROUP`);
- the requester shares **at least one team** with that developer (multi-team membership on either side → visible if the team-id sets intersect).

An authenticated requester with **no `github_login` mapping** sees no one's cost. "Pull from Anthropic" stays admin-only. No new privileges are granted anywhere.

## Architecture

### Shared gating module — `src/lib/cost-visibility.ts` (NEW)

Single source of truth, used by the REST routes **and** the MCP tool so the rule can't drift.

```ts
export interface Requester {
  githubLogin: string | null;   // resolved from JWT email → user_mappings → developer_stats
  teamIds: string[];            // ALL teams the requester belongs to
  isAdmin: boolean;
  authDisabled: boolean;        // AUTH_ENABLED != 'true'
}

// Resolve the requester from request headers. Reuses the email→jira_email→github_login
// chain currently inlined in /api/auth/me, but returns ALL team ids (not LIMIT 1).
export async function resolveRequester(headers: Headers, org: string): Promise<Requester>;

// Predicate: can this requester see the given developer's cost?
// authDisabled || isAdmin || (teamIds ∩ dev's teamIds) ≠ ∅.
// Built from listTeams(org) → login→teamIds map (no new SQL).
export async function buildCostVisibility(
  org: string, requester: Requester,
): Promise<{ canSeeCost: (devLogin: string) => boolean; canSeeAnyCost: boolean }>;

// Drop cc_total_cost / cc_requests from developers the requester can't see.
export function stripDevCost<T extends { github_login: string }>(
  devs: T[], canSeeCost: (login: string) => boolean,
): T[];
```

`canSeeAnyCost` = `authDisabled || isAdmin || (githubLogin != null && teamIds.length > 0)` — i.e. a mapped requester who belongs to at least one team. Used to gate report-level fields (below).

`/api/auth/me` is refactored to call `resolveRequester` instead of its inlined query (removes the duplication; its existing response shape is preserved).

### REST routes

All three replace the current binary `if (!isAdmin(req)) stripAll` with: `resolveRequester` → `buildCostVisibility` → `stripDevCost` (per-developer, not all-or-nothing).

- `report/[id]/route.ts` — `stripDevCost(result.developers, canSeeCost)`.
- `report/[id]/dev/[login]/route.ts` — apply `canSeeCost` to `result.developer` and each of `result.allDevelopers` (reuse its existing `stripCc`). The focused developer's own cost follows the same rule.
- `report/[id]/org/route.ts` — `stripDevCost` on developers; **report-level** `cc_period_start`/`cc_period_end` and `spendWindow` are kept when `canSeeAnyCost` (date range only, not amounts), stripped otherwise.

### MCP — `query_developer_stats`

The MCP tool currently returns `cc_total_cost`/`cc_requests` to any authenticated caller (no `isAdmin` check) — a pre-existing bypass of the REST gates. Close it with the **same** team-scoped rule:

- `src/app/api/mcp/route.ts` already calls `extractUser` for its auth backstop. It resolves the requester (`resolveRequester(req.headers, org)`) and passes a `Requester` down through `handleJsonRpc(message, requester)` → `callTool(name, args, requester)` into the handler.
- `queryDeveloperStats` applies `buildCostVisibility` + `stripDevCost` to its rows. All other tools ignore the extra arg.
- The org for MCP resolution is the anchored report's org (same resolution the tools already use).

### Frontend — driven by the payload

Because the backend now strips cost per-developer, the client only needs to distinguish **absent** cost from `$0`:

- `dev-table.tsx`, `team-table.tsx`, `org/page.tsx` (`SpendTab`), `dev/[login]/page.tsx`: render a missing `cc_*` value as **"–"**, never `$0`.
- `team-aggregator.ts`: if **any** member's `cc_total_cost` is absent, the team's total renders **"–"** (a partial team can't be summed) — so the requester's own team shows a real total and other teams show "–". Replaces the silent `Number(d.cc_total_cost ?? 0)` sum.
- Show the Spend column / Spend tab / cost tile when the payload **contains** any cost (any developer has `cc_total_cost` defined), rather than the binary admin flag.
- Keep `canAct` (admin) **only** for the "Pull from Anthropic" refresh action.

No new identity field is needed in `auth-context` — payload presence drives display.

## Leak surfaces (DoD)

- **CSV / Google Sheets export** (`report/[id]/team/page.tsx`): builds a fixed header list that excludes cost today → no change needed; a test asserts cost columns are absent so a future addition can't leak silently.
- **team-pulse** (`src/lib/team-pulse/*`): its SQL never selects `cc_*` → no change; a test asserts the payload carries no cost.
- **MCP** `query_developer_stats`: covered above.

## Out of scope

- `/api/teams` (GET) and `/api/mcp` have unrelated pre-existing missing-auth gaps (they expose team membership / require only "authenticated"). Not part of this ticket; left untouched.
- No changes to how cost is ingested or stored.

## Testing

Visibility matrix (unit tests on the gating module + route/handler tests with mocked DB, following the repo's `jest.mock('@/lib/db/index')` pattern):

| Requester | Own-team dev | Other-team dev |
|---|---|---|
| admin | cost | cost |
| team member (mapped) | cost | stripped |
| unmapped (auth on) | stripped | stripped |
| auth disabled | cost | cost |

Plus:
- `report/[id]/org` report-level `cc_period_*`/`spendWindow`: present for `canSeeAnyCost`, absent otherwise.
- MCP `query_developer_stats`: a non-admin non-teammate gets `cc_*` stripped; a teammate keeps them.
- Frontend: absent cost renders "–"; `team-aggregator` shows "–" for a team with any hidden member, a real total for a fully-visible team.
- Export headers contain no cost columns; team-pulse payload contains no cost fields.

## Files

| File | Change |
|---|---|
| `src/lib/cost-visibility.ts` | NEW — `resolveRequester`, `buildCostVisibility`, `stripDevCost` |
| `src/app/api/auth/me/route.ts` | Refactor to use `resolveRequester` |
| `src/app/api/report/[id]/route.ts` | Per-dev cost strip via shared module |
| `src/app/api/report/[id]/org/route.ts` | Per-dev strip + `canSeeAnyCost`-gated report-level fields |
| `src/app/api/report/[id]/dev/[login]/route.ts` | Per-dev strip via shared module |
| `src/app/api/mcp/route.ts` | Resolve requester, thread into protocol/callTool |
| `src/lib/mcp/protocol.ts` | Thread `requester` through `handleJsonRpc` → `callTool` |
| `src/lib/mcp/tools.ts` | `callTool` passes `requester` to handlers |
| `src/lib/mcp/queries.ts` | `queryDeveloperStats` strips cost per team-scope |
| `src/app/report/[id]/team/dev-table.tsx` | "–" for absent cost; presence-driven column |
| `src/app/report/[id]/team/team-table.tsx` | presence-driven column |
| `src/lib/teams/team-aggregator.ts` | "–" for teams with any hidden member |
| `src/app/report/[id]/org/page.tsx` | presence-driven Spend tab |
| `src/app/report/[id]/dev/[login]/page.tsx` | presence-driven cost tile |
| tests | gating module, route/handler, MCP, frontend aggregator, leak-surface assertions |
