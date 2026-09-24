# Vulnerability deployment configuration — agent notes

The SLA policy, the resolved-count start date, the tracking scope and the custom-property taxonomy are **deployment configuration**, not code — set as environment variables in each deployment's own (private) configuration, never hard-coded here. Glooker is public: no real policy date, property key or property value belongs in this module, its tests or its fixtures.

**Read the full rules in `docs/vulnerabilities-page.md`, "SLA policy and org taxonomy (deployment configuration)"** before changing anything below — this file only points at where those rules live in code and lists what a change here must not break.

## Where it lives

- `config.ts` — `parseVulnConfig`/`getVulnConfig` own the neutral defaults, parsing and validation, memoized once per process. `__clearVulnConfigCache` is the test-only reset; any test that sets these env vars must restore `process.env` and call it in `afterEach`/`afterAll`.
- `types.ts` — `SlaEntry`, `PropertyKeys`, `CodebaseGroups`, `ConfigError`, `VulnConfig`.
- `properties.ts` — `mapPropertyRows()`, pure, shared by `github.ts` and `github-mock.ts`, applies the configured property keys to raw rows.
- `sla.ts` — SLA defaults come from `getVulnConfig().slaPolicy`.
- `codebase.ts` — `codebaseGroupOf`/`isInScope` read `getVulnConfig().codebaseGroups`/`tierInScope`.
- `aggregate.ts` — `isResolvedSinceStart` reads `getVulnConfig().resolvedSince` (null means all time).
- `sync.ts` — the sync-time taxonomy guard (`kind: 'config'` sync issues).
- `queries.ts` — `configErrors` on every envelope (startup errors plus the latest run's `config` issues).

## Call sites that must keep reading configuration, never a literal

- `listOrgRepoProperties` (`github.ts`/`github-mock.ts`) — takes the configured keys, reports `keysSeen` for the sync-time guard.
- `codebaseGroupOf`/`isInScope` (`codebase.ts`).
- The resolved-date comparisons in `aggregate.ts` and the sync snapshot SQL in `sync.ts`.
- The SLA defaults in `sla.ts`.
- The summary's `scope: { property, value }` (`queries.ts`) and the policy panel's scope caption.
- MCP tool descriptions (`src/lib/mcp/tools.ts`) — generic wording ("the repo's team custom property"), never a hard-coded key or value.

If you add a new call site that needs a policy date, a property key, an in-scope value or a codebase group, it reads `getVulnConfig()` — it does not take a new hard-coded constant, and it does not accept a value as a literal default beyond the ones already in `config.ts`.

## Validation rules this module enforces

- Every `VULN_*`/`VULNERABILITIES_*` message carries the variable name, the entry **index** (1-based, never the id), and the rule — never the raw value, never `JSON.parse`'s own message text. This is deliberate; do not add a value back into a message for consistency with `env-validation.ts`'s `(got "…")` convention elsewhere.
- `VULNERABILITIES_SLA_POLICY` entries: unique ids, id matches `<severity>-<YYYY-MM>` and starts with its own severity, `severity` is `critical`/`high`, `effectiveFrom` is a valid calendar date and strictly increases per severity in array order, `days` is a positive integer.
- `VULN_CODEBASE_GROUPS`: only the three known group names (`backend`, `frontend`, `shared`), each a list of non-empty strings, no value under more than one group.
- Invalid JSON produces `Invalid JSON in VULNERABILITIES_SLA_POLICY env var` (or the `VULN_CODEBASE_GROUPS` equivalent) rather than any parser-specific text.
- An invalid SLA policy applies **no** SLA (never falls back silently); an invalid `VULN_CODEBASE_GROUPS` falls back to the default mapping. Both surface on the `configErrors` channel either way.

## Guard tests (run them after every change here)

    npx jest src/lib/__tests__/unit/vuln-config.test.ts src/lib/__tests__/unit/vuln-sla.test.ts src/lib/__tests__/unit/vuln-codebase.test.ts src/lib/__tests__/unit/vuln-properties.test.ts

- `vuln-config.test.ts` — one test per validation rule above, plus the no-echo rule, over synthetic fixtures.
- `vuln-sla.test.ts` — the due-date example table (created before/after a policy starts, across a policy change, reopened, re-rated up and down). Adding a policy-shape change means adding rows to that table.
- `vuln-codebase.test.ts` / `vuln-properties.test.ts` — group membership and property-key mapping over synthetic keys/groups.

## Rules the tests can't catch

Repeat these two, word for word, anywhere a deployment sets `VULNERABILITIES_SLA_POLICY` — a stateless validator cannot check either one:

1. Never edit or delete an entry that has taken effect; append a new entry with a later `effectiveFrom`.
2. Choose `effectiveFrom` in the future, so teams get notice.

Why rule 1 matters: due dates are computed at read time and never stored, so editing an existing entry silently moves deadlines a team has already been given.

Also true, and load-bearing for `sla.ts`, but this time enforced in code, not just documented:

- **A reopen never moves the clock.** An alert reopened after its due date is overdue immediately.
- **Upward re-rating (high → critical)** restarts the critical clock at `severity_changed_at`.
- **Downward re-rating** follows the lower severity's policy.
