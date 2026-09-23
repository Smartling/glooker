# Model-Invoked Page Read — Design

**Date:** 2026-09-23
**Branch:** `experiment/mastra-chat`
**Status:** approved; implementation pre-authorised

## Goal

Let the chat agent decide, mid-conversation, that it cannot answer from the
context it has — and fetch the page's own content to close the gap. Expose this
as a **tool the model calls**, not a heuristic the server guesses at, and make
the tool's existence explicit in the system prompt.

This supersedes the deleted tier 3, which inferred context on a *registry miss*.
That trigger was structural and decided before the model ran, so it could never
help on a page that **is** registered but whose descriptor is too thin for the
question actually asked.

## Correction to the record

Two claims in `experiments/mastra-chat/FINDINGS.md` and
`docs/recommendations/2026-09-22-dashboard-chat-context.md` are false and must be
fixed as part of this work:

- **Haiku is invocable on this account.** Verified 2026-09-23:
  `/anthropicai/chat` with `model: "claude-haiku-4-5"`, `modelVersion: "20251001"`
  returns 200, as does `/compatible/openai` with
  `anthropic/claude-haiku-4-5-20251001`. The earlier probe passed
  `modelVersion: "latest"`, which works for undated models (`claude-sonnet-5`)
  but not for Haiku, whose catalog entry is dated and carries `alias=false`.
- **Tier 3's deletion therefore rested on nothing that holds.** The final review
  had already judged the 1/5 kill-gate score unsound as justification — 4 of the
  5 questions required app-config data no MCP tool exposes, so neither arm could
  answer them — leaving Haiku unavailability as the only load-bearing reason.
  That reason was wrong. The docs must say the deletion was mistaken, not
  vindicated. The replacement design is better regardless, which is why the code
  is not simply restored.

## Non-goals

- **No approval gate.** The suspend/resume round trip carries data, not consent.
  The client answers automatically; the user sees a "reading the page" indicator,
  not a prompt.
- **No replacement of tiers 1 and 2.** The route descriptor and page-declared key
  figures are cheap, exact and already shipped. This tool covers what they cannot.
- **No page text in the prompt by default.** Content crosses the wire only on the
  round trip the model triggers.
- **Control arm does not get this tool.** See "The asymmetry" below.

## Architecture — transport verified by probe, not assumed

**`createTool`'s `suspendSchema`/`resumeSchema` do NOT work for agent-invoked
tools.** Probed 2026-09-23: the execute context for an agent tool exposes
`mastra, memory, runId, requestContext, actor, workspace, browser, observe,
writer, tracing, metrics, abortSignal, agent, workflow` — and **no `suspend`**.
Those schemas are for workflow steps. `approveToolCallGenerate` also does not
forward a `resumeData` payload to the tool body (verified: arrives `undefined`).

What does work, proven end to end:

```
agent  → readCurrentPage({ question })
       → requireApproval suspends the run   (finishReason 'suspended', body NOT run)
       → { pendingPageRead: { runId, toolCallId, question } }
client → collects extract → POST { action:'providePage', runId, toolCallId, extract }
route  → pageStore.set(runId, extract)
       → agent.approveToolCallGenerate({ runId, toolCallId })
tool   → body runs, reads pageStore.get(ctx.runId)
       → Haiku(extract, question) → short answer → agent continues
```

`requireApproval: true` is used purely as a **suspend primitive**, not as a
consent gate — the client answers it automatically and the user never sees a
prompt. The extract travels through a per-run store keyed by `ctx.runId`, which
is the same `globalThis` idiom the repo already uses for the progress and
stop-signal stores.

**Known limitation, to be recorded rather than solved here:** that store is
per-process, so the `providePage` request must reach the same replica that
suspended the run. Dev runs a single ECS task, so this holds today. The durable
fix is persisting the handoff alongside the run snapshot — the same open
follow-up already recorded for GLOOK-54's retry marker.

## Prompt wording is load-bearing — measured

The probe's first instruction ("If asked about the screen, call
readCurrentPage") produced **no tool call at all**; the model answered from
nothing. Rewording to state plainly that the agent *cannot* see the screen and
that the tool *is* how it looks produced the call immediately. Under-invocation
is the most likely failure mode, and the prompt is the control for it.

