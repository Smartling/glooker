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
