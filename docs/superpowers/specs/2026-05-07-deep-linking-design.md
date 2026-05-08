# Deep-linking for filters and view state — design

**Date:** 2026-05-07
**Status:** approved (brainstormed; not yet implemented)

## Goal

Persist client-side filter and view-tab selections in the URL so that:

1. Reloading any report/projects page keeps the user on the same view with the same filters applied.
2. Pasting a URL into a chat reproduces the exact view for the recipient.
3. Browser back/forward behaves sensibly (filter changes don't pollute history; deliberate tab switches do).

## Scope

The hook is general-purpose, but the only call sites in v1 are:

- `/report/[id]/org` — 1 piece of state (Impact / Spend tab).
- `/report/[id]/team` — 2 pieces (selected team, selected developer set).
- `/projects` — 6 pieces (org, status tab, team filter, goal filter, initiative filter, search query).

Out of scope:

- Reports listing (`/reports`) — has no user-set filters today.
- Expanded-row state (epic / report) — not in URL.
- Pure UI ephemera (typeahead dropdown open, hover indices, modals, popovers, calendar month) — not in URL.

## URL conventions

| Concern | Choice |
|---|---|
| Encoding | Query-string params (`?tab=spend&team=Platform`). |
| History semantics | Tab changes `push`; filter changes `replace`. |
| Multi-value filters | Repeated key (`?dev=alice&dev=bob`). Native to `URLSearchParams.getAll`. |
| Defaults | Omitted from URL — the canonical "no-filter" URL has no params. |
| Invalid values | Silently fall through to default; no URL rewrite, no error UI. |
| Unknown keys | Preserved when writing (don't strip params owned by other code paths). |

## Architecture

### Hook API

A single hook in `src/lib/url-state.ts`:

```ts
type UrlSchema<T> =
  | { key: string; type: 'enum';       values: readonly T[]; default: T;          history: 'push' | 'replace' }
  | { key: string; type: 'string';     default: T extends string | null ? T : never; history: 'push' | 'replace' }
  | { key: string; type: 'string-set'; default: Set<string>;  history: 'push' | 'replace' };

function useUrlState<T>(schema: UrlSchema<T>): [T, (next: T) => void];
function useUrlBatch(): (fn: () => void) => void;
```

Usage:

```ts
const [activeTab, setActiveTab] = useUrlState<'impact' | 'spend'>({
  key: 'tab', type: 'enum', values: ['impact','spend'] as const,
  default: 'impact', history: 'push',
});

const [filterLogins, setFilterLogins] = useUrlState<Set<string>>({
  key: 'dev', type: 'string-set', default: new Set(),
  history: 'replace',
});

const batch = useUrlBatch();
// later, atomic two-key change:
batch(() => {
  setSelectedTeamName(team.name);
  setFilterLogins(new Set());
});
```

### Serialization rules

| Schema type | URL form | Read (URL → value) | Write (value → URL) |
|---|---|---|---|
| `enum` | `?key=v` | If absent or `!values.includes(v)`, return `default`. | `value === default` → delete key; else set. |
| `string` | `?key=v` | If absent or empty, return `default`. | `value === default` (typically `''` or `null`) → delete key; else set. |
| `string-set` | `?key=a&key=b` | `params.getAll(key)` → `new Set(...)`. | Empty set → delete key; else write one entry per element. |

Cross-cutting:

1. **Omit-at-default.** Default state always produces a clean URL.
2. **Pass-through unknown keys.** Writes only mutate the hook's own key.
3. **Invalid values → defaults.** No error UI, no URL rewrite.

### Read path (URL → state)

Each hook subscribes via `useSearchParams()`. Any URL change (user action or browser back/forward) re-fires the hook through React's normal subscription, which re-derives the value and re-renders the page. No extra subscription machinery.

### Write path (state → URL)

The setter:

1. Reads the current `URLSearchParams` (snapshot from `useSearchParams()` or — when batching — from the pending-changes accumulator).
2. Mutates only its own key (delete if at default, else set/append).
3. Calls `router.push(pathname + '?' + params)` or `router.replace(...)` depending on schema's `history`.

Multiple hooks coexist because each only touches its own key. Unknown keys (now or future-added) pass through untouched.

### Atomic multi-key updates

`useUrlBatch()` returns a function that takes a synchronous callback. While inside the callback, `useUrlState` setters do **not** call `router`; they push their `(key, value)` updates into a module-level pending Map. After the callback returns, the helper:

1. Reads current `URLSearchParams`.
2. Applies all pending updates.
3. Calls `router.push` if any participating setter had `history: 'push'`; otherwise `router.replace`.

Outside `batch`, setters write immediately as before.

The only call site that needs batching today is the team-page "select team also clears the dev filter" interaction. Everything else uses individual setters.

## Per-page filter inventory

### `/report/[id]/org`

| State | Key | Type | Default | History |
|---|---|---|---|---|
| `activeTab` | `tab` | enum `'impact' \| 'spend'` | `'impact'` | push |

Note: `'spend'` is rendered conditionally (`hasSpend`). When `hasSpend === false` the page falls back to the impact view regardless of URL — same behavior as today.

### `/report/[id]/team`

| State | Key | Type | Default | History |
|---|---|---|---|---|
| `selectedTeamName` | `team` | string \| null | `null` | replace |
| `filterLogins` | `dev` | string-set | `new Set()` | replace |

The "select team" UI clears `filterLogins`. Under deep-linking that becomes one batched update via `useUrlBatch`, producing one history entry instead of two.

### `/projects`

| State | Key | Type | Default | History |
|---|---|---|---|---|
| `org` | `org` | string | first org from API | replace |
| `activeTab` | `status` | enum `'In Progress' \| 'Rollout' \| 'Done'` | `'In Progress'` | push |
| `filterTeam` | `team` | string | `''` | replace |
| `filterGoal` | `goal` | string | `''` | replace |
| `filterInitiative` | `initiative` | string | `''` | replace |
| `searchQuery` | `q` | string | `''` | replace |

The `org` default is dynamic (first org from `/api/orgs`). On load: if URL has `?org=…`, use it; otherwise let the existing effect set it via `setOrg(orgs[0].login)`, which also `replace`s into the URL. This preserves today's behavior of "land on the first org" for fresh visits.

## Testing

Three layers, in `src/lib/__tests__/unit/`:

1. **Pure serialization** (`url-state-serialize.test.ts`)
   - `encodeEnum`, `decodeEnum`, `encodeStringSet`, `decodeStringSet`, `applyDefaults`.
   - Cases: omit-at-default, invalid enum falls through, empty set omits key, repeated keys round-trip, unknown keys preserved on write.

2. **Hook integration via `renderHook`** (`url-state-hook.test.ts`)
   - Mock `next/navigation`'s `useSearchParams`, `useRouter`, `usePathname`.
   - Verify: initial read, push vs replace selection, multiple hooks on the same render don't stomp each other, browser back/forward (simulated by re-rendering with new `useSearchParams` value), `useUrlBatch` collapses N writes into 1 router call.

3. **No per-page React tests.** The project does not have full page-render tests; the hook contract is covered above. Manual smoke (reload, share-link round-trip) is the integration check.

No end-to-end test framework gets added for this feature.

## Edge cases

- **First paint / SSR.** `useSearchParams` returns a client-side snapshot; hooks read once on first render and produce the same value every subsequent render until URL changes. No hydration flicker because the URL is the source of truth from frame 0.
- **Navigation between pages with overlapping keys.** Each page's hooks only read keys they care about. Going from `/projects?team=X` → `/report/[id]/team?team=Y` does not blend params because Next.js generates a new URL on `<Link>` navigation; the hook reads only its own page's URL.
- **External tools that strip query params** (some chat clients). Out of scope — recipients of stripped links land on the default view; that's the intended fallback.
- **Stale shared links** referring to a developer who left the org or a tab name that was renamed. Default-fallback rule means the URL renders something sensible without error.

## Files touched

- New: `src/lib/url-state.ts` (hook + types + serialization)
- New: `src/lib/__tests__/unit/url-state-serialize.test.ts`
- New: `src/lib/__tests__/unit/url-state-hook.test.ts`
- Edit: `src/app/report/[id]/org/page.tsx`
- Edit: `src/app/report/[id]/team/page.tsx`
- Edit: `src/app/projects/projects-content.tsx`

## Out of scope (deferred)

- Deep-linking row-expanded state on `/projects` and `/reports`.
- Cross-page "memory" of previously-applied filters (each page is independent).
- E2E browser tests.
- Sharing-friendly short URLs / hashed shortcuts.
