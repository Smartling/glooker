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

## Architecture

```
agent → readCurrentPage({ question })
      → tool suspends
      → response: { pendingPageRead: { runId, toolCallId, question } }
client → collects extract → POST { action: 'providePage', runId, toolCallId, extract }
      → run resumes with resumeData = { extract }
      → tool body calls Haiku(extract, question)
      → returns a short answer to the agent
      → agent continues its loop
```

The mechanism is the one already proven on this branch for write approvals
(`createTool({ requireApproval })` + `approveToolCallGenerate`), minus the human.
Here the tool suspends explicitly via its `suspendSchema` / `resumeSchema` rather
than via `requireApproval`.

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
