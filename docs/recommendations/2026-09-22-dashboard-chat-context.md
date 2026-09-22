# Page context for the Smartling Dashboard AI chat

**Date:** 2026-09-22
**Audience:** Smartling Dashboard team
**Source:** the page-context-aware chat experiment on Glooker's
`experiment/mastra-chat` branch — design at
`docs/superpowers/specs/2026-09-22-page-context-aware-chat-design.md`, build
ledger at `.superpowers/sdd/2026-09-22-page-context-aware-chat/progress.md`,
measured findings at `experiments/mastra-chat/FINDINGS.md`.

Glooker just shipped page-context-aware chat across all 9 of its routes. This
is not a proposal to copy that code — the two apps don't share a codebase.
It's a report on what the design proved, what its own kill gate disproved, and
which specific pieces are worth the Dashboard team's time to build themselves.

## 1. The category argument

There are two ways an in-app assistant can be told what a user is looking at,
and which one is correct depends on one property of the product: does a
governed query layer sit underneath the view, or is the view itself the
content.

Products with a governed data layer send a *descriptor* of the view and
re-fetch the real numbers under the viewer's own identity at answer time.
Conversational Analytics in Looker is built this way — it grounds Gemini on
the LookML semantic layer rather than on the rendered rows of a dashboard
tile, and Google reports that this kind of semantic-layer grounding cuts
natural-language query errors by up to two thirds compared to letting the
model reason directly over raw tables.[^looker] Datadog Bits states the same
shape from the access-control side: it "uses your Datadog role to fetch data,
so it can only access the resources you have permission to view."[^datadog]
That sentence is only true if Bits re-queries under the caller's role every
time it answers — a cached or forwarded snapshot from a different request
context could not make that guarantee.

Products where the artifact *is* the content send the content itself, because
there is no semantic layer underneath a source file to query instead of
reading it. Copilot and Cursor ship file contents and the active selection for
exactly this reason: the text on screen and the text the user means are the
same bytes, with nothing to re-derive.

Glooker and the Smartling Dashboard are both the first category, not the
second. Both sit on a governed query layer with per-viewer visibility rules
that a naive "read what's rendered and hand it to the model" approach would
bypass. In Glooker, `cost-visibility.ts` strips per-developer spend figures
for anyone outside the viewer's team, and the context layer enforces this at
the prompt boundary: `buildPreamble()` (`src/lib/chat/context/preamble.ts`)
gates every key figure behind `ctx.source === 'enriched'` — closed by
default — so a route-derived or model-inferred descriptor can carry a label
and identifiers but never a number. Every figure the agent states has to come
back through its 16-tool MCP query layer, which runs under the caller's
identity and therefore respects the same visibility rules as the rendered
page. The Dashboard has the same shape of problem one level up: project,
account and job metrics are gated by account and project role, and an
assistant grounded on a snapshot of whatever chart is on screen would need to
separately re-verify that the same viewer is still allowed to see that same
number by the time it answers. Descriptor-plus-re-fetch closes that gap by
construction — there is no snapshot to leak, because there is no snapshot.

## 2. The tiered architecture, and the honest state of tier 3

Glooker built three tiers, in decreasing order of certainty and increasing
order of coverage:

| Tier | Mechanism | Cost | Coverage |
|---|---|---|---|
| 1 | Route registry → static descriptor | free, deterministic | all registered routes |
| 2 | Page declares its own key figures | free, exact | pages that opt in |
| 3 | LLM classification of a generic page-text extract | ~$0.0006/call | registry misses only |

Tier 3's job is not to add new capability — it never grants the agent a value
that its own query tools couldn't otherwise produce, and by design it can
never emit a key figure at all. Its job is narrower and more structural: it
is what turns "context-aware chat" from a big-bang precondition into an
incremental rollout. Without a fallback for unregistered pages, a team would
have to instrument every page before shipping anything. With one, tier 1 can
cover an entire app on day one, and tier 2 gets added opportunistically,
page by page, wherever a team decides the payoff is worth the enrichment
code. That argument holds up in the abstract regardless of what happened
next in this experiment.

