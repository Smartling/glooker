# Mastra chat experiment — Phase 0 (viability)

Branch: `experiment/mastra-chat`. `@mastra/core@1.67.0`, `@ai-sdk/anthropic@4.0.58`.

## Headline

**Mastra + Claude Sonnet 5 + native tool calling + multi-step, all through the AI
Proxy — works.** Proven end to end in `spike-04`:

```
TOOLS CALLED : [ 'queryLeaderboard({"metric":"total_commits","limit":1})',
                 'queryOrgSummary()' ]
MULTI-STEP   : YES (2 calls)
ANSWER       : Alice has the most commits with 42 commits, which is 71.2% of
               the org's total 59 commits.
```

That answer requires two tool calls and a derived calculation — something the
current chat agent **structurally cannot do** (it injects "Do NOT output any more
TOOL_CALL lines" after the first tool round).

## The key discovery: it's the shim layer, not the platform

The proxy's **OpenAI-compatible** endpoint rejects custom tools for Anthropic:

```
/compatible/openai/chat/completions
  anthropic/claude-sonnet-5            REJECTED  .tools only web_search and web_fetch supported
  bedrock/anthropic/claude-sonnet-5    REJECTED  (same — provider prefix does not help)
  google/gemini-3.7-flash              REJECTED  .tools is not supported in Vertex AI
  openai/gpt-4o | gpt-5 | gpt-5-mini   OK
```

But the proxy **also** exposes native passthrough routes, and those support tools:

```
/anthropicai/chat            (§7 of the API reference)   stop_reason: tool_use   OK
/amazon-bedrock/converse     (§8.2)                      stopReason: tool_use    OK
```

A full `tool_use` → `tool_result` → final-answer round-trip works on
`/anthropicai/chat` with `model: claude-sonnet-5`, `modelVersion: "latest"`.

So the limitation is in the OpenAI-compatibility layer, **not** in the proxy's
Anthropic support. `src/lib/chat/agent.ts`'s `TOOL_CALL:` text protocol is a
correct workaround for the endpoint Glooker uses — not an unfinished loop.

## How it's wired

`smartling-anthropic.ts` keeps the stock `@ai-sdk/anthropic` provider (which
produces a correct Messages body) and intercepts at the **fetch boundary**:
wraps the body in the Smartling envelope, POSTs to `/anthropicai/chat`, unwraps
`response.data.payload`, injects a fresh bearer. Mastra, tool calling and
multi-turn `tool_result` are then entirely stock.

`MastraModelConfig` accepts `LanguageModelV1..V4`, so an AI SDK provider instance
can be handed straight to `new Agent({ model })`. (The docs page claiming
"string only, no provider objects" is wrong.)

## Integration gotchas found

| Thing | Detail |
|---|---|
| Model id | Proxy wants `publisher/model`; Mastra's router splits on the first `/`. On the OpenAI-compatible path use a throwaway first segment: `smartling/anthropic/claude-sonnet-5` |
| `max_tokens` | Mastra omits it; Bedrock requires it. Pass `{ modelSettings: { maxOutputTokens: N } }` |
| `modelVersion` | `/anthropicai/chat` rejects a blank one. `"latest"` is accepted for `claude-sonnet-5` and `claude-sonnet-4-6` |
| Token rotation | `apiKey`-as-fn, `headers`-as-fn and model-level `fetch` all 401. Works via a provider-level `fetch` (our shim) or by rebuilding the Agent per request |
| `createTool` | v1 signature is positional `(inputData, context)`. v0.x used `({ context })` — a silent behaviour change |

## Limitations

- **No streaming on this route.** `/anthropicai/chat` uses Bedrock `InvokeModel`,
  so `stream: true` is rejected. Not a regression (today's chat returns one
  blocking `NextResponse.json`), but Mastra's streaming advantage does not apply here.
  Streaming + native tools is available only on `openai/*` models.
- **No MySQL storage adapter** (Postgres/LibSQL only) — Glooker is SQLite/MySQL.
  Affects Mastra memory in Phase 2.

## Dependency cost (measured)

Three of these only surfaced by running the repo's own checks after installing —
none of them appear at install time as an error you'd notice.


- `@mastra/core` = **135 packages** added; Glooker had 12 direct deps.
- Pulls `posthog-node` (telemetry — needs disabling), `execa`, `ws`,
  `@modelcontextprotocol/server`, three parallel AI SDK provider versions.
- **Forces `zod@4`, which collides with `openai@4.104.0`'s `peerOptional zod@^3.23.8`.**
  Installing `@ai-sdk/anthropic` fails with `ERESOLVE` and needs `--legacy-peer-deps`.
  Resolving it properly means upgrading the `openai` SDK across the whole app.
- **`--legacy-peer-deps` silently pruned `@testing-library/dom`** (a peer of
  `@testing-library/react`, dev-only, v10.4.1 on main). The install reported
  "removed 9 packages" and **9 test suites then failed** with
  `Cannot find module '@testing-library/dom'`. Fixed by adding it as an explicit
  devDependency; full suite back to 129 suites / 1284 tests green. Anyone adopting
  Mastra here hits this and the error points at the wrong thing.
- **AI SDK provider version skew breaks `tsc --noEmit`.**
  `@ai-sdk/anthropic@4.0.58` resolves `@ai-sdk/provider@4.0.17`; `@mastra/core@1.67.0`
  pins `4.0.4`. `LanguageModelV4.doGenerate`'s return type differs between those
  patches, so handing the provider to `new Agent({ model })` does not typecheck even
  though it runs correctly. Needs an `as any` at that boundary until Mastra bumps —
  and CI runs `tsc --noEmit`, so this would fail CI, not just the editor.

## Phase 1 result: parity

Both arms built from the same `TOOL_DEFINITIONS`, same `executeTool()`, same model
(`claude-sonnet-5`), same route (`/anthropicai/chat`). Run against real data
(org=Smartling, 450 developer rows, 9,344 commits) with `useCache: false`, so the
latencies are genuine generations rather than proxy cache hits.

| Question | CONTROL | MASTRA |
|---|---|---|
| Q1 top 5 by impact | 2 steps, 1 tool, 6.1s, 4440 in | 2 steps, 1 tool, 6.2s, 4776 in |
| Q2 most commits + % of org | 2 steps, 2 tools, 7.0s, 4359 in | 2 steps, 2 tools, 5.8s, 4720 in |
| Q3 same person? | 2 steps, 2 tools, 6.2s, 4324 in | 2 steps, 2 tools, 6.0s, 4660 in |
| Q4 complex commit (bad question) | 6 steps, **no answer**, 20.2s, 14052 in | 6 steps, **no answer**, 28.0s, 32495 in |
| Q5 org size vs top dev | 2 steps, 2 tools, 6.9s, 4374 in | 2 steps, 2 tools, 6.1s, 4725 in |

**On Q1/Q2/Q3/Q5 the two arms picked identical tools with near-identical arguments
and produced equivalent answers.** Latency differences are within noise. Mastra
costs a consistent **~330-370 extra input tokens per call** in scaffolding.

Q4 was a bad question, not a framework difference: the latest report's commits span
2026-02-11..2026-03-13, so "last 90 days" (cutoff 2026-06-23) matches zero rows.
Both arms then failed the same way — retrying with progressively looser filters
until the step cap, rather than reporting "no data in that window". Worth fixing in
the prompt; unrelated to Mastra.

### Findings that apply regardless of Mastra

- **Tool results are uncapped.** `queryCommits limit=100` returns ~8.9k tokens in a
  single result; `queryLeaderboard limit=100` ~3.4k. On Q4 the control arm
  accumulated 70,598 input tokens across steps in an earlier run. The tools should
  cap result size.
- **Neither agent handles an empty filter result well.** Both flail. A prompt rule
  ("if a filtered query returns nothing, say so — do not widen the filter repeatedly")
  would fix both.
- Truncation returns `finishReason: 'length'` with `text: ''` and no error — the same
  "failure indistinguishable from empty" shape as GLOOK-51/54. Any integration must
  check `finishReason` explicitly.

## Verdict so far

At tool-calling parity, Mastra bought **nothing measurable** over ~150 lines of
control-arm code, while costing 124 new top-level packages, ~102 MB, a `zod@4`
conflict needing `--legacy-peer-deps`, a pruned `@testing-library/dom` that broke
9 suites, and a `tsc --noEmit` failure from AI SDK provider skew.

The case for Mastra now rests entirely on Phase 2 differentiators that the control
arm does not have for free: persistent threads/semantic recall, typed durable
workflows, evals, tracing, and its MCP client (which could expose Glooker's
existing 16-tool MCP server to chat instead of the current 7).

---

# Phase 2 — the differentiators

Tested the two that matter for Glooker. Workflows, evals and tracing were **not**
tested; any claim about them is unevidenced.

## A. MCP client — works, worth 26 lines

Mastra's `MCPClient` discovered all **16 tools** from Glooker's own MCP server
(GLOOK-26) against the live dev server, despite that server being POST-only
JSON-RPC with no SSE channel (`GET /api/mcp` returns 405). Tools arrive namespaced
`glooker_*`. Note the method is `listTools()`, not the documented `getTools()`.

Driving those tools, a Mastra agent answered a question **today's chat cannot ask**
— the current 7 tools hardwire `latestReportId(org)`, so no historical or
cross-report question is possible:

> "List the available reports, then compare the org summary between the two most
> recent ones."

It found 50 reports, compared `bfdd0073` (2026-09-09) against `e1dfb529`
(2026-08-10), and reported commits 860 vs 1131, PRs 384 vs 516, AI% 70.1 vs 61.0.
**Verified against the MCP server directly — every figure exact.** (It said "47
reports" where the server returns 50; the headline numbers were all correct.)

**But `control-mcp.ts` replicates the client in 26 code lines** — `initialize`,
`tools/list`, `tools/call` — and returns the identical 16 tools and identical data.
For a single local POST-only server, Mastra's MCP client is a convenience, not a
capability. It would be worth much more against third-party servers needing OAuth,
stdio, SSE or reconnection; Glooker has none of those.

## B. Persistent memory — real, and genuinely not free

`Memory` + `LibSQLStore` survives a process restart: pass 1 stated a fact, a
**fresh process** in pass 2 recalled `@sduiev-smartling` / 128 correctly. The
current chat cannot do this at all — `chat-panel.tsx` holds messages in React
state and resends them; nothing is persisted server-side.

Costs:
- `LibSQLStore` requires an explicit `id` (fails with "id must be provided").
- It provisioned **44 tables in a 577 KB SQLite file to store 4 messages** —
  Mastra lays down its whole platform schema (workflows, scorers, datasets,
  skills, knowledge, channels, notifications, workspaces) whether used or not.
- **No MySQL adapter**, so this is a second datastore beside Glooker's MySQL.
- **Semantic recall is not included**: the docs state it "requires a vector store
  and embedder to be configured". Untested, and it would need more infrastructure
  (the proxy does expose `/compatible/openai/embeddings`, so it is feasible).

The control-arm equivalent of *plain thread persistence* is one table plus
load/save in the DB Glooker already has — call it 80 lines and a migration in
both `db/mysql.ts` and `db/sqlite.ts`. Semantic recall is where Mastra would
genuinely pull ahead, and that is exactly the part still unproven.

## Final dependency bill

**211 new top-level packages**, 19 direct deps (main had 12), ~135 MB
(`@mastra` 105M, `@ai-sdk` 14M, `zod` 8M, `@libsql` 8.4M). Plus: `--legacy-peer-deps`
required, the `@testing-library/dom` pruning that broke 9 suites, and the
`tsc --noEmit` provider-skew cast. Suite and typecheck are green on this branch.

## Recommendation

**Don't adopt Mastra for this.** On the thing chat actually does — pick a tool,
call it, reason over the result — the control arm matched it exactly on 4 of 5
questions while costing 211 fewer packages. The two Phase 2 wins are a 26-line
MCP client and thread persistence that needs a second datastore.

**Do take the three findings the experiment produced**, which are worth more than
the framework question:

1. `/anthropicai/chat` supports native Claude tool calling through the AI Proxy.
   The `TOOL_CALL:` text protocol can be retired, and the one-tool-round ceiling
   in `agent.ts` with it. `control-agent.ts` is a working implementation.
2. Chat should consume the existing 16-tool MCP server instead of its own 7.
   `control-mcp.ts` is 26 lines and already works.
3. Tool results are uncapped (`query_commits limit=100` ≈ 8.9k tokens), and
   neither agent handles an empty filtered result — both flail until the step cap.

Revisit Mastra if Glooker needs semantic recall over long histories, durable
workflows, or third-party MCP servers with real transports.

---

# Wiring it into the app (local deploy)

The experiment scripts were standalone, so nothing in the app changed. To make it
playable, `/api/chat` now dispatches on an `engine` field:

- `legacy`  — the existing `TOOL_CALL:` text protocol, 7 direct-DB tools
- `control` — native Anthropic tool calling via `/anthropicai/chat`, **16 MCP tools**, no framework
- `mastra`  — Mastra agent, same model/route/tools

`CHAT_ENGINE` sets the default (`control`); `chat-panel.tsx` has a selector plus a
per-answer diagnostics line (engine, tools available, calls made, elapsed) so the
three can be compared live.

## Deployment costs found only at build time

- **Node 22 is required.** `@mastra/*` all declare `engines.node >= 22.13.0`; the
  Dockerfile was `node:20-alpine`. Bumped both stages to `node:22-alpine`. This
  would apply to the AWS image too.
- **`npm ci` fails in the image** with the same `zod@4` vs `openai@4` ERESOLVE, even
  though `npm ci --dry-run` passes locally against an already-installed tree.
  Needs `npm ci --legacy-peer-deps` in the Dockerfile.
- **`serverExternalPackages`** needed `@mastra/core`, `@mastra/mcp`, `@mastra/memory`,
  `@mastra/libsql`, `@libsql/client` added, or the standalone build inlines
  server-only deps.

With those three changes: `npm run build` succeeds, 129 suites / 1284 tests pass,
`tsc --noEmit` is clean, and the image runs.

## Live results (local, 70-report DB)

Same question to all three engines — "how many reports exist, and how did total
commits change between the two most recent?":

| engine | tool calls | time | outcome |
|---|---|---|---|
| control | 4 | 12.0s | correct: 860 vs 1131, -271 (-24.0%) |
| mastra | 4 | 27.7s | correct: same figures |
| legacy | 0 | — | correctly says it cannot do this at all |

`legacy` is not being unfair to itself: its 7 tools hardwire `latestReportId(org)`,
so cross-report questions are genuinely impossible.

## New finding: `list_reports` has no total, and the model miscounts

Both new engines reported **62-63** reports when the real count is **70**.
`list_reports` returns only `{ reports: [...] }` — no `total` field — and caps at 50
by default, so both agents called it twice (50 rows, then 70 with `limit:500`) and
then miscounted the list by hand. Adding a `total` to that tool's response removes
the need to count at all. Same family as the uncapped-result finding above.

---

# Approval-gated writes (the one thing Mastra clearly wins)

Mastra ships human-in-the-loop as a first-class primitive:
`createTool({ requireApproval: true })` plus `approveToolCallGenerate()` /
`declineToolCallGenerate()` on the agent. The run reaches `finishReason:
'suspended'` and **the tool body never executes** until a human approves the
exact arguments.

Implemented one write tool, `startReportRun` (`src/lib/chat/engines/write-tools.ts`),
on the mastra engine only. Verified against the live local deploy:

```
reports before                      70
ask "start a 14 day report run"  -> finishReason suspended
                                    pendingApproval {runId, toolCallId,
                                    toolName: startReportRun, args:{periodDays:14}}
reports after suspend               70   <- tool did not run
decline                          -> "wasn't approved, so I didn't start it"
reports after decline               70
```

Two gates, deliberately independent: `requireApproval` (Mastra suspends), and
admin — checked in the tool against the caller's resolved identity **and** again
by `requireAdmin` inside `POST /api/report`, which the tool calls with the
caller's auth header forwarded.

Write tools are **not** on the MCP server: that server is read-only by design
(GLOOK-26) and is exposed to Claude Desktop via the mcp-okta-proxy sidecar, so a
write tool there would be reachable by every MCP consumer.

## Non-obvious gotchas found

- **Storage must be on the `Mastra` instance, not the `Agent`.** An Agent built
  with `storage` cannot resume — `approveToolCallGenerate` reports "could not find
  a suspended run". Register the agent via `new Mastra({ agents, storage })` and
  retrieve it with `mastra.getAgent()`.
- **`libsql` native binding breaks the standalone build twice over.** Next's
  tracer cannot follow libsql's runtime platform `require`, so
  `node_modules/libsql/**` and `node_modules/@libsql/**` need explicit
  `outputFileTracingIncludes` entries. And building `linux/amd64` under QEMU on an
  arm64 host, npm's libc detection installs `linux-x64-gnu` into an Alpine (musl)
  image, so the musl binding must be forced:
  `RUN npm i --no-save --force @libsql/linux-x64-musl`. Without both, the
  container starts and then 500s with
  `Cannot find module '@libsql/linux-x64-musl'`.

## Revised verdict

Read-only Q&A: parity held, dependency not justified (211 packages).
**Approval-gated writes: Mastra has a real primitive the control arm would have to
build from scratch** — durable suspended state across HTTP requests and processes.
If Glooker wants chat to write, that changes the calculation. If it stays
read-only, it does not.

---

# Page-context-aware chat: tiers 1-3, and the kill gate (2026-09-22)

Branch `experiment/mastra-chat`, on top of the control-arm chat above. Design:
`docs/superpowers/specs/2026-09-22-page-context-aware-chat-design.md`. Full
build ledger: `.superpowers/sdd/2026-09-22-page-context-aware-chat/progress.md`.

## What shipped

Tiers 1 and 2 of the three-tier design, across all 9 routes. Tier 3 was built,
gated, and deleted — see below.

- **Tier 1** (`src/lib/chat/context/registry.ts`) — 9 registry entries, one per
  route (`/`, `/report/[id]/org`, `/report/[id]/team`, `/report/[id]/dev/[login]`,
  `/reports`, `/projects`, `/profile`, `/settings`, `/debug/headers`). Matching is
  structural and positional against path segments (`findEntry`), not
  value-substitution — a report id whose value happens to equal a literal segment
  elsewhere in the URL (e.g. `id=org`) cannot produce a false miss. Caught in
  review before it shipped (commit `1c32af6`).
- **Tier 2** (`src/lib/chat/context/enrich.tsx`, `useEnrichPageContext`) — applied
  to 2 of the 9 pages: the developer page (Claude Code spend, commits, PRs) and
  the org report page (developer count, total commits). Ownership-tracked
  (commit `efbe971`) so a stale unmount can't null out a still-mounted page's
  enrichment.
- **Chip UI** — `chat-panel.tsx` renders the active `PageContext` as a removable
  chip; `source: 'inferred'` (had tier 3 shipped) renders with a muted provenance
  marker so a guess never reads as a fact.
- **Per-kind suggestions** — the `SUGGESTIONS` list is seeded per registry entry
  (e.g. the dev page offers "Why did spend change?", "What did they ship?").
- All 9 routes now mount `ChatPanel` (3 already did; 6 added). One mid-task
  correction: `report/[id]/dev/[login]` was first wired to an org auto-resolver
  that reads the *latest* report's org via `/api/llm-config`; review caught that
  this page can show a historical report whose org differs from the latest, which
  would have silently scoped the chat to the wrong org. Fixed to use the page's
  own `report.org`, matching the org and team pages' pattern.

## Where context helped, and where it didn't

Reported plainly, per Task 5's own assessment of its 6 newly-mounted pages plus
the 2 tier-2 enrichment sites — this is experiment data, not a shortfall to
soften. (Home and the team report page pre-dated the experiment's chat mounts
and were not separately assessed here.)

| Page | Verdict |
|---|---|
| `/report/[id]/dev/[login]` | Helped. Tier 2 gives exact spend/commits/PR figures the chat anchors "why did spend change" against. |
| `/report/[id]/org` | Helped. Tier 2 gives developer count and total commits for comparison questions. |
| `/projects`, `/profile` | Helped. Both show concrete developer/project figures; tier 1's free label is enough to scope questions usefully even with no tier-2 enrichment. |
| `/reports` | Ambiguous. This page's job is launching and monitoring report runs, not Q&A — a chat panel next to a live progress bar competes for the same screen real estate for an unrelated task. Unresolved without real usage data. |
| **`/settings`** | **Added nothing.** Entirely configuration management (schedules, teams, Jira mappings, connection tests). No tab surfaces developer-impact numbers, so the chat has nothing page-specific to anchor on and falls back to generic org-wide suggestions unrelated to whatever the user is actually configuring — indistinguishable from having no page context at all. |
| **`/debug/headers`** | **Added nothing.** Internal, unlinked debug page dumping raw request headers and decoded OIDC JWTs. No plausible flow pairs debugging auth headers with asking about developer performance. The chat bubble is inert decoration. |

Net: 2 of 9 pages got a measurable benefit from tier 2; 2 more ride usefully on
tier 1's free label alone; 1 is genuinely contested; 2 (`settings`,
`debug/headers`) added nothing and would be the first cut if this experiment's
scope narrows.

## Preamble cost vs. the 300-token budget

Measured (Task 2 review) on a realistic 8-key-figure enriched preamble —
`MAX_FIGURES = 8` is a hard cap in `buildPreamble()` — this is a realistic
measured case from the current registry, **not a bound**: **455 characters,
~114 tokens**, well inside the 300-token budget. At the time of this
measurement `label` and each figure's text had no length cap, so a crafted
`pageContext` (a long URL segment, or a direct `/api/chat` call bypassing the
UI) could inflate this arbitrarily — see the code-review fix that added
length caps in `buildPreamble()`. With those caps in place (label/kind ≤120
chars each; ≤10 params and ≤10 filters at ≤64 chars per key/value; ≤8 key
figures at ≤40 chars each), the preamble now has an actual worst case of
~3.8KB (~950 tokens) — still finite, but well above the 300-token budget in
that maximally adversarial case; ordinary registry-driven pages stay far
below it, near the measured 455-character figure. Key figures are gated
behind an allowlist (`ctx.source === 'enriched'` only, closed by default) — a
route- or inferred-sourced context is cheaper still: label and identifiers,
no figures.

## The tier-3 kill gate — reported in full

Tier 3 (`inferPageContext`: a bounded, instrumentation-free page-text extract →
Haiku classification → `{kind, label}`) was built, scored against a
pre-committed gate, and deleted for missing the bar. Both numbers below are
real; neither should stand alone.

**The scored calls did not actually run on Haiku.** `claude-haiku-4-5` — the
model the design specifies — was believed at the time to be rejected outright
by this AI Proxy account (see the standalone finding below as it read then:
every Haiku identifier tried returned "invalid model identifier"). **That
belief was wrong — see the correction below.** The account-unavailability
explanation did not hold; the actual defect was passing `modelVersion:
"latest"` for a dated model. That does not change the score itself (the
substitution was still what actually ran, and 1/5 is still 1/5), but it does
mean the *reason given* for why substitution was necessary was false, and nothing
downstream should keep citing "Haiku is unavailable on this account" as a fact.
To get a real accuracy signal for the
extract→infer→parse mechanism itself, the scored calls substituted
`claude-sonnet-4-6` — a materially *more* capable model than the one
specified — then the source was reverted to the specified `claude-haiku-4-5`
before this task finished. So the score below answers "does inferring a
descriptor from the page extract help at all", not "is Haiku 4.5 specifically
bad at this" — and it answers harder against tier 3 than a same-capability
comparison would: a stronger-than-specified model still only reached 1/5, so
the result cannot be explained away as the substitute model being too weak.

- **Pass condition, fixed before running:** ≥4/5 correct with tier 3 vs. the
  generic (no-context) fallback, on 5 questions answerable only with page
  context — scored on the real `/settings` page with `/settings` temporarily
  removed from the tier-1 registry to force the tier-3 path.
- **Result: tier 3 (via the `claude-sonnet-4-6` stand-in) scored 1/5; the
  generic fallback scored 0/5.** Against the ≥4/5 bar, the gate failed and
  tier 3 was deleted per the plan's pre-commitment.
- **Cost per inference call: ~559 tokens (544 input + 15 output), ~$0.0006** —
  measured against the same proxy request shape at Haiku 4.5 list pricing
  ($1/$5 per Mtok), i.e. the cost tier 3 would have carried had Haiku been
  invocable here. Cost was never the blocker.

**But the gate itself was badly designed, and that has to be said as plainly as
the failing score.** Four of the five questions — "what can I configure here?",
"is anything misconfigured?", "what is the LLM provider set to?", "how many
teams are configured?" — require app-config data (`/api/llm-config`,
`/api/teams`) that no MCP tool exposes. Glooker's 16 MCP tools are all
report/analytics tools; neither arm had any path to a correct answer on those
four, regardless of inference quality. Those four questions have **zero
discriminating power** between the two conditions — both scored 0/4 on them,
for a reason structural to the tool surface, not to tier 3.

