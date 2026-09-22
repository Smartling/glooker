# Page-Context-Aware Chat — Design

**Date:** 2026-09-22
**Branch:** `experiment/mastra-chat`
**Status:** approved, ready for implementation planning

## Goal

Make the Glooker chat available on every page and aware of what the user is
currently looking at, so a question like *"why did my spend jump?"* asked on the
developer page resolves against that developer and that report without the user
restating it.

Second deliverable, equally important: a written recommendation for implementing
the same context awareness in the **Smartling Dashboard AI chat**. The design is
therefore constrained to mechanisms that transfer to a codebase we do not
control and cannot fully instrument.

## Why this shape — evidence

Two product categories solve this differently, and we are firmly in one of them.

**Tools with a governed data layer send a descriptor and re-fetch.**
[Conversational Analytics in Looker](https://docs.cloud.google.com/looker/docs/conversational-analytics-overview)
grounds Gemini on the LookML semantic layer rather than the rendered rows;
Google reports semantic-layer grounding cuts natural-language query errors by up
to two thirds. [Datadog Bits](https://docs.datadoghq.com/bits_ai/bits_chat/)
states that it "uses your Datadog role to fetch data, so it can only access the
resources you have permission to view" — only possible if the assistant
re-fetches under the user's identity rather than receiving a snapshot.

**Tools where the artifact is the content send the content.** Copilot and Cursor
ship file contents and the active selection, because a source file has no
semantic layer to query.

Glooker and the Smartling Dashboard are the first category: both have a governed
query layer (Glooker: 16 MCP tools) and per-user visibility rules
(`cost-visibility.ts` strips per-developer cost outside the viewer's team). A
rendered-data snapshot would bypass those rules. Descriptor-plus-re-fetch is
therefore both the more accurate and the only correct-by-construction option.

The UX pattern comes from a third place: Copilot and Cursor make attached
context **visible and removable**. That is a trust mechanism and a debugging
mechanism — when an answer is odd, the chip explains why.

## Non-goals

- **No in-browser model.** Chrome's Summarizer API is real and shipping, but a
  4 GB storage-evictable Chrome-only dependency cannot underpin an enterprise
  dashboard, and lossy compression of numbers is the worst failure mode for
  analytics. Recorded in FINDINGS.md with the cases where it *would* fit.
- **No rendered-data snapshots** in the default path, for the reasons above.
- **No streaming.** The `/anthropicai/chat` route is Bedrock `InvokeModel` and
  rejects `stream: true`. Out of scope.
- **No new write tools.** `startReportRun` stays the only one.

## Current state

Nine page routes; three already mount `ChatPanel`.

| Route | Component | Chat today |
|---|---|---|
| `/` | client | yes |
| `/report/[id]/org` | client | yes |
| `/report/[id]/team` | client | yes |
| `/report/[id]/dev/[login]` | client | no — this is the spend surface |
| `/projects` | server | no |
| `/profile` | server | no |
| `/reports` | client | no |
| `/settings` | client | no |
| `/debug/headers` | client | no |

`ChatPanel` is a client component, so mounting it inside the two server pages
needs no special handling.

## Architecture — three tiers

| Tier | Mechanism | Cost | Coverage |
|---|---|---|---|
| 1 | Route registry → descriptor | free, deterministic | all 9 routes |
| 2 | `useEnrichPageContext()` → key figures + UI state | free, exact | pages that earn it |
| 3 | Haiku pass over a structured extract | ~$1/Mtok input | registry misses only |

Tier 3 fires **only when the registry has no entry**. On an instrumented page it
never runs. This ordering is what makes the Smartling recommendation adoptable:
every page gets context on day one, and teams instrument the pages that matter
over time rather than as a precondition.

## The interface

```ts
export interface KeyFigure {
  label: string;
  value: string | number;
}

export interface PageContext {
  /** Stable machine key for the view, e.g. 'developer-report'. */
  kind: string;
  /** Human-readable, rendered in the chip: "Developer · @junky". */
  label: string;
  /** Route params: reportId, login, team. */
  params: Record<string, string>;
  /** Meaningful URL search params (filters, sort, range). */
  filters?: Record<string, string>;
  /** Tier 2 only: figures the page declares as essential. */
  keyFigures?: KeyFigure[];
  /** Which tier produced this. Drives chip wording and adoption reporting. */
  source: 'route' | 'enriched' | 'inferred';
}
```

`source` is load-bearing. It lets the chip be honest about provenance
(`inferred` is a guess and should say so), and it lets the Smartling
recommendation describe staged adoption in concrete terms.

## Tier 1 — route registry

`src/lib/chat/context/registry.ts` maps Next route patterns to a builder:

```ts
export interface RegistryEntry {
  pattern: string;  // Next.js route pattern, e.g. '/report/[id]/dev/[login]'
  kind: string;
  label: (params: Record<string, string>) => string;
  /** Search params worth carrying; everything else is dropped. */
  filterKeys?: string[];
}
```

Nine entries, one per route. Matching is exact on the Next pattern obtained from
`usePathname()` normalised against `useParams()` — not regex guessing, so a new
route that nobody registers is a clean miss rather than a wrong match.

`use-page-context.ts` is a client hook composing `usePathname`, `useParams` and
`useSearchParams` into a `PageContext` with `source: 'route'`.

## Tier 2 — enrichment

`enrich.tsx` exports `PageContextEnrichment` (a React context) and
`useEnrichPageContext(partial)`. A page calls it to declare what it considers
essential:

```ts
useEnrichPageContext({
  keyFigures: [
    { label: 'Claude Code spend', value: `$${(dev.cc_total_cost / 100).toFixed(2)}` },
    { label: 'Commits', value: dev.total_commits },
  ],
});
```

Merging is shallow: enrichment overrides `label` and adds `keyFigures` and
`filters`; it cannot change `kind` or `params`. Result carries
`source: 'enriched'`.

**This replaces the "highlight essential data points" idea done with a model.**
The page already knows which figures are essential — it rendered them. Declaring
them is exact, free, and testable; inferring them is none of those.

Applied to two pages in this experiment: `/report/[id]/dev/[login]` (spend,
commits, PRs) and `/report/[id]/org` (developer count, total commits, period).

## Tier 3 — Haiku fallback (gated)

`infer.ts`. On a registry miss only:

1. The client sends a **bounded generic extract**: `document.title`, the first
   `<h1>`, and the visible `innerText` of the `<main>` landmark (falling back to
   `<body>`), whitespace-collapsed and capped at 4000 characters.

   This must require **no page instrumentation of any kind** — tier 3 exists
   precisely for pages nobody has touched, so it cannot depend on `data-*`
   attributes, a provider, or any per-page opt-in. That constraint is what makes
   it transferable to the Smartling Dashboard.

2. The server asks `anthropic/claude-haiku-4-5` via the existing
   `/anthropicai/chat` route for a `PageContext` with `source: 'inferred'`.
3. The result is used as the preamble. Any failure falls back to the generic
   `"the user is on <path>"`.

**Kill gate.** Tier 3 ships only if it beats the generic fallback on a
deliberately unregistered page. The measure, fixed before running:

- Five questions answerable only with page context (e.g. *"who is this page
  about?"*, *"what period does this cover?"*).
- Each answer scored **correct / partially correct / wrong** against the page's
  real data, by inspection.
- **Pass condition: at least 4 of 5 correct with tier 3, versus the generic
  fallback's baseline on the same five.** Record both scores and the token cost
  per call.

If it fails, tier 3 is deleted rather than left disabled. Note Haiku 4.5 is
$1/$5 per Mtok against Sonnet 5's $2/$10 — 2× cheaper, not an order of
magnitude, so latency and role separation are the justification, not spend.

Tier 3 never sees numbers the viewer cannot see, because the extract comes from
what the page already rendered for that viewer.

## Data flow and the hard rule

1. `ChatPanel` composes tier 1 + tier 2 into a `PageContext`.
2. It renders a removable chip showing `label`, and sends `pageContext` in the
   `/api/chat` body.
3. The route serialises the descriptor into a short system-prompt preamble
   appended to `CHAT_SYSTEM`.
4. The agent fetches real data through its tools, with the caller's identity
   forwarded (as fixed in `d86c621`).

**Hard rule: context is advisory text, never authorisation.** The preamble may
say *"the user is viewing developer @junky on report abc123"*. It must never
carry a figure that the viewer's own `cost-visibility` rules would strip. Every
read stays on the governed path. A test asserts the preamble contains no value
sourced from outside the tool layer.

## UI

- **Chip** above the input: `Org report · Smartling · 2026-09-09`, with an ✕ to
  detach. Detached means the preamble is omitted for subsequent messages.
- **Provenance**: `source: 'inferred'` renders as `~ Inferred from page` in a
  muted style, so a guess never looks like a fact.
- **Suggestions**: the existing `SUGGESTIONS` array becomes per-`kind`, seeded
  from the registry. On the dev page: *"Why did spend change?"*, *"What did they
  ship?"*.

Out of scope for this experiment: the "add context" picker for attaching a
*second* view. The interface allows it; the UI is not built. Recorded as the
natural next step.

## Error handling

Failure degrades downward, never blocks:

| Failure | Behaviour |
|---|---|
| Route not in registry | tier 3 if enabled, else generic preamble |
| Tier 3 errors or times out (5s) | generic preamble, logged, chat proceeds |
| Enrichment throws | tier 1 context only |
| `pageContext` absent from request | current behaviour, unchanged |

## Testing

- **Registry** — table-driven over all 9 routes: pattern match, `kind`, label
  rendering, filter allowlisting. Includes a negative case for an unregistered
  route.
- **Serialisation** — descriptor → preamble, including the assertion that no
  key figure reaches the preamble unless `source: 'enriched'`.
- **Enrichment merge** — enrichment cannot override `kind`/`params`.
- **Chip** — jsdom component test: renders label, ✕ detaches, `inferred` renders
  with its provenance marker.
- **Integration** — POST `/api/chat` with a `pageContext` and assert the preamble
  reaches the model request.
- **Tier 3** — the kill-gate comparison, recorded in FINDINGS.md.

All must pass alongside the existing 129 suites / 1284 tests, with
`tsc --noEmit` clean.

## Smartling Dashboard recommendation

Written to `docs/recommendations/2026-09-22-dashboard-chat-context.md`. Contents:

1. The category argument — why descriptor-plus-re-fetch, with the Looker and
   Datadog evidence.
2. The tiered architecture and why tier 3 makes adoption incremental.
3. The `PageContext` interface, framework-agnostic.
4. What transfers directly (registry, interface, chip UX, the advisory-not-
   authorisation rule) and what is Glooker-specific (MCP tool surface, the
   `/anthropicai/chat` shim).
5. **URL-state principle**: the more view state lives in the URL, the more
   context is free — with shareable views as a side benefit. Glooker holds
   filters in `useState` and loses this; the Dashboard should not.
6. Measured costs from this experiment, and the in-browser-model analysis
   including where on-device *would* fit at Smartling (customer translation
   content under data-residency constraints, not dashboard metrics).

## Risks

- **Nine pages may be the wrong scope.** Settings, profile and debug/headers
  have little worth asking about. The honest outcome may be that context helps
  on four pages and is noise on the rest. This will be reported as a finding
  rather than presented as 9/9 success.
- **Tier 3 may not earn its place.** It has an explicit kill gate.
- **Prompt bloat.** The preamble adds tokens to every message. Budget: 300
  tokens; measured and reported.