What happened next: Glooker's own tier 3 was killed. The pre-committed bar was
≥4 of 5 correct answers with tier 3 versus the same 5 questions on a generic
(no-context) fallback; the measured result was 1/5 with tier 3 against 0/5
generic. Against that bar, the gate failed and the code was deleted, exactly
as the plan required. That result should not be softened.

That score was not measured with the specified model. `claude-haiku-4-5` is
rejected outright by the AI Proxy account this experiment ran on — Section 6
has the full finding. To still get a real accuracy signal for the mechanism,
the scored calls substituted `claude-sonnet-4-6`, a materially *more*
capable model, then the source was reverted to the specified Haiku model
before the task closed. So 1/5 answers "does inferring a descriptor from a
page-text extract help at all," not "is Haiku 4.5 bad at this specifically" —
and it is, if anything, a harder result for tier 3 to explain away: a
stronger-than-specified model still only reached 1/5, so the outcome is not
an artefact of an underpowered classifier.

It also should not be taken at face value without its own caveat: four of
the five test questions ("what can I configure here?", "is anything
misconfigured?", "what is the LLM provider set to?", "how many teams are
configured?") depend on app-config data that lives behind Glooker's `/api/
llm-config` and `/api/teams` endpoints — data no MCP tool exposes to the
agent at all. Neither the tier-3 arm nor the generic arm could answer those
four regardless of how good the page inference was, so they carried zero
discriminating power between the two conditions. The one question that
actually tested what tier 3 is built to do — "what page am I on?" — tier 3
answered correctly and the generic fallback did not. So the full, honest
picture is two numbers, not one: 1/5 against the pre-committed bar (the
number that correctly killed it, since the bar was fixed in advance so it
couldn't move after the fact) and 1/1 in tier 3's favour on the only question
that measured page-identity inference rather than app-config lookup.

The recommendation for the Dashboard team is to adopt the *shape* — a
registry- and enrichment-driven system with an explicit, gated fallback for
unregistered views — without assuming that a Haiku-style classification
fallback specifically will clear its own bar on the first try. If the
Dashboard team builds an equivalent tier 3, its kill-gate questions should be
answerable from what a bounded page-text extract can actually contain (page
identity, gross visible labels), not from configuration or data that lives in
a system the extract has no path to. That was this gate's design flaw, not a
property of the mechanism itself.

## 3. The `PageContext` interface

The interface is plain TypeScript with no framework dependency — no React
types, no Next.js types — so it transfers to any frontend stack:

```ts
/** A figure the page declares as essential. Tier 2 only. */
export interface KeyFigure {
  label: string;
  value: string | number;
}

/**
 * What the chat knows about the view the user is looking at.
 *
 * This is a DESCRIPTOR, not a data snapshot. It names the view so the agent can
 * fetch the real numbers through its tools under the caller's identity. It must
 * never carry a value the viewer's own cost-visibility rules would strip.
 */
export interface PageContext {
  /** Stable machine key for the view, e.g. 'developer-report'. */
  kind: string;
  /** Human-readable, rendered in the chip: "Developer · @junky". */
  label: string;
  /** Route params, renamed to domain names (id -> reportId). */
  params: Record<string, string>;
  /** Allowlisted URL search params. Omitted when empty. */
  filters?: Record<string, string>;
  /** Tier 2 only: figures the page declared. Omitted when empty. */
  keyFigures?: KeyFigure[];
  /** Which tier produced this. Drives chip wording and adoption reporting. */
  source: 'route' | 'enriched' | 'inferred';
}
```

`source` is load-bearing, not decorative. It is the field that lets the chip
be honest about provenance — an `inferred` descriptor should read as a guess,
not a fact — and it is the same field that lets an adoption report state, in
concrete terms, how much of the app is running on the free tier versus the
opt-in one.

The registry side pairs with this as a plain data shape too — a route
pattern mapped to a `kind`, a pure `label(params)` function, an allowlist of
which search params are worth carrying, and a list of seeded suggested
questions. Nothing in either shape assumes React, Next.js routing, or any
particular query layer underneath — only that *something* can resolve "what
route/view is this" into a `PageContext`.

## 4. What transfers, and what is Glooker-specific

**Transfers directly:**

- **The route registry pattern** — mapping a route pattern to
  `{ kind, label(params), filterKeys, suggestions }` as plain data plus a pure
  function. Any router that can expose a matched pattern and its resolved
  params can drive this; nothing about it depends on Next.js.
- **The `PageContext`/`KeyFigure` interface**, verbatim, as shown above.
- **The visible-and-removable chip UX**, sourced from Copilot's and Cursor's
  attached-context pattern: show what's attached, let the user detach it.
  This is both a trust mechanism and a debugging one — when an answer looks
  wrong, the chip is the first thing to check, and it doubles as evidence the
  assistant isn't reasoning over something the user doesn't know about.
- **The advisory-not-authorisation rule**: the descriptor may say *"the user
  is viewing project X"*; it must never itself carry a number the viewer's
  own permission rules would otherwise strip, and every number in an answer
  must still travel through the governed query layer under the viewer's own
  identity on every turn — not be inherited from an earlier, differently-
  scoped request. Glooker enforces this with a test asserting that a route-
  or inferred-sourced context can produce zero key figures in the rendered
  preamble; the Dashboard should have an equivalent test regardless of how
  its own chat is implemented.

**Glooker-specific, i.e. plumbing to replace rather than reuse:**

- **The 16-tool MCP surface** the agent re-fetches through
  (`query_developer_stats`, `get_org_summary`, `get_team_pulse`,
  `query_commits`, and 12 others) — this is Glooker's own governed query
  layer, built for Glooker's own data model. The property that generalises is
  only that the agent's data access is a set of scoped, identity-carrying
  tool calls, never a copy of what happened to be on screen; the Dashboard
  would need its own equivalent surface over its own APIs, in whatever shape
  fits it (MCP or otherwise).
- **The `/anthropicai/chat` shim** — the specific Bedrock `InvokeModel`
  passthrough route Glooker's chat uses through the Smartling AI Proxy,
  adopted because the proxy's OpenAI-compatible endpoint rejects custom tools
  for Anthropic models entirely (confirmed directly against the proxy; see
  the Phase 0 findings earlier in `experiments/mastra-chat/FINDINGS.md`). This
  is one app's workaround for one proxy quirk. The Dashboard's chat does not
  need to match this route; it needs only to confirm, for whichever
  model/endpoint it picks, that native tool-calling actually works on it —
  which is not guaranteed by a model appearing in the proxy's catalog (see
  the standalone finding in Section 6).

## 5. The URL-state principle

The more of a view's state lives in the URL rather than in component state,
the more page context an assistant gets for free out of tier 1 alone — no
enrichment code, no page-specific work, just parsing an already-shareable
filter, sort order or date range out of the querystring. This has a second
payoff that has nothing to do with chat: state in the URL is shareable and
bookmarkable by construction; state in `useState` never is. A team gets both
properties for the same one-time cost of moving a piece of view state into
the URL.

Glooker does not consistently do this, and the gap is visible in its own
codebase: the team report page keeps its developer-table filter query in
`useState` (`src/app/report/[id]/team/page.tsx`), Settings keeps which tab is
active in `useState` (`src/app/settings/page.tsx`), and the org report's
spend tab keeps how many rows are shown in `useState`
(`src/app/report/[id]/org/spend-tab.tsx`). None of these are visible in the
URL, so none of them are visible to tier 1's `filterKeys` allowlist either —
they can only ever reach the chat through page-specific tier-2 code written
for that one piece of state, if anyone bothers. The Smartling Dashboard should
not repeat this pattern: any view state worth telling an assistant about is,
by the same argument, state worth putting in the URL for its own sake — the
sharing and bookmarking benefit and the context-for-free benefit are the same
change, paid for once.

## 6. Costs measured here, and the in-browser-model question

| Measurement | Result | Budget/reference |
|---|---|---|
| Preamble, 8-key-figure enriched page (realistic measured case, not a bound; `MAX_FIGURES = 8` caps the figure *count* but not string length) | 455 characters, ~114 tokens | 300-token budget |
| Preamble, actual worst case once `label`/param/figure length caps are added to `buildPreamble()` (label/kind ≤120 chars; ≤10 params/filters at ≤64 chars each; ≤8 figures at ≤40 chars each) | ~3.8KB, ~950 tokens | 300-token budget (exceeded only in this maximally adversarial case) |
| Preamble, route-only descriptor (no key figures) | shorter still — label and identifiers only | — |
| Tier-3 inference call (page-text extract → classification) | ~559 tokens (544 in / 15 out), ≈$0.0006/call | Haiku 4.5 list price, $1/$5 per Mtok |

Cost was never the reason tier 3 was cut in this experiment — the numbers
above are cheap in absolute terms. It was cut on accuracy against its own
gate, with the caveat in Section 2.

**Standalone finding: catalog availability is not account invocability.** The
AI Proxy's models catalog lists `claude-haiku-4-5` with providers
`['anthropic', 'bedrock']`, but `/anthropicai/chat` rejects every Haiku
identifier tried — `claude-haiku-4-5`, `claude-haiku-4-5-20251001`,
`claude-3-5-haiku`, and Bedrock-prefixed variants — on this account with "The
provided model identifier is invalid (Service: BedrockRuntime)". The
identical request shape succeeds for `claude-sonnet-5` and `claude-sonnet-4-6`.
This is the specific gap that forced Section 2's kill-gate score to be
measured with `claude-sonnet-4-6` standing in for the specified Haiku model —
not a methodology choice, a workaround for it. It reads as an account/region
provisioning issue, not a proxy bug, and is worth raising with Smartling's
Data team before any team plans around Haiku through this route.

**In-browser inference was considered and rejected for dashboard metrics,
independent of the tier-3 result above.** Chrome's Summarizer API and
on-device runtimes like WebLLM are real, shipping technology, not a research
curiosity — on-device summarisation has begun appearing in production
consumer apps. That maturity does not change the calculus for a metrics
dashboard, for three independent reasons. First, lossy compression of numbers
is the worst possible failure mode for an analytics product: a rounded or
hallucinated figure looks exactly like a correct one to the person reading it,
with no visible seam. Second, a model that only ever runs in the visitor's own
browser leaves no server-side trace to audit if a number is later challenged
— there is nothing to point to. Third, these runtimes are commonly multi-
gigabyte, storage-evictable under OS pressure, and Chrome-only; an enterprise
dashboard's chat cannot depend on a dependency the browser is free to silently
discard.

Where on-device inference *does* fit at Smartling is a different shape of
problem: customer translation content under data-residency constraints, where
the content itself — not a number derived from it — is the sensitive
artifact, and the actual requirement is keeping it off any server at all,
compliant or not. That is not the Dashboard chat's problem, and the Dashboard
chat should not be designed around solving it.

[^looker]: [Conversational Analytics in Looker](https://docs.cloud.google.com/looker/docs/conversational-analytics-overview) — Google states that grounding on the LookML semantic layer, rather than raw rendered data, reduces natural-language query errors by up to two thirds.
[^datadog]: [Datadog Bits AI Chat](https://docs.datadoghq.com/bits_ai/bits_chat/) — "uses your Datadog role to fetch data, so it can only access the resources you have permission to view."
