# Page-Context-Aware Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the Glooker chat on every page and make it aware of the view the user is looking at, so questions resolve against that view without restating it.

**Architecture:** Three tiers behind one `PageContext` interface. Tier 1 derives a descriptor from the route via a registry (free, all 9 routes). Tier 2 lets a page declare its key figures through a React context (opt-in, exact). Tier 3 asks Haiku to infer context for unregistered routes (gated, deleted if it fails its kill gate). The descriptor becomes a system-prompt preamble; the agent still fetches all real data through its tools under the caller's identity.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Jest + ts-jest, Tailwind 3.4, Mastra 1.67, `@ai-sdk/anthropic` via the Smartling AI Proxy.

**Spec:** `docs/superpowers/specs/2026-09-22-page-context-aware-chat-design.md`

## Global Constraints

- **Tests live under `src/lib/__tests__/`.** `jest.config.ts` sets `roots: ['<rootDir>/src/lib']`; a test anywhere else is silently not run.
- **Component tests need `/** @jest-environment jsdom */`** as the first docblock. Precedent: `src/lib/__tests__/unit/profile-self-view.test.tsx`.
- **Context is advisory text, never authorisation.** The preamble may name what the user is viewing. It must never carry a figure the viewer's `cost-visibility` rules would strip. All reads stay on the tool path with the caller's identity forwarded.
- **Failure degrades downward, never blocks.** Registry miss → tier 3 → generic preamble. Tier 3 error or 5s timeout → generic preamble.
- **Preamble budget: 300 tokens.** Measure and report.
- **`npm test` must stay green** at 129 suites / 1284 tests plus new ones, and `npx tsc --noEmit` must exit clean.
- **Do not add write tools.** `startReportRun` remains the only one.
- Use `npx jest --testPathPatterns="<pattern>"` — the old `--testPathPattern` (singular) was removed in Jest 30.

---

## File Structure

**Create:**
- `src/lib/chat/context/types.ts` — `PageContext`, `KeyFigure`, `RegistryEntry`
- `src/lib/chat/context/registry.ts` — route patterns → descriptors; `routePattern()`, `buildFromRoute()`
- `src/lib/chat/context/preamble.ts` — `PageContext` → system-prompt text
- `src/lib/chat/context/use-page-context.ts` — client hook, tiers 1+2 composed
- `src/lib/chat/context/enrich.tsx` — `PageContextProvider`, `useEnrichPageContext()`
- `src/lib/chat/context/infer.ts` — tier 3 Haiku pass (Task 6)
- `docs/recommendations/2026-09-22-dashboard-chat-context.md` (Task 7)

**Modify:**
- `src/app/api/chat/route.ts` — accept `pageContext`, append preamble
- `src/app/chat-panel.tsx` — chip UI, per-kind suggestions, send context
- `src/app/layout.tsx` — wrap in `PageContextProvider`
- 6 page files — mount `ChatPanel`
- `src/app/report/[id]/dev/[login]/page.tsx`, `src/app/report/[id]/org/page.tsx` — tier 2 enrichment

---

### Task 1: PageContext types and route registry

**Files:**
- Create: `src/lib/chat/context/types.ts`
- Create: `src/lib/chat/context/registry.ts`
- Test: `src/lib/__tests__/unit/chat-context-registry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PageContext`, `KeyFigure`, `RegistryEntry` types; `routePattern(pathname, params): string`; `buildFromRoute(pathname, params, search): PageContext | null`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-context-registry.test.ts`:

```ts
import { routePattern, buildFromRoute } from '@/lib/chat/context/registry';

describe('routePattern', () => {
  it('returns / for the root path', () => {
    expect(routePattern('/', {})).toBe('/');
  });

  it('substitutes dynamic segments back into their pattern form', () => {
    expect(routePattern('/report/abc123/org', { id: 'abc123' })).toBe('/report/[id]/org');
    expect(routePattern('/report/abc123/dev/junky', { id: 'abc123', login: 'junky' }))
      .toBe('/report/[id]/dev/[login]');
  });

  it('only substitutes exact whole segments', () => {
    // 'org' is a param value here; the literal '/org' segment must survive.
    expect(routePattern('/report/org/org', { id: 'org' })).toBe('/report/[id]/[id]');
  });

  it('leaves static paths untouched', () => {
    expect(routePattern('/settings', {})).toBe('/settings');
  });
});

