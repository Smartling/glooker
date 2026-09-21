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

- `@mastra/core` = **135 packages** added; Glooker had 12 direct deps.
- Pulls `posthog-node` (telemetry — needs disabling), `execa`, `ws`,
  `@modelcontextprotocol/server`, three parallel AI SDK provider versions.
- **Forces `zod@4`, which collides with `openai@4.104.0`'s `peerOptional zod@^3.23.8`.**
  Installing `@ai-sdk/anthropic` fails with `ERESOLVE` and needs `--legacy-peer-deps`.
  Resolving it properly means upgrading the `openai` SDK across the whole app.

## Status

Phase 0 complete — viability proven. Phase 1 (port the 7 tools; build the
no-new-deps control arm for comparison) not started.