## The asymmetry, and why it matters

The control arm is a hand-written loop with no suspend/resume and no persisted
run state. Implementing this there means inventing that machinery: returning a
pending marker mid-loop, having the client re-post, and rebuilding the
conversation with the tool-use block intact.

**So the control arm will not have `readCurrentPage`.** After an experiment whose
headline finding was parity, this is the first capability only Mastra provides.
That is genuine evidence for adoption and must be reported as such — and it is
also the point at which the like-for-like A/B comparison ends, which must be
reported just as plainly.

## Components

| File | Responsibility |
|---|---|
| `src/lib/chat/context/page-extract.ts` | `PageExtract` type; `clampExtract()` — whitespace-collapse and cap |
| `src/lib/chat/context/summarize-page.ts` | `answerFromPage(extract, question)` → Haiku via `/anthropicai/chat` |
| `src/lib/chat/context/page-read-tool.ts` | `buildPageReadTool()` — the Mastra tool with suspend/resume |
| `src/lib/chat/engines/mastra.ts` | register the tool; handle the resume path |
| `src/app/api/chat/route.ts` | new `action: 'providePage'` |
| `src/app/chat-panel.tsx` | auto-answer `pendingPageRead`; "reading the page" indicator |
| `src/lib/chat/engines/types.ts` | system-prompt paragraph naming the tool |

## The extract

Collected client-side with **zero page instrumentation**, so it works on any
page including ones nobody has registered:

- `document.title`
- the first `<h1>`
- `innerText` of `<main>`, falling back to `<body>`

Whitespace-collapsed, capped at **4000 characters**. No `data-*` attributes, no
per-page opt-in.

## Making the tool discoverable

`CHAT_SYSTEM` gains a paragraph that names the tool, says when to reach for it,
and states that its answers are **read off the screen, not fetched from the
database**. Without this the model will rarely call it — under-invocation is the
most likely way this feature quietly fails, exactly as the deleted tier did.

Draft wording:

> You can call `readCurrentPage` when the user refers to something on their
> screen that your data tools cannot resolve — an unfamiliar page, a label or
> section you have no tool for, or a question about what they are looking at.
> Pass the question you actually need answered. What comes back is read off the
> rendered page, not fetched from the database: treat it as context, say where it
> came from, and never present it as a verified figure.

## Model

`claude-haiku-4-5`, `modelVersion: "20251001"`, via the existing
`/anthropicai/chat` envelope (same shape as `control.ts`'s `callProxy`).
`max_tokens: 300`, 8s timeout. ~$0.0006 per call.

## Error handling

Every failure degrades; none blocks the chat.

| Failure | Behaviour |
|---|---|
| Client never supplies the extract (15s) | Tool resolves `"page content unavailable"`; agent continues on tier 1/2 |
| Client sends an empty extract | Same |
| Haiku call errors or times out | Tool resolves `"could not read the page"`; agent continues |
| Resume arrives for an unknown `runId` | 400 with a clear message; chat state untouched |

The tool **resolves** rather than throws in every case, so a page-read failure
can never take down an answer the agent could otherwise have given.

## Testing

- `clampExtract` — whitespace collapse, 4000-char cap, missing fields.
- `answerFromPage` — envelope shape (model/modelVersion split), error and timeout
  paths return null rather than throwing.
- Tool suspend/resume — suspends without an extract; resumes and calls Haiku with
  the supplied extract; a non-vacuous test proving the tool body does not run
  before resume.
- Route — `action: 'providePage'` reaches the resume path; unknown `runId` 400s.
- jsdom — the panel auto-answers `pendingPageRead` without user interaction and
  shows the indicator.
- Full suite stays green (currently 133 suites / 1332 tests) and `tsc --noEmit`
  clean.

## Risks

- **Under-invocation.** The model may simply never call the tool. Mitigated by
  the prompt paragraph; measured by exercising it on an unregistered page and
  checking the tool actually fires.
- **Two models in a chain.** Haiku can garble what it reads. Mitigated by
  labelling the result as read-from-screen and instructing the agent not to
  present it as verified data — never as a number it would otherwise fetch.
- **Latency.** A tool call now costs a client round trip plus a Haiku call.
  Acceptable because it only happens when the model asks.