describe('buildFromRoute', () => {
  it('builds a descriptor for the org report', () => {
    const ctx = buildFromRoute('/report/abc123/org', { id: 'abc123' }, new URLSearchParams());
    expect(ctx).toEqual({
      kind: 'org-report',
      label: 'Org report · abc123',
      params: { reportId: 'abc123' },
      source: 'route',
    });
  });

  it('builds a descriptor for a developer page', () => {
    const ctx = buildFromRoute(
      '/report/abc123/dev/junky', { id: 'abc123', login: 'junky' }, new URLSearchParams());
    expect(ctx?.kind).toBe('developer-report');
    expect(ctx?.label).toBe('Developer · @junky');
    expect(ctx?.params).toEqual({ reportId: 'abc123', login: 'junky' });
  });

  it('carries only allowlisted search params', () => {
    const search = new URLSearchParams({ team: 'Integrations', secret: 'nope' });
    const ctx = buildFromRoute('/report/abc123/team', { id: 'abc123' }, search);
    expect(ctx?.filters).toEqual({ team: 'Integrations' });
  });

  it('omits filters entirely when no allowlisted params are present', () => {
    const ctx = buildFromRoute('/report/abc123/org', { id: 'abc123' }, new URLSearchParams());
    expect(ctx?.filters).toBeUndefined();
  });

  it('returns null for an unregistered route', () => {
    expect(buildFromRoute('/experiments/new', {}, new URLSearchParams())).toBeNull();
  });

  it.each([
    ['/', 'home'],
    ['/reports', 'reports-list'],
    ['/projects', 'projects'],
    ['/profile', 'profile'],
    ['/settings', 'settings'],
    ['/debug/headers', 'debug'],
  ])('registers %s as kind %s', (path, kind) => {
    expect(buildFromRoute(path, {}, new URLSearchParams())?.kind).toBe(kind);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-context-registry"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/registry'`

- [ ] **Step 3: Create the types**

Create `src/lib/chat/context/types.ts`:

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

export interface RegistryEntry {
  /** Next.js route pattern, e.g. '/report/[id]/dev/[login]'. */
  pattern: string;
  kind: string;
  /** Receives domain-renamed params. */
  label: (params: Record<string, string>) => string;
  /** Next param name -> domain name. Unlisted params are dropped. */
  paramMap?: Record<string, string>;
  /** Search params worth carrying. Everything else is dropped. */
  filterKeys?: string[];
  /** Suggested questions seeded into the chat for this view. */
  suggestions: string[];
}
```

- [ ] **Step 4: Create the registry**

Create `src/lib/chat/context/registry.ts`:

```ts
import type { PageContext, RegistryEntry } from './types';

/**
 * Turn a concrete pathname back into its Next.js route pattern by swapping
 * param VALUES for their [name]. Matches whole segments only, so a literal
 * segment that happens to equal a param value is not clobbered.
 */
export function routePattern(
  pathname: string,
  params: Record<string, string | string[]>,
): string {
  const bySegment = new Map<string, string>();
  for (const [key, val] of Object.entries(params)) {
    if (typeof val === 'string') bySegment.set(val, `[${key}]`);
  }
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/';
  return '/' + segments.map(s => bySegment.get(s) ?? s).join('/');
}

export const REGISTRY: RegistryEntry[] = [
  {
    pattern: '/',
    kind: 'home',
    label: () => 'Latest report',
    suggestions: ['Who are the top 5 performers?', 'What is our AI adoption rate?'],
  },
  {
    pattern: '/report/[id]/org',
    kind: 'org-report',
    label: p => `Org report · ${p.reportId}`,
    paramMap: { id: 'reportId' },
    suggestions: ['Compare to the previous report', 'Who regressed?', 'Which team led?'],
  },
  {
    pattern: '/report/[id]/team',
    kind: 'team-report',
    label: p => `Team report · ${p.reportId}`,
    paramMap: { id: 'reportId' },
    filterKeys: ['team'],
    suggestions: ['How did this team do?', 'Who contributed most?'],
  },
  {
    pattern: '/report/[id]/dev/[login]',
    kind: 'developer-report',
    label: p => `Developer · @${p.login}`,
    paramMap: { id: 'reportId', login: 'login' },
    suggestions: ['Why did spend change?', 'What did they ship?', 'Compare to their team'],
  },
  {
    pattern: '/reports',
    kind: 'reports-list',
    label: () => 'All reports',
    suggestions: ['Which report covers last month?', 'How many reports are there?'],
  },
  {
    pattern: '/projects',
    kind: 'projects',
    label: () => 'Project board',
    suggestions: ['Which projects are active?', 'What is at risk?'],
  },
  {
    pattern: '/profile',
    kind: 'profile',
    label: () => 'My profile',
    suggestions: ['How did I do this period?'],
  },
  {
    pattern: '/settings',
    kind: 'settings',
    label: () => 'Settings',
    suggestions: ['Who is on the skip allowlist?'],
  },
  {
    pattern: '/debug/headers',
    kind: 'debug',
    label: () => 'Debug headers',
    suggestions: [],
  },
];

const BY_PATTERN = new Map(REGISTRY.map(e => [e.pattern, e]));

export function findEntry(pathname: string, params: Record<string, string | string[]>) {
  return BY_PATTERN.get(routePattern(pathname, params)) ?? null;
}

/** Tier 1. Returns null on a registry miss so the caller can fall through to tier 3. */
export function buildFromRoute(
  pathname: string,
  params: Record<string, string | string[]>,
  search: URLSearchParams,
): PageContext | null {
  const entry = findEntry(pathname, params);
  if (!entry) return null;

  const mapped: Record<string, string> = {};
  for (const [key, val] of Object.entries(params)) {
    if (typeof val !== 'string') continue;
    const name = entry.paramMap?.[key];
    if (name) mapped[name] = val;
  }

  const filters: Record<string, string> = {};
  for (const key of entry.filterKeys ?? []) {
    const val = search.get(key);
    if (val) filters[key] = val;
  }

  const ctx: PageContext = {
    kind: entry.kind,
    label: entry.label(mapped),
    params: mapped,
    source: 'route',
  };
  if (Object.keys(filters).length > 0) ctx.filters = filters;
  return ctx;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-context-registry"`
Expected: PASS, 11 tests

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/chat/context/types.ts src/lib/chat/context/registry.ts \
        src/lib/__tests__/unit/chat-context-registry.test.ts
git commit -m "feat(chat): PageContext types and route registry for all 9 routes"
```

---

### Task 2: Descriptor to system-prompt preamble

**Files:**
- Create: `src/lib/chat/context/preamble.ts`
- Test: `src/lib/__tests__/unit/chat-context-preamble.test.ts`

**Interfaces:**
- Consumes: `PageContext` from Task 1
- Produces: `buildPreamble(ctx: PageContext | null | undefined): string` — returns `''` when there is no context

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-context-preamble.test.ts`:

```ts
import { buildPreamble } from '@/lib/chat/context/preamble';
import type { PageContext } from '@/lib/chat/context/types';

const base: PageContext = {
  kind: 'developer-report',
  label: 'Developer · @junky',
  params: { reportId: 'abc123', login: 'junky' },
  source: 'route',
};

describe('buildPreamble', () => {
  it('returns an empty string when there is no context', () => {
    expect(buildPreamble(null)).toBe('');
    expect(buildPreamble(undefined)).toBe('');
  });

  it('names the view and its params', () => {
    const out = buildPreamble(base);
    expect(out).toContain('Developer · @junky');
    expect(out).toContain('reportId=abc123');
    expect(out).toContain('login=junky');
  });

  it('instructs the model to resolve references against the view', () => {
    expect(buildPreamble(base).toLowerCase()).toContain('resolve');
  });

  it('includes filters when present', () => {
    expect(buildPreamble({ ...base, filters: { team: 'Integrations' } }))
      .toContain('team=Integrations');
  });

  it('includes key figures only when the page declared them', () => {
    const enriched: PageContext = {
      ...base,
      source: 'enriched',
      keyFigures: [{ label: 'Claude Code spend', value: '$48.30' }],
    };
    expect(buildPreamble(enriched)).toContain('$48.30');
  });

  // THE HARD RULE. Key figures are only trustworthy when a page declared them;
  // a route- or model-derived context must never smuggle values into the prompt.
  it('drops key figures when source is not enriched', () => {
    const smuggled: PageContext = {
      ...base,
      source: 'route',
      keyFigures: [{ label: 'Claude Code spend', value: '$48.30' }],
    };
    const out = buildPreamble(smuggled);
    expect(out).not.toContain('$48.30');
    expect(out).not.toContain('Claude Code spend');
  });

  it('marks inferred context as unverified', () => {
    const out = buildPreamble({ ...base, source: 'inferred' });
    expect(out.toLowerCase()).toContain('inferred');
  });

  it('stays within the 300-token budget (~1200 chars) for a realistic context', () => {
    const big: PageContext = {
      ...base,
      source: 'enriched',
      filters: { team: 'Integrations' },
      keyFigures: Array.from({ length: 8 }, (_, i) => ({ label: `Metric ${i}`, value: i * 100 })),
    };
    expect(buildPreamble(big).length).toBeLessThan(1200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-context-preamble"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/preamble'`

- [ ] **Step 3: Implement**

Create `src/lib/chat/context/preamble.ts`:

```ts
import type { PageContext } from './types';

/** Hard cap so one page cannot blow the preamble budget. */
const MAX_FIGURES = 8;

/**
 * Render the descriptor as a short system-prompt block.
 *
 * Key figures are emitted ONLY when source === 'enriched', i.e. a page
 * explicitly declared them. A route-derived or model-inferred context must
 * never put values into the prompt — every number the agent states has to come
 * back through its tools, which run under the caller's identity and therefore
 * respect cost-visibility.
 */
export function buildPreamble(ctx: PageContext | null | undefined): string {
  if (!ctx) return '';

  const lines: string[] = ['', '## What the user is currently viewing', ''];
  lines.push(`View: ${ctx.label} (${ctx.kind})`);

  const params = Object.entries(ctx.params).map(([k, v]) => `${k}=${v}`);
  if (params.length) lines.push(`Identifiers: ${params.join(', ')}`);

  const filters = Object.entries(ctx.filters ?? {}).map(([k, v]) => `${k}=${v}`);
  if (filters.length) lines.push(`Active filters: ${filters.join(', ')}`);

  if (ctx.source === 'enriched' && ctx.keyFigures?.length) {
    const figures = ctx.keyFigures
      .slice(0, MAX_FIGURES)
      .map(f => `${f.label}: ${f.value}`)
      .join('; ');
    lines.push(`On screen: ${figures}`);
  }

  if (ctx.source === 'inferred') {
    lines.push('Note: this view was inferred from the page and is unverified. Say so if you rely on it.');
  }

  lines.push(
    '',
    'Resolve vague references ("this developer", "here", "my spend") against this view.',
    'Always confirm figures with your tools; never restate a number without fetching it.',
  );

  return lines.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-context-preamble"`
Expected: PASS, 8 tests

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/lib/chat/context/preamble.ts src/lib/__tests__/unit/chat-context-preamble.test.ts
git commit -m "feat(chat): serialise page context into a system-prompt preamble

Key figures are emitted only for source==='enriched'. A route- or
model-derived context cannot smuggle values into the prompt; every number
the agent states must come back through its tools under the caller's
identity, which is what keeps cost-visibility intact."
```

---

### Task 3: Client hook and the enrichment provider

**Files:**
- Create: `src/lib/chat/context/enrich.tsx`
- Create: `src/lib/chat/context/use-page-context.ts`
- Test: `src/lib/__tests__/unit/chat-context-enrich.test.tsx`

**Interfaces:**
- Consumes: `buildFromRoute` (Task 1), `PageContext`, `KeyFigure`
- Produces: `PageContextProvider` (React component), `useEnrichPageContext(partial)` hook, `usePageContext(): PageContext | null`, and `mergeEnrichment(base, partial)` for unit testing

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-context-enrich.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { mergeEnrichment } from '@/lib/chat/context/enrich';
import type { PageContext } from '@/lib/chat/context/types';

const base: PageContext = {
  kind: 'developer-report',
  label: 'Developer · @junky',
  params: { reportId: 'abc123', login: 'junky' },
  source: 'route',
};

describe('mergeEnrichment', () => {
  it('returns the base unchanged when there is no enrichment', () => {
    expect(mergeEnrichment(base, null)).toEqual(base);
  });

  it('adds key figures and flips source to enriched', () => {
    const out = mergeEnrichment(base, {
      keyFigures: [{ label: 'Spend', value: '$48.30' }],
    });
    expect(out.keyFigures).toEqual([{ label: 'Spend', value: '$48.30' }]);
    expect(out.source).toBe('enriched');
  });

  it('lets a page override the label', () => {
    expect(mergeEnrichment(base, { label: 'Junky — 14 days' }).label).toBe('Junky — 14 days');
  });

  it('merges filters rather than replacing them', () => {
    const withFilters = { ...base, filters: { team: 'Integrations' } };
    const out = mergeEnrichment(withFilters, { filters: { sort: 'impact' } });
    expect(out.filters).toEqual({ team: 'Integrations', sort: 'impact' });
  });

  it('cannot change kind or params', () => {
    const out = mergeEnrichment(base, { kind: 'evil', params: { reportId: 'other' } } as any);
    expect(out.kind).toBe('developer-report');
    expect(out.params).toEqual({ reportId: 'abc123', login: 'junky' });
  });

  it('does not flip source to enriched when only a label is supplied', () => {
    expect(mergeEnrichment(base, { label: 'x' }).source).toBe('route');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-context-enrich"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/enrich'`

- [ ] **Step 3: Implement the enrichment module**

Create `src/lib/chat/context/enrich.tsx`:

```tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { KeyFigure, PageContext } from './types';

/** What a page may contribute. It cannot change kind or params. */
export interface Enrichment {
  label?: string;
  keyFigures?: KeyFigure[];
  filters?: Record<string, string>;
}

interface Store {
  enrichment: Enrichment | null;
  setEnrichment: (e: Enrichment | null) => void;
}

const EnrichmentContext = createContext<Store>({
  enrichment: null,
  setEnrichment: () => {},
});

export function PageContextProvider({ children }: { children: React.ReactNode }) {
  const [enrichment, setEnrichment] = useState<Enrichment | null>(null);
  const value = useMemo(() => ({ enrichment, setEnrichment }), [enrichment]);
  return <EnrichmentContext.Provider value={value}>{children}</EnrichmentContext.Provider>;
}

/** Read the current enrichment. Used by usePageContext. */
export function useEnrichmentStore(): Store {
  return useContext(EnrichmentContext);
}

/**
 * A page declares the figures it considers essential. It already rendered them,
 * so this is exact and free — no model is needed to guess what matters.
 *
 * Serialise `partial` into the dependency list so a page can pass an object
 * literal without re-registering on every render.
 */
export function useEnrichPageContext(partial: Enrichment | null): void {
  const { setEnrichment } = useEnrichmentStore();
  const key = JSON.stringify(partial ?? null);
  useEffect(() => {
    setEnrichment(partial ?? null);
    return () => setEnrichment(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, setEnrichment]);
}

/** Pure merge, exported for testing. Enrichment can never widen identity. */
export function mergeEnrichment(
  base: PageContext,
  partial: Enrichment | null,
): PageContext {
  if (!partial) return base;

  const out: PageContext = { ...base };
  if (partial.label) out.label = partial.label;

  if (partial.filters && Object.keys(partial.filters).length > 0) {
    out.filters = { ...(base.filters ?? {}), ...partial.filters };
  }

  if (partial.keyFigures && partial.keyFigures.length > 0) {
    out.keyFigures = partial.keyFigures;
    // Only a page-declared figure earns 'enriched', because that is what the
    // preamble trusts. A label change alone does not.
    out.source = 'enriched';
  }

  return out;
}
```

- [ ] **Step 4: Implement the hook**

Create `src/lib/chat/context/use-page-context.ts`:

```ts
'use client';

import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { buildFromRoute, findEntry } from './registry';
import { mergeEnrichment, useEnrichmentStore } from './enrich';
import type { PageContext } from './types';

/**
 * Tiers 1 + 2. Returns null on a registry miss so the caller may fall through
 * to tier 3, which is the only tier that costs anything.
 */
export function usePageContext(): PageContext | null {
  const pathname = usePathname() ?? '/';
  const params = useParams() as Record<string, string | string[]>;
  const search = useSearchParams();
  const { enrichment } = useEnrichmentStore();

  const base = buildFromRoute(pathname, params, new URLSearchParams(search?.toString() ?? ''));
  if (!base) return null;
  return mergeEnrichment(base, enrichment);
}

/** Suggested questions for the current view; empty array on a miss. */
export function usePageSuggestions(): string[] {
  const pathname = usePathname() ?? '/';
  const params = useParams() as Record<string, string | string[]>;
  return findEntry(pathname, params)?.suggestions ?? [];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-context-enrich"`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit
git add src/lib/chat/context/enrich.tsx src/lib/chat/context/use-page-context.ts \
        src/lib/__tests__/unit/chat-context-enrich.test.tsx
git commit -m "feat(chat): enrichment provider and usePageContext hook (tiers 1+2)"
```

---

### Task 4: Wire context through the API route and the chat panel

**Files:**
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/layout.tsx`
- Test: `src/lib/__tests__/unit/chat-context-route.test.ts`

**Interfaces:**
- Consumes: `buildPreamble` (Task 2), `usePageContext` / `usePageSuggestions` (Task 3), `PageContextProvider` (Task 3)
- Produces: `/api/chat` accepts an optional `pageContext` field; `runControlEngine` and `runMastraEngine` accept `systemSuffix?: string`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-context-route.test.ts`:

```ts
import { buildPreamble } from '@/lib/chat/context/preamble';
import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import type { PageContext } from '@/lib/chat/context/types';

const ctx: PageContext = {
  kind: 'developer-report',
  label: 'Developer · @junky',
  params: { reportId: 'abc123', login: 'junky' },
  source: 'route',
};

describe('system prompt composition', () => {
  it('keeps the base instructions and appends the view', () => {
    const composed = CHAT_SYSTEM + buildPreamble(ctx);
    expect(composed).toContain('Glooker Assistant');
    expect(composed).toContain('Developer · @junky');
  });

  it('is byte-identical to the base prompt when there is no context', () => {
    expect(CHAT_SYSTEM + buildPreamble(null)).toBe(CHAT_SYSTEM);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-context-route"`
Expected: PASS for the second case, FAIL on the first only if `CHAT_SYSTEM` moved. If both pass immediately, that is fine — this test locks composition before the route changes below.

- [ ] **Step 3: Add `systemSuffix` to both engines**

In `src/lib/chat/engines/control.ts`, change the signature and the system field:

```ts
export async function runControlEngine(
  messages: { role: string; content: string }[],
  mcpUrl: string,
  forward: Record<string, string>,
  systemSuffix = '',
  maxSteps = 8,
): Promise<EngineResult> {
```

and inside `callProxy`'s payload replace `system: CHAT_SYSTEM,` with:

```ts
      system: CHAT_SYSTEM + systemSuffix,
```

In `src/lib/chat/engines/mastra.ts`, add `systemSuffix?: string;` to `MastraEngineOpts`, and in `withMastra` replace `instructions: CHAT_SYSTEM,` with:

```ts
    instructions: CHAT_SYSTEM + (opts.systemSuffix ?? ''),
```

- [ ] **Step 4: Accept `pageContext` in the route**

In `src/app/api/chat/route.ts`, add to the destructured body type `pageContext?: PageContext;`, import `buildPreamble` and the type, then after `const picked` add:

```ts
  const systemSuffix = buildPreamble(pageContext);
```

Add `systemSuffix` to `engineOpts`, and pass it to the control call:

```ts
    return NextResponse.json(await runControlEngine(messages, engineOpts.mcpUrl, forward, systemSuffix));
```

- [ ] **Step 5: Wrap the app in the provider**

In `src/app/layout.tsx`, import `PageContextProvider` from `@/lib/chat/context/enrich` and wrap the existing children with it, inside whatever providers already exist.

- [ ] **Step 6: Add the chip to the chat panel**

In `src/app/chat-panel.tsx`:

Add imports:

```tsx
import { usePageContext, usePageSuggestions } from '@/lib/chat/context/use-page-context';
```

Inside the component, after the existing `useState` calls:

```tsx
  const pageContext = usePageContext();
  const pageSuggestions = usePageSuggestions();
  const [contextAttached, setContextAttached] = useState(true);
  const activeContext = contextAttached ? pageContext : null;
```

In the `send` fetch body, add `pageContext: activeContext,` alongside `org` and `engine`.

Replace the `SUGGESTIONS.map(...)` source with `(pageSuggestions.length ? pageSuggestions : SUGGESTIONS).map(...)`.

Immediately above the existing `{/* Engine selector ... */}` block, add the chip:

```tsx
          {activeContext && (
            <div className="px-3 pt-2">
              <span className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-1 pl-2.5 text-[11px] ${
                activeContext.source === 'inferred'
                  ? 'border-dashed border-blue-400/55 bg-blue-400/10 text-blue-300'
                  : 'border-accent bg-accent/10 text-accent-light'
              }`}>
                <span className="truncate">
                  {activeContext.source === 'inferred' ? '~ ' : ''}{activeContext.label}
                </span>
                <button
                  onClick={() => setContextAttached(false)}
                  aria-label="Detach page context"
                  className="rounded px-1 opacity-75 hover:opacity-100"
                >×</button>
              </span>
              {activeContext.keyFigures && activeContext.keyFigures.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {activeContext.keyFigures.map(f => (
                    <span key={f.label} className="rounded border border-gray-800 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                      {f.label} {f.value}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {!contextAttached && pageContext && (
            <div className="flex items-center gap-2 px-3 pt-2 text-[11px] text-gray-600">
              <span>no page context</span>
              <button
                onClick={() => setContextAttached(true)}
                className="rounded border border-gray-700 bg-gray-800 px-2 py-0.5 text-gray-400"
              >Re-attach</button>
            </div>
          )}
```

- [ ] **Step 7: Verify**

Run: `npx jest --testPathPatterns="chat" && npx tsc --noEmit`
Expected: all chat tests PASS, tsc clean

- [ ] **Step 8: Commit**

```bash
git add src/app/api/chat/route.ts src/app/chat-panel.tsx src/app/layout.tsx \
        src/lib/chat/engines/control.ts src/lib/chat/engines/mastra.ts \
        src/lib/__tests__/unit/chat-context-route.test.ts
git commit -m "feat(chat): send page context with each message and show it as a removable chip"
```

---

### Task 5: Mount the chat on the remaining 6 pages and enrich 2

**Files:**
- Modify: `src/app/report/[id]/dev/[login]/page.tsx`, `src/app/projects/page.tsx`, `src/app/profile/page.tsx`, `src/app/reports/page.tsx`, `src/app/settings/page.tsx`, `src/app/debug/headers/page.tsx`
- Modify (enrichment): `src/app/report/[id]/dev/[login]/page.tsx`, `src/app/report/[id]/org/page.tsx`

**Interfaces:**
- Consumes: `ChatPanel`, `useEnrichPageContext` (Task 3)
- Produces: nothing downstream

> **Batch note for the controller:** steps 1 and 2 are the same mechanical edit
> repeated across 6 files. Dispatch them as ONE subagent task, not six.

- [ ] **Step 1: Mount ChatPanel on the 4 client pages**

In each of `src/app/report/[id]/dev/[login]/page.tsx`, `src/app/reports/page.tsx`, `src/app/settings/page.tsx`, `src/app/debug/headers/page.tsx`, add the import:

```tsx
import ChatPanel from '@/app/chat-panel';
```

and render it as the last child of the top-level returned element:

```tsx
      <ChatPanel org={ORG} />
```

where `ORG` is whichever org value that page already has in scope. `settings`, `reports` and `debug/headers` have no report in scope — use the existing org constant if one exists, otherwise `"Smartling"` is acceptable for this experiment and must be flagged in the task report as a hardcode to revisit.

- [ ] **Step 2: Mount on the 2 server pages**

`src/app/projects/page.tsx` and `src/app/profile/page.tsx` are server components. `ChatPanel` is already a client component, so it can be rendered directly from a server component with no wrapper. Add the same import and element.

- [ ] **Step 3: Enrich the developer page**

In `src/app/report/[id]/dev/[login]/page.tsx`, import:

```tsx
import { useEnrichPageContext } from '@/lib/chat/context/enrich';
```

and after `dev` is available from SWR:

```tsx
  useEnrichPageContext(dev ? {
    keyFigures: [
      { label: 'Claude Code spend', value: `$${(Number(dev.cc_total_cost ?? 0) / 100).toFixed(2)}` },
      { label: 'Commits', value: Number(dev.total_commits ?? 0) },
      { label: 'PRs', value: Number(dev.total_prs ?? 0) },
    ],
  } : null);
```

Note `Number(...)` — DECIMAL columns come back as strings from both MySQL and SQLite (see CLAUDE.md).

- [ ] **Step 4: Enrich the org page**

In `src/app/report/[id]/org/page.tsx`, import the same hook and after `data` is available:

```tsx
  useEnrichPageContext(data ? {
    keyFigures: [
      { label: 'Developers', value: Number(data.developers ?? 0) },
      { label: 'Total commits', value: Number(data.total_commits ?? 0) },
    ],
  } : null);
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit && npx jest --maxWorkers=3`
Expected: tsc clean; 129 existing suites plus the new ones all PASS

- [ ] **Step 6: Commit**

```bash
git add src/app
git commit -m "feat(chat): mount chat on all 9 pages; declare key figures on dev and org"
```

---

### Task 6: Tier 3 Haiku fallback, with its kill gate

**Files:**
- Create: `src/lib/chat/context/infer.ts`
- Modify: `src/app/api/chat/route.ts`, `src/app/chat-panel.tsx`
- Test: `src/lib/__tests__/unit/chat-context-infer.test.ts`

**Interfaces:**
- Consumes: `PageContext`, the `/anthropicai/chat` envelope pattern from `src/lib/chat/engines/control.ts`
- Produces: `inferPageContext(extract: PageExtract): Promise<PageContext | null>`; `PageExtract = { path: string; title: string; heading: string; text: string }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-context-infer.test.ts`:

```ts
import { clampExtract, parseInferred } from '@/lib/chat/context/infer';

describe('clampExtract', () => {
  it('collapses whitespace and caps at 4000 characters', () => {
    const out = clampExtract({
      path: '/x', title: 'T', heading: 'H', text: 'a  \n\n  b' + 'x'.repeat(8000),
    });
    expect(out.text).toContain('a b');
    expect(out.text.length).toBeLessThanOrEqual(4000);
  });
});

describe('parseInferred', () => {
  it('returns a context marked inferred', () => {
    const ctx = parseInferred('{"kind":"experiment","label":"New experiment"}', '/experiments/new');
    expect(ctx).toEqual({
      kind: 'experiment', label: 'New experiment', params: {}, source: 'inferred',
    });
  });

  it('never returns key figures even if the model supplies them', () => {
    const ctx = parseInferred(
      '{"kind":"x","label":"L","keyFigures":[{"label":"Spend","value":"$99"}]}', '/x');
    expect(ctx?.keyFigures).toBeUndefined();
  });

  it('returns null on unparseable output rather than throwing', () => {
    expect(parseInferred('not json', '/x')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-context-infer"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/infer'`

- [ ] **Step 3: Implement**

Create `src/lib/chat/context/infer.ts`:

```ts
import { getAccessToken } from '@/lib/smartling-auth';
import type { PageContext } from './types';

export interface PageExtract {
  path: string;
  title: string;
  heading: string;
  text: string;
}

const MAX_TEXT = 4000;
const TIMEOUT_MS = 5000;

export function clampExtract(e: PageExtract): PageExtract {
  const squash = (s: string) => (s ?? '').replace(/\s+/g, ' ').trim();
  return {
    path: squash(e.path),
    title: squash(e.title).slice(0, 200),
    heading: squash(e.heading).slice(0, 200),
    text: squash(e.text).slice(0, MAX_TEXT),
  };
}

/** Parse the model's reply. Never trusts key figures — inferred values are not evidence. */
export function parseInferred(raw: string, path: string): PageContext | null {
  try {
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (!parsed?.kind || !parsed?.label) return null;
    return {
      kind: String(parsed.kind),
      label: String(parsed.label),
      params: {},
      source: 'inferred',
    };
  } catch {
    return null;
  }
}

const endpoint = () =>
  `${process.env.SMARTLING_BASE_URL}/ai-proxy-api/v2/accounts/${process.env.SMARTLING_ACCOUNT_UID}/anthropicai/chat`;

/** Tier 3. Returns null on any failure so the caller falls back to a generic preamble. */
export async function inferPageContext(extract: PageExtract): Promise<PageContext | null> {
  if (process.env.CHAT_CONTEXT_INFER !== '1') return null;
  const e = clampExtract(extract);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
      signal: controller.signal,
      body: JSON.stringify({
        requestParameters: { timeout: TIMEOUT_MS, operationName: 'glooker_chat_context_infer' },
        request: {
          model: 'claude-haiku-4-5',
          modelVersion: 'latest',
          payload: {
            max_tokens: 200,
            system:
              'Identify what web page this is. Reply with ONLY JSON: ' +
              '{"kind":"<short-kebab-key>","label":"<short human label>"}. No prose.',
            messages: [{
              role: 'user',
              content: [{ type: 'text', text: `path: ${e.path}\ntitle: ${e.title}\nheading: ${e.heading}\n\n${e.text}` }],
            }],
          },
        },
      }),
    });
    const json: any = await res.json();
    const payload = json?.response?.data?.payload;
    const text = (payload?.content ?? [])
      .filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return parseInferred(text, e.path);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-context-infer"`
Expected: PASS, 4 tests

- [ ] **Step 5: Wire the extract through**

In `src/app/chat-panel.tsx`, when `pageContext` is null, collect and send an extract:

```tsx
  const pageExtract = () => {
    if (typeof document === 'undefined') return null;
    const main = document.querySelector('main') ?? document.body;
    return {
      path: window.location.pathname,
      title: document.title,
      heading: document.querySelector('h1')?.textContent ?? '',
      text: (main as HTMLElement).innerText ?? '',
    };
  };
```

and include `pageExtract: pageContext ? null : pageExtract(),` in the fetch body.

In `src/app/api/chat/route.ts`, when `pageContext` is absent and `pageExtract` is present:

```ts
  const resolvedContext = pageContext ?? (pageExtract ? await inferPageContext(pageExtract) : null);
  const systemSuffix = buildPreamble(resolvedContext);
```

Return `resolvedContext` on the response as `pageContext` so the chip can render the inferred label.

- [ ] **Step 6: Run the kill gate**

Enable with `CHAT_CONTEXT_INFER=1`. Temporarily remove `/settings` from `REGISTRY` so it becomes a miss, then ask these five questions **twice** — once with `CHAT_CONTEXT_INFER=1`, once with it unset:

1. What page am I on?
2. What can I configure here?
3. Is anything on this page misconfigured?
4. What is the LLM provider set to?
5. How many teams are configured?

Score each answer correct / partial / wrong by inspecting the real page. **Pass condition: at least 4 of 5 correct with tier 3, against the generic fallback's score on the same five.** Record both scores and the per-call token cost.

Restore `/settings` to the registry afterwards.

- [ ] **Step 7: Commit, or delete**

If it passed:

```bash
git add src/lib/chat/context/infer.ts src/app src/lib/__tests__/unit/chat-context-infer.test.ts
git commit -m "feat(chat): tier 3 Haiku fallback for unregistered routes

Kill gate: <N>/5 correct with inference against <M>/5 generic. Cost <X> tokens/call."
```

If it failed, delete `src/lib/chat/context/infer.ts` and its test, revert the wiring, and record the result in FINDINGS.md. A disabled tier is not an outcome; deletion is.

---

### Task 7: Findings and the Smartling Dashboard recommendation

**Files:**
- Modify: `experiments/mastra-chat/FINDINGS.md`
- Create: `docs/recommendations/2026-09-22-dashboard-chat-context.md`

**Interfaces:**
- Consumes: results from Tasks 1-6
- Produces: nothing downstream

- [ ] **Step 1: Append the experiment findings**

Add to `experiments/mastra-chat/FINDINGS.md` a section covering: which of the 9 pages context actually helped on (report honestly — settings, profile and debug are expected to be low value), the measured preamble token cost against the 300-token budget, and the tier 3 kill-gate result.

- [ ] **Step 2: Write the recommendation**

Create `docs/recommendations/2026-09-22-dashboard-chat-context.md` covering, in order:

1. **The category argument** — descriptor-plus-re-fetch, citing Looker's LookML grounding (error reduction up to two thirds) and Datadog Bits fetching under the user's own role.
2. **The tiered architecture**, and why tier 3 makes adoption incremental rather than a precondition.
3. **The `PageContext` interface**, framework-agnostic.
4. **What transfers** (registry, interface, chip UX, advisory-not-authorisation rule) **and what is Glooker-specific** (the 16 MCP tools, the `/anthropicai/chat` shim).
5. **URL-state principle** — the more view state lives in the URL, the more context is free, with shareable views as a side benefit. Name that Glooker holds filters in `useState` and loses this.
6. **Measured costs** from this experiment, plus the in-browser-model analysis: rejected for dashboard metrics, genuinely suited to customer translation content under data-residency constraints.

- [ ] **Step 3: Commit**

```bash
git add experiments/mastra-chat/FINDINGS.md docs/recommendations/
git commit -m "docs: page-context findings and the Smartling Dashboard recommendation"
```

---

## Self-Review

**Spec coverage:** Tier 1 → Task 1. Tier 2 → Tasks 3, 5. Tier 3 + kill gate → Task 6. Interface → Task 1. Data flow and the hard rule → Task 2 (test) and Task 4 (wiring). UI chip and provenance → Task 4. Per-kind suggestions → Tasks 1, 4. Error handling → Tasks 2, 6. Testing → every task. Smartling recommendation → Task 7. Nine-page mounting → Task 5. No gaps.

**Deliberately deferred, as the spec states:** the "add context" picker for attaching a second view. The interface allows it; no task builds it.

**Type consistency checked:** `PageContext` fields are identical across Tasks 1-6. `buildPreamble` takes `PageContext | null | undefined` everywhere. `source` values are exactly `'route' | 'enriched' | 'inferred'`. `buildFromRoute` returns `PageContext | null` and every caller handles null.
