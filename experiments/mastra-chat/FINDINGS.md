# Mastra chat experiment — Phase 0 (viability)

Branch: `experiment/mastra-chat`. Date: 2026-09-21. `@mastra/core@1.67.0`.

## Result: the premise is blocked on the current model

Native tool calling — the thing Mastra's agent loop is built on — is **not available
on `anthropic/*` models through the Smartling AI Proxy**. Verified by raw curl, so
this is the platform, not Mastra:

```
anthropic/claude-sonnet-5   REJECTED  .tools only web_search and web_fetch are supported
                            REJECTED  .tool_choice is not supported
google/gemini-3.7-flash     REJECTED  .tools is not supported in Vertex AI chat completions
google/gemini-2.5-flash     REJECTED  .tools is not supported in Vertex AI chat completions
openai/gpt-4o               OK        tools + tool_choice -> returned tool_calls
openai/gpt-5-mini           OK        tools + tool_choice -> returned tool_calls
openai/gpt-5                OK        tools + tool_choice -> returned tool_calls
```

Glooker runs `anthropic/claude-sonnet-5` (GLOOK-45).

### Consequence

`src/lib/chat/agent.ts`'s `TOOL_CALL:` text protocol is **not an unfinished loop —
it is a necessary workaround** for this proxy limitation. Any plan that assumes
"just switch to native tool calling" is wrong on the Anthropic path, for Mastra
and for a hand-rolled loop alike.

## What did work

| # | Question | Result |
|---|---|---|
| 01 | Mastra -> Smartling proxy at all | **OK** — `"Connected."` returned |
| 01 | Model id format | Proxy needs `publisher/model`; Mastra splits on first `/`, so use a throwaway first segment: `smartling/anthropic/claude-sonnet-5` |
| 01 | `max_tokens` | Mastra omits it; proxy's Bedrock backend requires it. Pass `{ modelSettings: { maxOutputTokens: N } }` |
| 02 | Token rotation (~24h expiry) | `apiKey` as fn → 401. `headers` as fn → 401. custom `fetch` → 401. **Rebuilding the Agent per request → OK, rotates.** Mirrors `llm-provider.ts` today |
| 03 | Native tool calling | **Blocked on anthropic/**; works on openai/* |

## Dependency cost (measured)

- `@mastra/core@1.67.0` = **135 packages added**. Glooker had 12 direct deps.
- Pulls `posthog-node` (telemetry — would need disabling), `execa`, `ws`,
  `@modelcontextprotocol/server`, and **three parallel AI SDK provider versions**.
- Forces `zod@4`; `openai@4.104.0` declares peer `zod@^3.23.8` → now unsatisfied.
- No MySQL storage adapter (Postgres/LibSQL only) — Glooker is SQLite/MySQL.

## Open decision

Native tool calling requires moving chat to `openai/*`. That is a product decision
(GLOOK-45 deliberately standardised the app on Sonnet 5), not a technical one.
