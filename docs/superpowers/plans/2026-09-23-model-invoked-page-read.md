# Model-Invoked Page Read Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the chat agent a `readCurrentPage` tool it calls when it judges it lacks context, answering from the rendered page via Haiku.

**Architecture:** The tool uses `requireApproval: true` purely as a suspend primitive. When the agent calls it the run suspends; the client automatically posts a capped page extract; the route stashes it in a per-run store keyed by `runId` and resumes via `approveToolCallGenerate`; the tool body reads the extract from the store by `ctx.runId` and asks Haiku the agent's question. Page text crosses the wire only on that round trip.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Jest + ts-jest, Mastra 1.67, `claude-haiku-4-5` via the Smartling AI Proxy `/anthropicai/chat` route.

**Spec:** `docs/superpowers/specs/2026-09-23-model-invoked-page-read-design.md`

## Global Constraints

- **Tests live under `src/lib/__tests__/`** — `jest.config.ts` sets `roots: ['<rootDir>/src/lib']`; a test elsewhere is silently never run.
- Component/DOM tests need `/** @jest-environment jsdom */` as the first docblock.
- Use `npx jest --testPathPatterns="<pattern>"` (plural). The singular form was removed in Jest 30.
- `npx tsc --noEmit` must exit clean. If it reports duplicate identifiers under `.next/types/`, run `rm -rf .next` first — stale build artifacts, not real errors.
- Full suite must stay green: **133 suites / 1332 tests** plus additions.
- **Haiku model id is `claude-haiku-4-5` with `modelVersion: "20251001"`** — split, not combined. `claude-haiku-4-5-20251001` as the model with version `latest` is rejected; there is no bare alias.
- **`createTool`'s `suspendSchema`/`resumeSchema` do not work for agent tools** — the execute ctx has no `suspend`, and `approveToolCallGenerate` does not forward `resumeData`. Use `requireApproval` + the per-run store. This was probe-verified; do not "fix" it back.
- The tool must **resolve, never throw** on any failure, so a page-read problem can't break an answer the agent could otherwise give.
- **Control arm does not get this tool.** Only the mastra engine.
- No new dependencies. `git commit -F <file>` (the heredoc `-m "$(cat <<'EOF'…)"` form fails in this sandbox).

---

## File Structure

**Create:**
- `src/lib/chat/context/page-extract.ts` — `PageExtract` type + `clampExtract()`
- `src/lib/chat/context/page-store.ts` — per-run extract handoff on `globalThis`
- `src/lib/chat/context/summarize-page.ts` — `answerFromPage()` via Haiku
- `src/lib/chat/context/page-read-tool.ts` — `buildPageReadTool()`

**Modify:**
- `src/lib/chat/engines/types.ts` — system-prompt paragraph
- `src/lib/chat/engines/mastra.ts` — register the tool; expose `resolvePageRead()`
- `src/app/api/chat/route.ts` — `action: 'providePage'`
- `src/app/chat-panel.tsx` — auto-answer `pendingPageRead`, indicator
- `experiments/mastra-chat/FINDINGS.md`, `docs/recommendations/2026-09-22-dashboard-chat-context.md` — correct the false Haiku claim

---

### Task 1: Extract shaping and the per-run store

**Files:**
- Create: `src/lib/chat/context/page-extract.ts`
- Create: `src/lib/chat/context/page-store.ts`
- Test: `src/lib/__tests__/unit/chat-page-extract.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PageExtract = { path: string; title: string; heading: string; text: string }`; `clampExtract(e: unknown): PageExtract | null`; `putPageExtract(runId: string, e: PageExtract): void`; `takePageExtract(runId: string): PageExtract | undefined`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-page-extract.test.ts`:

```ts
import { clampExtract, MAX_TEXT } from '@/lib/chat/context/page-extract';
import { putPageExtract, takePageExtract, _resetPageStore } from '@/lib/chat/context/page-store';