The fifth question — "what page am I on?" — is the one question that actually
tests what tier 3 is built to do: name the view. On that question, **tier 3
answered correctly ("App Settings") and the generic fallback answered
incorrectly** ("I don't have access to any UI/session context... I can't see
what page you're currently viewing").

So there are two honest numbers, and the reader should hold both: **1/5 against
the pre-committed bar** — the number that killed it, correctly, since the bar
was fixed before the run precisely so it couldn't move afterward — and **1/1 in
tier 3's favour** on the only question that measured what tier 3 actually
claims to do. The deletion stands: a gate result is a gate result, and a
separate, independent problem (below) means tier 3 as specified couldn't ship
here even with a passing score. But a future attempt at tier 3 should design a
gate where all five questions are answerable from a bounded page extract, not
from app config the extract never contains.

## Correction (2026-09-23): the "Haiku is unavailable on this account" finding above was wrong

This section previously claimed catalog availability is not account
invocability — that `/anthropicai/chat` rejects every Haiku identifier tried,
reading as an account/region Bedrock provisioning gap. **That claim is false,**
and it should not be treated as a fact by anyone reading this document,
including anyone who already relayed it to the Data team.

What was actually wrong: every one of those probes passed `modelVersion:
"latest"`. That value is accepted for undated models (`claude-sonnet-5`,
`claude-sonnet-4-6`), which is why the probe worked for both of those and
looked like it should generalize. It does not generalize: `claude-haiku-4-5`'s
catalog entry is **dated** and has `alias=false`, and `/anthropicai/chat`
rejects `"latest"` for a dated, non-aliased model. That's a model-identifier
mistake in the probe, not an account-provisioning gap.

**Verified 2026-09-23:** `model: "claude-haiku-4-5"` with `modelVersion:
"20251001"` — the model id and its dated version passed as two separate
fields, never concatenated into one string like `claude-haiku-4-5-20251001`
— returns 200 on this same account. `src/lib/chat/context/summarize-page.ts`
hardcodes exactly this split (`HAIKU_MODEL = 'claude-haiku-4-5'`,
`HAIKU_MODEL_VERSION = '20251001'`), and `experiments/mastra-chat/
spike-09-page-read.ts` proves the full round trip against the live proxy —
see "Page-read tool: proved live" below.

**Consequence for the tier-3 kill gate above:** the gate's own accuracy result
stands — 1/5 against a ≥4/5 bar is still a failing score, regardless of which
model produced it, and tier 3 was correctly deleted on that basis. But **the
reason offered for substituting `claude-sonnet-4-6` in place of the specified
Haiku model — "Haiku is rejected outright by this AI Proxy account" — did not
hold.** The substitution happened because of a probe bug, not a platform
limitation, and should not be cited as evidence that Haiku is unavailable
here.

**The replacement for tier 3 is not a restoration of the deleted inference
code.** It is the model-invoked `readCurrentPage` tool built in
`.superpowers/sdd/2026-09-23-model-invoked-page-read/`: instead of Haiku
speculatively classifying a page-text extract into a `{kind, label}`
descriptor on every turn (tier 3's design), the already-running Sonnet agent
decides for itself, per question, whether it needs the page at all, and only
then triggers a bounded extract plus a scoped Haiku call answering that one
question. Tier 3 is not coming back under a different name — this is a
different mechanism, invoked differently, for a different purpose, that
happens to exercise the same Haiku-through-the-proxy path tier 3's kill gate
was trying to use.

---

# Page-read tool: proved live (2026-09-23)

Build ledger: `.superpowers/sdd/2026-09-23-model-invoked-page-read/`. This is
the model-invoked replacement referenced in the correction above: the agent
itself decides, per question, whether it needs to see the page, calls
`readCurrentPage`, the run suspends, the client supplies a page extract, and
Haiku answers from it.

`experiments/mastra-chat/spike-09-page-read.ts` runs this end to end against
the real proxy — the real `buildPageReadTool()`, the real `page-store.ts`
handoff, and the real `answerFromPage()` Haiku call, not stand-ins. Only the
data tool and the "current page" text are synthetic, the same way spike-08
stood in a fake write tool to exercise the real approval-suspend primitive.

**Did the model reach for the tool?** Yes. Asked "There's a banner at the top
of this settings page right now — what does it say? I want to know if I need
to do anything about it." — a question no data tool and no route-level page
descriptor could answer — the agent, running the unmodified production
`CHAT_SYSTEM` prompt (which does name `readCurrentPage` and instructs the
agent to use it for screen references; this was not a zero-shot discovery),
followed that instruction and called the tool rather than guessing an answer
or telling the user it couldn't see the screen. This is the answer to the
"under-invocation" risk the task called out as the most likely failure mode:
on this question, invocation worked.

**Suspend/resume, verified:**
- `finishReason: 'suspended'`, `suspendPayload.toolName: 'readCurrentPage'`,
  with `runId`, `toolCallId`, and the agent's own `args.question` all present
  — exactly the shape `mastra.ts`'s `pendingFrom()` turns into
  `EngineResult.pendingPageRead`.
- The tool's `execute` body was wrapped with an instrumentation flag (without
  touching production code) and asserted `false` at this point — **the tool
  body did not run before the extract was supplied.**
- After `putPageExtract(runId, syntheticExtract)` and
  `approveToolCallGenerate({ runId, toolCallId })`, the flag flipped to `true`
  and the agent produced a final answer quoting the synthetic banner text
  correctly and drawing the right conclusion from it (see the transcript in
  the task report).

**Haiku call, measured (two independent runs, same question/extract):**
`model: "claude-haiku-4-5"`, `modelVersion: "20251001"` (split fields, per the
correction above) — **135 input tokens, 59 output tokens**, both runs
identical. At Haiku 4.5 list pricing ($1/$5 per Mtok) that's
`0.135e-3 + 0.295e-3 ≈ $0.00043` per page-read call. The measured wall-clock
round trip varied sharply between the two runs (3.6s vs. 0.26s for an
identical request) — almost certainly the AI Proxy's own request cache on a
repeated identical body, not a property of the mechanism; the token counts,
not the latency, are the number to trust here.

## The asymmetry this creates (the first Mastra-only capability)

`readCurrentPage` exists **only** on the mastra engine. It cannot be ported to
the control arm as written, and that's structural, not a missing 26 lines like
the MCP client above: the control arm (`control-agent.ts` / `runControlEngine`)
is a plain request/response loop over `/anthropicai/chat` with no suspend
primitive and no persisted run state between HTTP requests. `readCurrentPage`
depends on both — the run has to stop mid-generation, hand control back to an
HTTP response, survive until a second, later HTTP request supplies the page
extract, and then resume the *same* in-progress generation with the tool's
result spliced back in. That's exactly the `requireApproval` suspend primitive
and the `Mastra` instance's `LibSQLStore`-backed run storage that the
approval-gated-writes section above already established Mastra provides and
the control arm does not.

Building the control-arm equivalent would mean building a bespoke
suspend/resume protocol from scratch — persisting the partial tool-call state,
the conversation so far, and enough to reconstruct the exact in-flight request
— which is a materially bigger lift than "add a tool", and is precisely the
kind of durable-run-state primitive this experiment's Phase 1 parity result
said the control arm didn't need. It would need it now.

Report both halves plainly, because they cut in opposite directions:

- **This is real evidence for adoption.** After a headline finding of parity
  — the two arms picking the same tools, producing equivalent answers, at
  comparable cost — this is the first capability in the whole experiment that
  only Mastra provides. Approval-gated writes showed Mastra *has* this
  primitive; this shows a second, independent feature actually needed it and
  got built on top of it.
- **It is simultaneously the end of the like-for-like comparison.** Every
  finding before this one held over a single question answerable through both
  arms' identical tool-calling paths. `readCurrentPage` is not that: it is a
  Mastra-only feature with no control-arm counterpart to compare it against,
  by construction. From here forward, "control vs. mastra" and "read-only vs.
  approval/page-aware chat" are two different axes, not one.