describe('clampExtract', () => {
  it('collapses whitespace and trims', () => {
    const out = clampExtract({ path: ' /x ', title: 'A  \n B', heading: '', text: 'a  \n\n  b' });
    expect(out?.title).toBe('A B');
    expect(out?.text).toBe('a b');
    expect(out?.path).toBe('/x');
  });

  it('caps text at MAX_TEXT characters', () => {
    const out = clampExtract({ path: '/x', title: 't', heading: 'h', text: 'x'.repeat(MAX_TEXT + 5000) });
    expect(out!.text.length).toBe(MAX_TEXT);
  });

  it('tolerates missing fields', () => {
    const out = clampExtract({ path: '/x' });
    expect(out).toEqual({ path: '/x', title: '', heading: '', text: '' });
  });

  it('returns null for a non-object', () => {
    expect(clampExtract('nope')).toBeNull();
    expect(clampExtract(null)).toBeNull();
    expect(clampExtract(undefined)).toBeNull();
  });

  it('returns null when there is no usable content at all', () => {
    expect(clampExtract({ path: '/x', title: '', heading: '', text: '   ' })).toBeNull();
  });
});

describe('page store', () => {
  beforeEach(() => _resetPageStore());

  it('round-trips an extract by runId', () => {
    const e = { path: '/x', title: 't', heading: 'h', text: 'body' };
    putPageExtract('run-1', e);
    expect(takePageExtract('run-1')).toEqual(e);
  });

  it('is single-use — a second take returns undefined', () => {
    putPageExtract('run-1', { path: '/x', title: 't', heading: 'h', text: 'body' });
    takePageExtract('run-1');
    expect(takePageExtract('run-1')).toBeUndefined();
  });

  it('returns undefined for an unknown runId', () => {
    expect(takePageExtract('never-stored')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-page-extract"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/page-extract'`

- [ ] **Step 3: Implement the extract shaping**

Create `src/lib/chat/context/page-extract.ts`:

```ts
/** What the client scrapes from the rendered page. No page instrumentation required. */
export interface PageExtract {
  path: string;
  title: string;
  heading: string;
  text: string;
}

export const MAX_TEXT = 4000;
const MAX_SHORT = 200;

const squash = (v: unknown) => (typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();

/**
 * Normalise an untrusted extract from the request body.
 * Returns null for anything unusable so callers degrade instead of throwing.
 */
export function clampExtract(raw: unknown): PageExtract | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;

  const out: PageExtract = {
    path: squash(r.path).slice(0, MAX_SHORT),
    title: squash(r.title).slice(0, MAX_SHORT),
    heading: squash(r.heading).slice(0, MAX_SHORT),
    text: squash(r.text).slice(0, MAX_TEXT),
  };

  // Nothing worth reading — treat as absent rather than sending an empty page to the model.
  if (!out.title && !out.heading && !out.text) return null;
  return out;
}
```

- [ ] **Step 4: Implement the per-run store**

Create `src/lib/chat/context/page-store.ts`:

```ts
import type { PageExtract } from './page-extract';

/**
 * Hands a page extract from the `providePage` request to the suspended tool body.
 *
 * Keyed by Mastra's runId, which IS present in a tool's execute context (verified);
 * `resumeData` is NOT, which is why the handoff goes through here. Uses globalThis
 * for the same reason the progress and stop-signal stores do — it survives Next's
 * HMR module reloads in dev.
 *
 * Known limitation: per-process. The providePage request must reach the same replica
 * that suspended the run. Dev runs a single task, so this holds today; the durable
 * fix is persisting alongside the run snapshot.
 */
const KEY = '__glookerPageExtracts__';
type Store = Map<string, { extract: PageExtract; at: number }>;

const store: Store = ((globalThis as any)[KEY] ??= new Map());

/** Entries older than this are swept so an abandoned run cannot leak memory. */
const TTL_MS = 5 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.at < cutoff) store.delete(k);
}

export function putPageExtract(runId: string, extract: PageExtract): void {
  sweep();
  store.set(runId, { extract, at: Date.now() });
}

/** Single-use: reading removes it, so a stale extract cannot serve a later run. */
export function takePageExtract(runId: string): PageExtract | undefined {
  const hit = store.get(runId);
  if (!hit) return undefined;
  store.delete(runId);
  return hit.extract;
}

/** Test helper. */
export function _resetPageStore(): void {
  store.clear();
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-page-extract"`
Expected: PASS, 8 tests

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/chat/context/page-extract.ts src/lib/chat/context/page-store.ts \
        src/lib/__tests__/unit/chat-page-extract.test.ts
git commit -F /tmp/t1.txt   # message: "feat(chat): page extract shaping and per-run handoff store"
```

---

### Task 2: Ask Haiku a question about the page

**Files:**
- Create: `src/lib/chat/context/summarize-page.ts`
- Test: `src/lib/__tests__/unit/chat-summarize-page.test.ts`

**Interfaces:**
- Consumes: `PageExtract` from Task 1
- Produces: `answerFromPage(extract: PageExtract, question: string): Promise<string | null>` — returns null on any failure

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-summarize-page.test.ts`:

```ts
import { answerFromPage, HAIKU_MODEL, HAIKU_MODEL_VERSION } from '@/lib/chat/context/summarize-page';

jest.mock('@/lib/smartling-auth', () => ({ getAccessToken: jest.fn().mockResolvedValue('tok') }));

const extract = { path: '/settings', title: 'Settings', heading: 'Settings', text: 'LLM provider: smartling. Teams: 11.' };

function mockFetchOnce(body: any, ok = true) {
  (global as any).fetch = jest.fn().mockResolvedValue({
    ok, json: async () => body,
  });
}

beforeEach(() => jest.clearAllMocks());

describe('answerFromPage', () => {
  it('sends the model and version SPLIT, not combined', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [{ type: 'text', text: 'Settings page.' }] } } } });
    await answerFromPage(extract, 'what page is this?');
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    expect(body.request.model).toBe(HAIKU_MODEL);
    expect(body.request.modelVersion).toBe(HAIKU_MODEL_VERSION);
    expect(HAIKU_MODEL).toBe('claude-haiku-4-5');
    expect(HAIKU_MODEL_VERSION).toBe('20251001');
  });

  it('returns the model text', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [{ type: 'text', text: 'Settings page.' }] } } } });
    await expect(answerFromPage(extract, 'what page?')).resolves.toBe('Settings page.');
  });

  it('includes the question and the page text in the prompt', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [{ type: 'text', text: 'x' }] } } } });
    await answerFromPage(extract, 'how many teams?');
    const body = JSON.parse((global as any).fetch.mock.calls[0][1].body);
    const sent = JSON.stringify(body.request.payload.messages);
    expect(sent).toContain('how many teams?');
    expect(sent).toContain('Teams: 11.');
  });

  it('returns null on a proxy error envelope rather than throwing', async () => {
    mockFetchOnce({ response: { errors: [{ message: 'nope' }] } });
    await expect(answerFromPage(extract, 'q')).resolves.toBeNull();
  });

  it('returns null when fetch rejects rather than throwing', async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('network down'));
    await expect(answerFromPage(extract, 'q')).resolves.toBeNull();
  });

  it('returns null when the payload has no text content', async () => {
    mockFetchOnce({ response: { data: { payload: { content: [] } } } });
    await expect(answerFromPage(extract, 'q')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-summarize-page"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/summarize-page'`

- [ ] **Step 3: Implement**

Create `src/lib/chat/context/summarize-page.ts`:

```ts
import { getAccessToken } from '@/lib/smartling-auth';
import type { PageExtract } from './page-extract';

/**
 * The catalog entry is DATED and has no bare alias, and /anthropicai/chat wants the
 * model and version SPLIT. `claude-haiku-4-5-20251001` with version "latest" is
 * rejected — that mistake is what produced the false "Haiku is unavailable" finding.
 */
export const HAIKU_MODEL = 'claude-haiku-4-5';
export const HAIKU_MODEL_VERSION = '20251001';

const TIMEOUT_MS = 8000;

const endpoint = () =>
  `${process.env.SMARTLING_BASE_URL}/ai-proxy-api/v2/accounts/${process.env.SMARTLING_ACCOUNT_UID}/anthropicai/chat`;

const SYSTEM =
  'You are reading the text of a web page the user is looking at. Answer the ' +
  'question using ONLY that text. Be specific and under 60 words. If the page ' +
  'does not contain the answer, say so plainly rather than guessing.';

/** Returns null on ANY failure so the caller degrades instead of breaking the chat. */
export async function answerFromPage(extract: PageExtract, question: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getAccessToken()}` },
      signal: controller.signal,
      body: JSON.stringify({
        requestParameters: { timeout: TIMEOUT_MS, operationName: 'glooker_chat_page_read' },
        request: {
          model: HAIKU_MODEL,
          modelVersion: HAIKU_MODEL_VERSION,
          payload: {
            max_tokens: 300,
            system: SYSTEM,
            messages: [{
              role: 'user',
              content: [{
                type: 'text',
                text:
                  `Question: ${question}\n\n` +
                  `Page path: ${extract.path}\nTitle: ${extract.title}\nHeading: ${extract.heading}\n\n` +
                  extract.text,
              }],
            }],
          },
        },
      }),
    });

    const json: any = await res.json().catch(() => null);
    const env = json?.response;
    if (!res.ok || env?.errors?.length) return null;

    const text = (env?.data?.payload?.content ?? [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('')
      .trim();
    return text || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-summarize-page"`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/lib/chat/context/summarize-page.ts src/lib/__tests__/unit/chat-summarize-page.test.ts
git commit -F /tmp/t2.txt   # message: "feat(chat): answer a question from page text via Haiku"
```

---

### Task 3: The tool itself

**Files:**
- Create: `src/lib/chat/context/page-read-tool.ts`
- Test: `src/lib/__tests__/unit/chat-page-read-tool.test.ts`

**Interfaces:**
- Consumes: `takePageExtract` (Task 1), `answerFromPage` (Task 2)
- Produces: `buildPageReadTool()` returning `{ readCurrentPage }`; `PAGE_READ_TOOL_ID = 'readCurrentPage'`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-page-read-tool.test.ts`:

```ts
import { buildPageReadTool, PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';
import { putPageExtract, _resetPageStore } from '@/lib/chat/context/page-store';

jest.mock('@/lib/chat/context/summarize-page', () => ({
  answerFromPage: jest.fn(),
}));
import { answerFromPage } from '@/lib/chat/context/summarize-page';

const extract = { path: '/x', title: 'Settings', heading: 'Settings', text: 'Teams: 11.' };

beforeEach(() => { _resetPageStore(); jest.clearAllMocks(); });

describe('readCurrentPage', () => {
  it('is registered under the id the system prompt names', () => {
    expect(PAGE_READ_TOOL_ID).toBe('readCurrentPage');
    expect(buildPageReadTool()[PAGE_READ_TOOL_ID]).toBeDefined();
  });

  it('suspends before running — requireApproval is set', () => {
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    expect(tool.requireApproval).toBe(true);
  });

  it('answers from the stored extract', async () => {
    (answerFromPage as jest.Mock).mockResolvedValue('There are 11 teams.');
    putPageExtract('run-1', extract);
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'how many teams?' }, { runId: 'run-1' });
    expect(answerFromPage).toHaveBeenCalledWith(extract, 'how many teams?');
    expect(JSON.stringify(out)).toContain('There are 11 teams.');
  });

  it('resolves — does not throw — when no extract was supplied', async () => {
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'q' }, { runId: 'missing' });
    expect(JSON.stringify(out).toLowerCase()).toContain('unavailable');
    expect(answerFromPage).not.toHaveBeenCalled();
  });

  it('resolves when Haiku returns null', async () => {
    (answerFromPage as jest.Mock).mockResolvedValue(null);
    putPageExtract('run-2', extract);
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'q' }, { runId: 'run-2' });
    expect(JSON.stringify(out).toLowerCase()).toContain('could not read');
  });

  it('labels its answer as read from the screen, not fetched', async () => {
    (answerFromPage as jest.Mock).mockResolvedValue('Settings page.');
    putPageExtract('run-3', extract);
    const tool: any = buildPageReadTool()[PAGE_READ_TOOL_ID];
    const out = await tool.execute({ question: 'q' }, { runId: 'run-3' });
    expect(JSON.stringify(out).toLowerCase()).toContain('rendered page');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-page-read-tool"`
Expected: FAIL — `Cannot find module '@/lib/chat/context/page-read-tool'`

- [ ] **Step 3: Implement**

Create `src/lib/chat/context/page-read-tool.ts`:

```ts
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { takePageExtract } from './page-store';
import { answerFromPage } from './summarize-page';

export const PAGE_READ_TOOL_ID = 'readCurrentPage';

/**
 * Lets the agent look at the page the user is on.
 *
 * `requireApproval: true` is used as a SUSPEND PRIMITIVE, not a consent gate: the
 * run suspends, the client automatically posts the page extract, the route stores
 * it by runId and resumes. The user is never prompted.
 *
 * Why not suspendSchema/resumeSchema: probe-verified that an agent tool's execute
 * context exposes no `suspend`, and approveToolCallGenerate does not forward
 * resumeData. `runId` IS in the context, so the store is the handoff.
 *
 * Always RESOLVES. A page-read failure must never break an answer the agent could
 * otherwise have given.
 */
export function buildPageReadTool() {
  const readCurrentPage = createTool({
    id: PAGE_READ_TOOL_ID,
    description:
      'Read the page the user is currently looking at, to answer a question about it. ' +
      'Use when the user refers to something on their screen that your data tools cannot ' +
      'resolve. Pass the question you actually need answered. The answer is read off the ' +
      'rendered page, not fetched from the database.',
    inputSchema: z.object({
      question: z.string().describe('The question to answer from the page content.'),
    }),
    requireApproval: true,
    execute: async (input: any, ctx: any) => {
      const question = String(input?.question ?? '').slice(0, 500);
      const extract = takePageExtract(ctx?.runId ?? '');

      if (!extract) {
        return {
          ok: false,
          note: 'Page content unavailable — the page could not be read. Answer from your other tools, and say you could not see the screen.',
        };
      }

      const answer = await answerFromPage(extract, question);
      if (!answer) {
        return { ok: false, note: 'Could not read the page just now. Answer from your other tools instead.' };
      }

      return {
        ok: true,
        source: 'rendered page (read off the screen, not fetched from the database)',
        path: extract.path,
        answer,
      };
    },
  } as any);

  return { [PAGE_READ_TOOL_ID]: readCurrentPage };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest --testPathPatterns="chat-page-read-tool"`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/lib/chat/context/page-read-tool.ts src/lib/__tests__/unit/chat-page-read-tool.test.ts
git commit -F /tmp/t3.txt   # message: "feat(chat): readCurrentPage tool backed by the per-run extract store"
```

---

### Task 4: Wire the tool into the agent, the prompt, and the route

**Files:**
- Modify: `src/lib/chat/engines/types.ts`
- Modify: `src/lib/chat/engines/mastra.ts`
- Modify: `src/app/api/chat/route.ts`
- Test: `src/lib/__tests__/unit/chat-page-read-wiring.test.ts`

**Interfaces:**
- Consumes: `buildPageReadTool`, `PAGE_READ_TOOL_ID` (Task 3), `putPageExtract` (Task 1), `clampExtract` (Task 1)
- Produces: `resolvePageRead(opts & { runId, toolCallId, extract }): Promise<EngineResult>` exported from `mastra.ts`; `EngineResult.pendingPageRead?: { runId, toolCallId, question }`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-page-read-wiring.test.ts`:

```ts
import { CHAT_SYSTEM } from '@/lib/chat/engines/types';
import { PAGE_READ_TOOL_ID } from '@/lib/chat/context/page-read-tool';

describe('system prompt', () => {
  it('names the page-read tool so the model knows it exists', () => {
    expect(CHAT_SYSTEM).toContain(PAGE_READ_TOOL_ID);
  });

  it('tells the model it cannot see the screen unaided', () => {
    expect(CHAT_SYSTEM.toLowerCase()).toContain('cannot see');
  });

  it('warns that the result is read from the page, not fetched', () => {
    expect(CHAT_SYSTEM.toLowerCase()).toContain('rendered page');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-page-read-wiring"`
Expected: FAIL — `CHAT_SYSTEM` does not contain `readCurrentPage`

- [ ] **Step 3: Add the prompt paragraph**

In `src/lib/chat/engines/types.ts`, append to the `CHAT_SYSTEM` template literal, before the closing backtick:

```
Seeing the user's screen:
You CANNOT see the user's screen on your own. When they refer to something they
are looking at — "this page", "here", "what am I seeing" — and your data tools
cannot resolve it, call readCurrentPage with the question you need answered.
Do not guess, and do not tell the user you lack access: the tool is how you look.
What comes back is read off the rendered page, not fetched from the database —
treat it as context, say where it came from, and never present it as a verified figure.
```

- [ ] **Step 4: Register the tool on the mastra agent**

In `src/lib/chat/engines/mastra.ts`, import at the top:

```ts
import { buildPageReadTool } from '@/lib/chat/context/page-read-tool';
```

and in `withMastra`'s agent construction, add it alongside the existing read and write tools:

```ts
    tools: {
      ...readTools,
      ...buildWriteTools({ org: opts.org, baseUrl: opts.baseUrl, forward: opts.forward, isAdmin: opts.isAdmin }),
      ...buildPageReadTool(),
    },
```

- [ ] **Step 5: Surface the pending page read**

In `src/lib/chat/engines/types.ts`, add to `EngineResult`:

```ts
  /** Set when the agent asked to read the page; the client must supply an extract. */
  pendingPageRead?: { runId: string; toolCallId: string; question: string };
```

In `src/lib/chat/engines/mastra.ts`, the existing `pendingFrom` helper already builds `pendingApproval` from `res.suspendPayload`. Change it to route by tool name — a suspend from `readCurrentPage` is a page read, anything else is a write approval:

```ts
function pendingFrom(res: any, toolCount: number, toolCalls: string[], started: number): EngineResult {
  const sp = res.suspendPayload ?? {};
  const base = { toolCalls, engine: 'mastra' as const, toolCount, ms: Date.now() - started };

  if (sp.toolName === PAGE_READ_TOOL_ID) {
    return {
      ...base,
      response: (res.text ?? '').trim() || 'Reading the page…',
      pendingPageRead: {
        runId: res.runId,
        toolCallId: sp.toolCallId,
        question: String(sp.args?.question ?? ''),
      },
    };
  }

  return {
    ...base,
    response: (res.text ?? '').trim() ||
      `This needs your approval before it runs: ${sp.toolName}(${JSON.stringify(sp.args ?? {})}).`,
    pendingApproval: { runId: res.runId, toolCallId: sp.toolCallId, toolName: sp.toolName, args: sp.args ?? {} },
  };
}
```

Import `PAGE_READ_TOOL_ID` in `mastra.ts` alongside `buildPageReadTool`.

- [ ] **Step 6: Add the resume entry point**

In `src/lib/chat/engines/mastra.ts`, add beside `resolveMastraApproval`:

```ts
/** Supply the page extract the agent asked for, then let the run continue. */
export async function resolvePageRead(
  opts: MastraEngineOpts & { runId: string; toolCallId: string; extract: PageExtract },
): Promise<EngineResult> {
  const started = Date.now();
  const { mcp, toolCalls, toolCount, agent } = await withMastra(opts);
  try {
    putPageExtract(opts.runId, opts.extract);
    const res: any = await agent.approveToolCallGenerate({
      runId: opts.runId,
      toolCallId: opts.toolCallId,
    });

    if (res?.finishReason === 'suspended') return pendingFrom(res, toolCount, toolCalls, started);

    const text = (res?.text ?? '').trim();
    return {
      response: text || 'I read the page but could not form an answer.',
      toolCalls, engine: 'mastra', toolCount, ms: Date.now() - started,
    };
  } finally {
    await mcp.disconnect().catch(() => {});
  }
}
```

with imports `import { putPageExtract } from '@/lib/chat/context/page-store';` and `import type { PageExtract } from '@/lib/chat/context/page-extract';`.

- [ ] **Step 7: Add the route action**

In `src/app/api/chat/route.ts`, widen the destructured body type with `pageExtract?: unknown;` and the action union with `'providePage'`, import `clampExtract` and `resolvePageRead`, then inside the existing `if (action)` block, before the approve/decline handling:

```ts
      if (action === 'providePage') {
        if (!runId || !toolCallId) {
          return NextResponse.json({ error: 'runId and toolCallId are required' }, { status: 400 });
        }
        const extract = clampExtract(pageExtract);
        if (!extract) {
          return NextResponse.json({ error: 'a usable pageExtract is required' }, { status: 400 });
        }
        return NextResponse.json(
          await resolvePageRead({ ...engineOpts, runId, toolCallId, extract }),
        );
      }
```

- [ ] **Step 8: Verify**

Run: `npx jest --testPathPatterns="chat" && npx tsc --noEmit`
Expected: all chat suites PASS, tsc clean

- [ ] **Step 9: Commit**

```bash
git add src/lib/chat/engines/types.ts src/lib/chat/engines/mastra.ts src/app/api/chat/route.ts \
        src/lib/__tests__/unit/chat-page-read-wiring.test.ts
git commit -F /tmp/t4.txt   # message: "feat(chat): register readCurrentPage and add the providePage resume action"
```

---

### Task 5: The client answers automatically

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Test: `src/lib/__tests__/unit/chat-page-read-client.test.tsx`

**Interfaces:**
- Consumes: `pendingPageRead` on the chat response (Task 4)
- Produces: nothing downstream

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/unit/chat-page-read-client.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import { collectPageExtract } from '@/app/chat-panel';

describe('collectPageExtract', () => {
  beforeEach(() => { document.body.innerHTML = ''; document.title = 'Glooker'; });

  it('reads title, first h1 and main text', () => {
    document.title = 'Settings — Glooker';
    document.body.innerHTML = '<main><h1>Settings</h1><p>Teams: 11</p></main>';
    const e = collectPageExtract()!;
    expect(e.title).toBe('Settings — Glooker');
    expect(e.heading).toBe('Settings');
    expect(e.text).toContain('Teams: 11');
  });

  it('falls back to body when there is no main landmark', () => {
    document.body.innerHTML = '<div><h1>Reports</h1><p>Ten reports</p></div>';
    expect(collectPageExtract()!.text).toContain('Ten reports');
  });

  it('records the current path', () => {
    document.body.innerHTML = '<main>x</main>';
    expect(collectPageExtract()!.path).toBe(window.location.pathname);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest --testPathPatterns="chat-page-read-client"`
Expected: FAIL — `collectPageExtract` is not exported from `@/app/chat-panel`

- [ ] **Step 3: Add and export the collector**

In `src/app/chat-panel.tsx`, above the default-exported component, add:

```tsx
/** Scrape the rendered page. No instrumentation required, so it works on any route. */
export function collectPageExtract() {
  if (typeof document === 'undefined') return null;
  const main = (document.querySelector('main') ?? document.body) as HTMLElement | null;
  return {
    path: window.location.pathname,
    title: document.title ?? '',
    heading: document.querySelector('h1')?.textContent ?? '',
    text: main?.innerText ?? main?.textContent ?? '',
  };
}
```

Note: `chat-panel.tsx` is a component file, not an App Router `page.tsx`, so a named export beside the default is allowed here.

- [ ] **Step 4: Auto-answer the pending read**

In `src/app/chat-panel.tsx`, add state beside the existing `pending` state:

```tsx
  const [readingPage, setReadingPage] = useState(false);
```

Add the handler beside `resolveApproval`:

```tsx
  async function providePage(p: { runId: string; toolCallId: string }) {
    setReadingPage(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org, engine, action: 'providePage',
          runId: p.runId, toolCallId: p.toolCallId,
          pageExtract: collectPageExtract(),
        }),
      });
      const data = await res.json();
      setMessages(m => [...m, {
        role: 'assistant',
        content: data.error ? `Error: ${data.error}` : data.response,
      }]);
      if (data.pendingPageRead) await providePage(data.pendingPageRead);
      setPending(data.pendingApproval ?? null);
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: 'Error: could not read the page.' }]);
    } finally {
      setReadingPage(false);
    }
  }
```

In `send()`, immediately after `setPending(data.pendingApproval ?? null);`, add:

```tsx
        if (data.pendingPageRead) await providePage(data.pendingPageRead);
```

and add the same line after the equivalent assignment in `resolveApproval`.

- [ ] **Step 5: Show the indicator**

In `src/app/chat-panel.tsx`, next to the existing loading indicator, render when `readingPage` is true:

```tsx
          {readingPage && (
            <div className="px-3 pb-2 text-[11px] text-gray-500">Reading the page…</div>
          )}
```

- [ ] **Step 6: Verify**

Run: `npx jest --testPathPatterns="chat" && npx tsc --noEmit && npx jest --maxWorkers=3`
Expected: chat suites PASS, tsc clean, full suite green

- [ ] **Step 7: Commit**

```bash
git add src/app/chat-panel.tsx src/lib/__tests__/unit/chat-page-read-client.test.tsx
git commit -F /tmp/t5.txt   # message: "feat(chat): client answers a page-read request automatically"
```

---

### Task 6: Prove it end to end, and correct the record

**Files:**
- Create: `experiments/mastra-chat/spike-09-page-read.ts`
- Modify: `experiments/mastra-chat/FINDINGS.md`
- Modify: `docs/recommendations/2026-09-22-dashboard-chat-context.md`

**Interfaces:**
- Consumes: everything above
- Produces: nothing downstream

- [ ] **Step 1: Write the live check**

Create `experiments/mastra-chat/spike-09-page-read.ts` — an end-to-end exercise against the real proxy, modelled on the existing spikes in that directory. It must: build the mastra agent with the page-read tool, ask a question that cannot be answered from the tier-1/2 descriptor alone, assert the run suspends with `pendingPageRead`, supply a synthetic extract, resume, and print the final answer.

Run it with `npx tsx experiments/mastra-chat/spike-09-page-read.ts` against `.env.local`. Record: whether the model called the tool unprompted, the answer text, and the token cost of the Haiku call.

- [ ] **Step 2: Run the local deploy check**

Start the app (`DB_TYPE=mysql DB_HOST=127.0.0.1 DB_PORT=3308 DB_USER=glooker DB_PASSWORD=glooker DB_NAME=glooker npm run dev`), then POST a chat message on an unregistered path and confirm the response carries `pendingPageRead`. Stop the server afterwards.

- [ ] **Step 3: Correct the false Haiku claim**

In `experiments/mastra-chat/FINDINGS.md` and `docs/recommendations/2026-09-22-dashboard-chat-context.md`, both currently state that Haiku is not invocable on this account. That is false. Replace with: Haiku IS available as `claude-haiku-4-5` + `modelVersion: "20251001"`; the earlier probe passed `"latest"`, which works only for undated models. State plainly that tier 3's deletion therefore rested on a reason that did not hold, and that the replacement is the model-invoked tool rather than a restoration.

- [ ] **Step 4: Record the asymmetry**

Add to `experiments/mastra-chat/FINDINGS.md`: `readCurrentPage` exists only on the mastra engine, because the control arm has no suspend/resume and no persisted run state. This is the first capability in the experiment that only Mastra provides — real evidence for adoption, and the end of the like-for-like comparison. Report both halves.

- [ ] **Step 5: Commit**

```bash
git add experiments/mastra-chat docs/recommendations
git commit -F /tmp/t6.txt   # message: "docs: page-read findings; correct the false Haiku-unavailable claim"
```

---

## Self-Review

**Spec coverage:** Extract + store → Task 1. Haiku call with the split model id → Task 2. Tool with `requireApproval` as suspend, resolving on every failure → Task 3. Prompt paragraph, agent registration, `pendingPageRead`, `providePage` action → Task 4. Client auto-answer and indicator → Task 5. Live proof, the Haiku correction, and the asymmetry finding → Task 6. Control arm deliberately excluded — stated in Global Constraints and Task 6. No gaps.

**Placeholder scan:** No TBD/TODO. Task 6 Step 1 describes a spike by its required assertions rather than giving full code — acceptable because it is a throwaway probe whose exact shape depends on the live response, and its required outputs are enumerated.

**Type consistency:** `PageExtract` has the same four fields in Tasks 1, 2, 3 and 5. `clampExtract` returns `PageExtract | null` and every caller handles null. `answerFromPage` returns `string | null`, checked in Task 3. `PAGE_READ_TOOL_ID` is the single source of the tool name, used in Tasks 3, 4 and the prompt test. `pendingPageRead` has identical fields in Tasks 4 and 5.
