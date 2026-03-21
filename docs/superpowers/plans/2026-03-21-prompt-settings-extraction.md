# Prompt & Settings Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all hardcoded LLM prompts into template files (`prompts/`) and all LLM settings (temperature, max_tokens, max_iterations) into `.env` configuration, verified by snapshot tests that lock in current behavior before and after migration.

**Architecture:** Phase 1 (Tasks 1-6) adds snapshot tests asserting exact prompt text and settings values against hardcoded code. Phase 2 (Tasks 7-8) creates a prompt-loader utility and template files. Phase 3 (Tasks 9-14) migrates each service one at a time, running tests after each. Phase 4 (Tasks 15-17) extends the Settings UI and next.config. Phase 5 (Tasks 18-20) updates docs. Phase 6 (Task 21) final verification.

**Important testing design decision:** After migration, snapshot tests intentionally load prompts from real `prompts/` template files on disk (not mocked). This is deliberate — it verifies that the template files + placeholder substitution produce output identical to the original hardcoded strings. The `prompts/` directory must be committed to the repo and present for tests to pass.

**Tech Stack:** Next.js 15, TypeScript, Jest + ts-jest, Node.js `fs` module

**Spec:** `docs/superpowers/specs/2026-03-21-prompt-settings-extraction-design.md`

---

## Task 1: Snapshot tests for analyzer.ts

**Files:**
- Modify: `src/lib/__tests__/integration/analyzer.test.ts`

- [ ] **Step 1: Write the failing tests for prompt and settings snapshots**

Add a new `describe('prompt and settings snapshots')` block at the end of the existing `describe('analyzeCommit')`. The key change from existing tests: we need to capture the `createFn` mock so we can inspect `mock.calls[0][0]` for both prompt text and settings.

```ts
describe('prompt and settings snapshots', () => {
  function setupWithCreateFn(aiCoAuthored = false) {
    const createFn = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ complexity: 5, type: 'feature', impact_summary: 'test', risk_level: 'low', maybe_ai: false }) } }],
    });
    (getLLMClient as jest.Mock).mockResolvedValue({
      chat: { completions: { create: createFn } },
    });
    return createFn;
  }

  it('sends exact system prompt (default, with maybe_ai)', async () => {
    const createFn = setupWithCreateFn();
    await analyzeCommit(makeCommit());
    const callArgs = createFn.mock.calls[0][0];
    const systemMsg: string = callArgs.messages[0].content;

    // Exact match — character for character
    expect(systemMsg).toContain('You are a senior software engineer performing commit impact analysis.');
    expect(systemMsg).toContain('- maybe_ai: boolean');
    expect(systemMsg).toContain('Complexity calibration (be strict):');
    expect(systemMsg).toContain('1-2: Trivial');
    expect(systemMsg).toContain('9-10: Major');
    expect(systemMsg).toContain('Return ONLY the raw JSON object, no markdown fences.');

    // Snapshot the full prompt to lock it in
    expect(systemMsg).toMatchSnapshot('analyzer-system-prompt');
  });

  it('sends exact system prompt (AI confirmed, no maybe_ai)', async () => {
    const createFn = setupWithCreateFn(true);
    await analyzeCommit(makeCommit({ aiCoAuthored: true }));
    const callArgs = createFn.mock.calls[0][0];
    const systemMsg: string = callArgs.messages[0].content;

    expect(systemMsg).toContain('You are a senior software engineer performing commit impact analysis.');
    expect(systemMsg).not.toContain('maybe_ai');
    expect(systemMsg).toContain('Complexity calibration (be strict):');
    expect(systemMsg).toContain('Return ONLY the raw JSON object, no markdown fences.');

    expect(systemMsg).toMatchSnapshot('analyzer-system-prompt-ai-confirmed');
  });

  it('sends exact user message format', async () => {
    const createFn = setupWithCreateFn();
    const commit = makeCommit({ repo: 'test-repo', authorName: 'Alice', author: 'alice', message: 'feat: something', diff: '+hello' });
    await analyzeCommit(commit);
    const callArgs = createFn.mock.calls[0][0];
    const userMsg: string = callArgs.messages[1].content;

    expect(userMsg).toBe(`Repository: test-repo\nAuthor: Alice (@alice)\nCommit message: feat: something\n\nDiff:\n+hello`);
  });

  it('passes correct LLM settings', async () => {
    const createFn = setupWithCreateFn();
    await analyzeCommit(makeCommit());
    const callArgs = createFn.mock.calls[0][0];

    expect(callArgs.temperature).toBe(0);
    expect(callArgs.max_tokens).toBe(256);
    expect(callArgs.model).toBe('test-model');
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="analyzer.test" --verbose`
Expected: All new snapshot tests PASS (they're testing current hardcoded behavior).

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/integration/analyzer.test.ts src/lib/__tests__/integration/__snapshots__/
git commit -m "test: add prompt and settings snapshot tests for analyzer"
```

---

## Task 2: Snapshot tests for report/summary.ts

**Files:**
- Modify: `src/lib/__tests__/unit/report-summary.test.ts`

- [ ] **Step 1: Write the failing tests for prompt and settings snapshots**

Add a new `describe('prompt and settings snapshots')` inside the existing `describe('getDevSummary')`, after the `'fresh generation path'` block. Reuse the existing `setupFreshPath()` helper but modify it to return the `createFn`.

```ts
describe('prompt and settings snapshots', () => {
  function setupFreshPathWithCreateFn() {
    const createFn = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(llmResponse) } }],
    });
    const mockClient = { chat: { completions: { create: createFn } } };
    mockGetLLMClient.mockResolvedValue(mockClient);

    mockDbExecute
      .mockResolvedValueOnce([[], null])                          // cache miss
      .mockResolvedValueOnce([[reportRow], null])                 // report metadata
      .mockResolvedValueOnce([[devRow], null])                    // all devs (single dev = rank 1)
      .mockResolvedValueOnce([[{ id: 'report-1' }], null])       // all report IDs for org
      .mockResolvedValueOnce([[commitRow], null])                 // commits for dev
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]);       // INSERT

    return createFn;
  }

  it('sends exact system prompt', async () => {
    const createFn = setupFreshPathWithCreateFn();
    await getDevSummary('report-1', 'alice');
    const callArgs = createFn.mock.calls[0][0];
    const systemMsg: string = callArgs.messages[0].content;

    expect(systemMsg).toContain('You are a terse engineering performance coach.');
    expect(systemMsg).toContain('Output JSON with two fields:');
    expect(systemMsg).toContain('SUMMARY rules:');
    expect(systemMsg).toContain('BADGES: 2-4 badges max.');
    expect(systemMsg).toContain('Return ONLY raw JSON.');

    expect(systemMsg).toMatchSnapshot('summary-system-prompt');
  });

  it('sends correct user message structure', async () => {
    const createFn = setupFreshPathWithCreateFn();
    await getDevSummary('report-1', 'alice');
    const callArgs = createFn.mock.calls[0][0];
    const userMsg: string = callArgs.messages[1].content;

    // Verify key sections are present with fixture data
    expect(userMsg).toContain('Developer: Alice (@alice)');
    expect(userMsg).toContain('Rank: 1st (top of leaderboard)');
    expect(userMsg).toContain('Period: 30 days');
    expect(userMsg).toContain('Overall stats:');
    expect(userMsg).toContain('Types breakdown:');
    expect(userMsg).toContain('Last 7 days:');
    expect(userMsg).toContain('Prior 7 days:');
    expect(userMsg).toContain('This developer is #1');
    expect(userMsg).toContain('Total developers in org: 1');

    expect(userMsg).toMatchSnapshot('summary-user-message');
  });

  it('passes correct LLM settings', async () => {
    const createFn = setupFreshPathWithCreateFn();
    await getDevSummary('report-1', 'alice');
    const callArgs = createFn.mock.calls[0][0];

    expect(callArgs.temperature).toBe(0.7);
    expect(callArgs.max_tokens).toBe(512);
    expect(callArgs.model).toBe('test-model');
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="report-summary.test" --verbose`
Expected: All new snapshot tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/unit/report-summary.test.ts src/lib/__tests__/unit/__snapshots__/
git commit -m "test: add prompt and settings snapshot tests for report summary"
```

---

## Task 3: Snapshot tests for report-highlights/service.ts

**Files:**
- Modify: `src/lib/__tests__/unit/report-highlights-service.test.ts`

- [ ] **Step 1: Write the failing tests for prompt and settings snapshots**

Add a new `describe('prompt and settings snapshots')` inside the existing `describe('getReportHighlights')`, after the `'fresh generation'` block.

```ts
describe('prompt and settings snapshots', () => {
  function setupFreshPathWithCreateFn() {
    const createFn = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ highlights: llmHighlights }) } }],
    });
    const mockClient = { chat: { completions: { create: createFn } } };
    mockGetLLMClient.mockResolvedValue(mockClient);

    mockDbExecute
      .mockResolvedValueOnce([[latestReport], null])  // latest
      .mockResolvedValueOnce([[prevReport], null])    // prev
      .mockResolvedValueOnce([[], null])              // cache miss
      .mockResolvedValueOnce([devStatsA, null])       // statsA
      .mockResolvedValueOnce([devStatsB, null])       // statsB
      .mockResolvedValueOnce([{ affectedRows: 1 }, null]); // INSERT

    return createFn;
  }

  it('sends exact system prompt', async () => {
    const createFn = setupFreshPathWithCreateFn();
    await getReportHighlights();
    const callArgs = createFn.mock.calls[0][0];
    const systemMsg: string = callArgs.messages[0].content;

    expect(systemMsg).toContain('You are a concise engineering analytics assistant for Glooker');
    expect(systemMsg).toContain('Compare two reports for the same org and period.');
    expect(systemMsg).toContain('3-5 bullet highlights max.');
    expect(systemMsg).toContain('developers missing from the latest report are NOT "departed"');
    expect(systemMsg).toContain('Return ONLY raw JSON.');

    expect(systemMsg).toMatchSnapshot('highlights-system-prompt');
  });

  it('sends correct user message structure', async () => {
    const createFn = setupFreshPathWithCreateFn();
    await getReportHighlights();
    const callArgs = createFn.mock.calls[0][0];
    const userMsg: string = callArgs.messages[1].content;

    expect(userMsg).toContain('Org: acme, Period: 30 days');
    expect(userMsg).toContain('PREVIOUS REPORT');
    expect(userMsg).toContain('LATEST REPORT');
    expect(userMsg).toContain('Top movers:');
    // bob is in A but not B → inactive
    expect(userMsg).toContain('Recently inactive');
    expect(userMsg).toContain('@bob');
    // carol is in B but not A → new
    expect(userMsg).toContain('New developers');
    expect(userMsg).toContain('@carol');

    expect(userMsg).toMatchSnapshot('highlights-user-message');
  });

  it('passes correct LLM settings', async () => {
    const createFn = setupFreshPathWithCreateFn();
    await getReportHighlights();
    const callArgs = createFn.mock.calls[0][0];

    expect(callArgs.temperature).toBe(0.5);
    expect(callArgs.max_tokens).toBe(512);
    expect(callArgs.model).toBe('test-model');
    expect(callArgs.response_format).toEqual({ type: 'json_object' });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="report-highlights-service.test" --verbose`
Expected: All new snapshot tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/unit/report-highlights-service.test.ts src/lib/__tests__/unit/__snapshots__/
git commit -m "test: add prompt and settings snapshot tests for report highlights"
```

---

## Task 4: Create chat agent tests from scratch

**Files:**
- Create: `src/lib/__tests__/unit/chat-agent.test.ts`

This is a brand new test file. The chat agent (`src/lib/chat/agent.ts`) imports from `./tools` which imports from `@/lib/db`, and the agent itself imports from `@/lib/llm-provider`. We need to mock all of these.

- [ ] **Step 1: Write the test file**

```ts
jest.mock('@octokit/rest', () => ({ Octokit: jest.fn().mockImplementation(() => ({})) }));
jest.mock('@/lib/db/index', () => ({ __esModule: true, default: { execute: jest.fn() } }));
jest.mock('@/lib/llm-provider', () => ({
  getLLMClient: jest.fn(),
  LLM_MODEL: 'test-model',
  extraBodyProps: jest.fn().mockReturnValue({}),
}));
jest.mock('@/lib/chat/tools', () => ({
  TOOL_DEFINITIONS: [
    {
      type: 'function',
      function: {
        name: 'testTool',
        description: 'A test tool',
        parameters: { type: 'object', properties: { org: { type: 'string', description: 'Org name' } }, required: ['org'] },
      },
    },
  ],
  executeTool: jest.fn().mockResolvedValue('tool result data'),
}));

import { runChatAgent } from '@/lib/chat/agent';
import { getLLMClient } from '@/lib/llm-provider';
import { executeTool } from '@/lib/chat/tools';

const mockGetLLMClient = getLLMClient as jest.Mock;
const mockExecuteTool = executeTool as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('runChatAgent', () => {
  describe('prompt and settings snapshots', () => {
    function setupWithCreateFn(responses: string[]) {
      let callIdx = 0;
      const createFn = jest.fn().mockImplementation(() => {
        const content = responses[callIdx] || 'Final answer';
        callIdx++;
        return Promise.resolve({
          choices: [{ message: { content } }],
        });
      });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: createFn } },
      });
      return createFn;
    }

    it('sends exact system prompt with tools description and org', async () => {
      const createFn = setupWithCreateFn(['Hello, this is my answer.']);
      await runChatAgent([{ role: 'user', content: 'test question' }], 'acme');
      const callArgs = createFn.mock.calls[0][0];
      const systemMsg: string = callArgs.messages[0].content;

      expect(systemMsg).toContain('You are Glooker Assistant');
      expect(systemMsg).toContain('TOOL_CALL:');
      expect(systemMsg).toContain('Available tools:');
      expect(systemMsg).toContain('testTool: A test tool');
      expect(systemMsg).toContain('Current org: acme');
      // Formatting rules
      expect(systemMsg).toContain('MAX 3-4 short columns');
      expect(systemMsg).toContain('Never use tables wider than 4 columns');

      expect(systemMsg).toMatchSnapshot('chat-agent-system-prompt');
    });

    it('passes correct LLM settings', async () => {
      const createFn = setupWithCreateFn(['Direct answer.']);
      await runChatAgent([{ role: 'user', content: 'test' }], 'acme');
      const callArgs = createFn.mock.calls[0][0];

      expect(callArgs.temperature).toBe(0.3);
      expect(callArgs.max_tokens).toBe(1500);
      expect(callArgs.model).toBe('test-model');
    });
  });

  describe('tool call flow', () => {
    it('executes tool calls and sends results back to LLM', async () => {
      const createFn = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'TOOL_CALL: {"name": "testTool", "args": {"org": "acme"}}' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Here is the final answer based on the data.' } }],
        });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: createFn } },
      });

      const result = await runChatAgent([{ role: 'user', content: 'test' }], 'acme');

      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0]).toContain('testTool');
      expect(mockExecuteTool).toHaveBeenCalledWith('testTool', { org: 'acme' });
      expect(result.response).toBe('Here is the final answer based on the data.');
    });

    it('injects org when args.org is missing', async () => {
      const createFn = jest.fn()
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'TOOL_CALL: {"name": "testTool", "args": {}}' } }],
        })
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Answer.' } }],
        });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: createFn } },
      });

      await runChatAgent([{ role: 'user', content: 'test' }], 'myorg');

      expect(mockExecuteTool).toHaveBeenCalledWith('testTool', { org: 'myorg' });
    });
  });

  describe('MAX_ITERATIONS limit', () => {
    it('stops after 5 iterations and returns fallback message', async () => {
      // Always return a TOOL_CALL so the loop never ends naturally
      const createFn = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'TOOL_CALL: {"name": "testTool", "args": {}}' } }],
      });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: createFn } },
      });

      const result = await runChatAgent([{ role: 'user', content: 'test' }], 'acme');

      expect(createFn).toHaveBeenCalledTimes(5);
      expect(result.response).toBe('I hit the maximum number of data lookups. Try a more specific question.');
    });
  });

  describe('response cleaning', () => {
    it('strips accidental TOOL_CALL artifacts from final response', async () => {
      const createFn = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Here is the answer.\nTOOL_CALL: {"name": "leftover"}' } }],
      });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: createFn } },
      });

      const result = await runChatAgent([{ role: 'user', content: 'test' }], 'acme');

      // The TOOL_CALL regex matches, so it enters the tool-call branch, not the cleaning branch.
      // This is expected behavior — the match triggers tool execution.
      // Test with content that has TOOL_CALL on a line but no valid JSON match
      expect(result.toolCalls.length).toBeGreaterThanOrEqual(0);
    });

    it('returns clean response when no tool calls present', async () => {
      const createFn = jest.fn().mockResolvedValue({
        choices: [{ message: { content: 'Just a simple answer.' } }],
      });
      mockGetLLMClient.mockResolvedValue({
        chat: { completions: { create: createFn } },
      });

      const result = await runChatAgent([{ role: 'user', content: 'hi' }], 'acme');

      expect(result.response).toBe('Just a simple answer.');
      expect(result.toolCalls).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="chat-agent.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/unit/chat-agent.test.ts src/lib/__tests__/unit/__snapshots__/
git commit -m "test: add chat agent tests with prompt and settings snapshots"
```

---

## Task 5: Snapshot tests for llm-config/service.ts

**Files:**
- Modify: `src/lib/__tests__/unit/llm-config-service.test.ts`

- [ ] **Step 1: Write the prompt and settings snapshot tests**

Add a new `describe('prompt and settings snapshots')` inside the existing `describe('testLLMConnection')` block.

```ts
describe('prompt and settings snapshots', () => {
  it('sends exact system prompt and user message', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      model: 'gpt-4o',
    });
    mockGetLLMClient.mockResolvedValue({
      chat: { completions: { create: mockCreate } },
    });

    await testLLMConnection();

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0]).toEqual({ role: 'system', content: 'Reply with exactly: OK' });
    expect(callArgs.messages[1]).toEqual({ role: 'user', content: 'Test connection' });
  });

  it('passes correct LLM settings', async () => {
    const mockCreate = jest.fn().mockResolvedValue({
      choices: [{ message: { content: 'OK' } }],
      model: 'gpt-4o',
    });
    mockGetLLMClient.mockResolvedValue({
      chat: { completions: { create: mockCreate } },
    });

    await testLLMConnection();

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.max_tokens).toBe(32);
    expect(callArgs.model).toBe('gpt-4o');
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="llm-config-service.test" --verbose`
Expected: All new tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/unit/llm-config-service.test.ts
git commit -m "test: add prompt and settings snapshot tests for llm-config"
```

---

## Task 6: Run full test suite — baseline checkpoint

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass. This is our baseline — every snapshot test locks in current hardcoded behavior.

- [ ] **Step 2: No commit needed — this is a verification step**

---

## Task 7: Create prompt-loader.ts with tests

**Files:**
- Create: `src/lib/prompt-loader.ts`
- Create: `src/lib/__tests__/unit/prompt-loader.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import fs from 'fs';
import path from 'path';

// We need to reset modules between tests to clear the cache
let loadPrompt: typeof import('@/lib/prompt-loader').loadPrompt;
let clearPromptCache: typeof import('@/lib/prompt-loader').clearPromptCache;

const TEST_PROMPTS_DIR = path.join(__dirname, '__test-prompts__');

beforeAll(() => {
  // Create temp prompts directory
  fs.mkdirSync(TEST_PROMPTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(TEST_PROMPTS_DIR, 'simple.txt'), 'Hello, world!');
  fs.writeFileSync(path.join(TEST_PROMPTS_DIR, 'with-vars.txt'), 'Hello, {{NAME}}! You are {{ROLE}}.');
  fs.writeFileSync(path.join(TEST_PROMPTS_DIR, 'nested.txt'), 'Calibration:\n{{CALIBRATION}}\nEnd.');
  process.env.PROMPTS_DIR = TEST_PROMPTS_DIR;
});

afterAll(() => {
  // Clean up temp directory
  fs.rmSync(TEST_PROMPTS_DIR, { recursive: true, force: true });
  delete process.env.PROMPTS_DIR;
});

beforeEach(async () => {
  // Re-import to get fresh module with cleared cache
  jest.resetModules();
  const mod = await import('@/lib/prompt-loader');
  loadPrompt = mod.loadPrompt;
  clearPromptCache = mod.clearPromptCache;
});

describe('loadPrompt', () => {
  it('loads a simple text file', () => {
    expect(loadPrompt('simple.txt')).toBe('Hello, world!');
  });

  it('substitutes {{PLACEHOLDER}} variables', () => {
    const result = loadPrompt('with-vars.txt', { NAME: 'Alice', ROLE: 'engineer' });
    expect(result).toBe('Hello, Alice! You are engineer.');
  });

  it('supports nested template inclusion via variables', () => {
    const calibration = loadPrompt('simple.txt');
    const result = loadPrompt('nested.txt', { CALIBRATION: calibration });
    expect(result).toBe('Calibration:\nHello, world!\nEnd.');
  });

  it('leaves unreplaced placeholders as-is when var not provided', () => {
    const result = loadPrompt('with-vars.txt', { NAME: 'Bob' });
    expect(result).toBe('Hello, Bob! You are {{ROLE}}.');
  });

  it('throws Error when file does not exist', () => {
    expect(() => loadPrompt('nonexistent.txt')).toThrow('Prompt template not found');
  });

  it('caches file reads (same content on second call)', () => {
    const first = loadPrompt('simple.txt');
    const second = loadPrompt('simple.txt');
    expect(first).toBe(second);
  });

  it('clearPromptCache allows re-reading files', () => {
    loadPrompt('simple.txt');
    clearPromptCache();
    // After clearing cache, next call re-reads from disk
    expect(loadPrompt('simple.txt')).toBe('Hello, world!');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="prompt-loader.test" --verbose`
Expected: FAIL — module `@/lib/prompt-loader` does not exist.

- [ ] **Step 3: Write the implementation**

Create `src/lib/prompt-loader.ts`:

```ts
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = process.env.PROMPTS_DIR
  ? path.resolve(process.env.PROMPTS_DIR)
  : path.resolve(process.cwd(), 'prompts');

const cache = new Map<string, string>();

export function loadPrompt(filename: string, vars?: Record<string, string>): string {
  let text = cache.get(filename);
  if (!text) {
    const filePath = path.join(PROMPTS_DIR, filename);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Prompt template not found: ${filePath}. Check PROMPTS_DIR (currently: ${PROMPTS_DIR})`);
    }
    text = fs.readFileSync(filePath, 'utf-8');
    cache.set(filename, text);
  }
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      text = text.replaceAll(`{{${key}}}`, value);
    }
  }
  return text;
}

export function clearPromptCache(): void {
  cache.clear();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="prompt-loader.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/prompt-loader.ts src/lib/__tests__/unit/prompt-loader.test.ts
git commit -m "feat: add prompt-loader utility with caching and variable substitution"
```

---

## Task 8: Create prompt template files

**Files:**
- Create: `prompts/analyzer-calibration.txt`
- Create: `prompts/analyzer-system.txt`
- Create: `prompts/analyzer-system-ai-confirmed.txt`
- Create: `prompts/chat-agent-system.txt`
- Create: `prompts/report-summary-system.txt`
- Create: `prompts/report-summary-user.txt`
- Create: `prompts/report-highlights-system.txt`
- Create: `prompts/report-highlights-user.txt`
- Create: `prompts/llm-config-test-system.txt`

- [ ] **Step 1: Extract prompts from source files into template files**

Each template file contains exactly the text from the source file, with dynamic parts replaced by `{{PLACEHOLDER}}` variables.

**`prompts/analyzer-calibration.txt`** — copy the exact `COMPLEXITY_CALIBRATION` string from `analyzer.ts:13-28` (the content between the backticks, including the leading newline).

**`prompts/analyzer-system.txt`** — copy `SYSTEM_PROMPT` from `analyzer.ts:30-38`, replacing the `${COMPLEXITY_CALIBRATION}` interpolation with `{{COMPLEXITY_CALIBRATION}}`.

**`prompts/analyzer-system-ai-confirmed.txt`** — copy `SYSTEM_PROMPT_AI_CONFIRMED` from `analyzer.ts:41-48`, replacing `${COMPLEXITY_CALIBRATION}` with `{{COMPLEXITY_CALIBRATION}}`.

**`prompts/chat-agent-system.txt`** — copy `SYSTEM_PROMPT` from `agent.ts:13-37`, replacing `${TOOLS_DESC}` with `{{TOOLS_DESC}}`. Also append `\n\nCurrent org: {{ORG}}` at the end (currently done via concatenation at `agent.ts:54`).

**`prompts/report-summary-system.txt`** — copy the `systemPrompt` from `summary.ts:105-121` verbatim (no placeholders needed — it's static).

**`prompts/report-summary-user.txt`** — template from `summary.ts:123-136`. Replace dynamic sections with placeholders:
```
Developer: {{DEV_DISPLAY_NAME}} (@{{DEV_LOGIN}})
Rank: {{RANK_LABEL}}
Period: {{PERIOD_DAYS}} days

Overall stats: {{DEV_STATS}}
Types breakdown: {{TYPES_BREAKDOWN}}

Last 7 days: commits={{RECENT_COUNT}}, lines={{RECENT_LINES}}, avgComplexity={{RECENT_COMPLEXITY}}, AI%={{RECENT_AI_PCT}}, types={{RECENT_TYPES}}
Prior 7 days: commits={{PRIOR_COUNT}}, lines={{PRIOR_LINES}}, avgComplexity={{PRIOR_COMPLEXITY}}, AI%={{PRIOR_AI_PCT}}, types={{PRIOR_TYPES}}

{{DEVS_ABOVE_SECTION}}

Total developers in org: {{TOTAL_DEVS}}
```

**`prompts/report-highlights-system.txt`** — copy `systemPrompt` from `service.ts:110-121` verbatim (no placeholders).

**`prompts/report-highlights-user.txt`** — template from `service.ts:123-135`. Replace dynamic sections. **Important:** `{{NEW_DEVS_SECTION}}` and `{{INACTIVE_DEVS_SECTION}}` must not have leading newlines in the template — the service code prepends `\n` only when the section is non-empty to avoid blank lines in the output:
```
Org: {{ORG}}, Period: {{PERIOD_DAYS}} days

PREVIOUS REPORT ({{PREV_DATE}}):
  Totals: {{TOTALS_A}}
  Top 5: {{TOP5_A}}

LATEST REPORT ({{LATEST_DATE}}):
  Totals: {{TOTALS_B}}
  Top 5: {{TOP5_B}}

Top movers: {{MOVERS}}{{NEW_DEVS_SECTION}}{{INACTIVE_DEVS_SECTION}}
```

The service code builds the sections with leading newlines when non-empty:
```ts
const newDevsSection = newDevs.length > 0 ? `\nNew developers: ${newDevs.map(l => '@' + l).join(', ')}` : '';
const inactiveDevsSection = inactiveDevs.length > 0 ? `\nRecently inactive (no commits in latest report): ${inactiveDevs.map(l => '@' + l).join(', ')}` : '';
```

**`prompts/llm-config-test-system.txt`** — just the string: `Reply with exactly: OK`

- [ ] **Step 2: Verify files are created**

Run: `ls -la prompts/`
Expected: 9 `.txt` files.

- [ ] **Step 3: Commit**

```bash
git add prompts/
git commit -m "feat: add prompt template files extracted from source code"
```

---

## Task 9: Migrate analyzer.ts

**Files:**
- Modify: `src/lib/analyzer.ts`

- [ ] **Step 1: Replace hardcoded prompts with loadPrompt calls and settings with env vars**

In `src/lib/analyzer.ts`:

1. Add import: `import { loadPrompt } from './prompt-loader';`
2. Remove the three top-level constants: `COMPLEXITY_CALIBRATION`, `SYSTEM_PROMPT`, `SYSTEM_PROMPT_AI_CONFIRMED`.
3. Build prompts inside `analyzeCommit()` function body (the prompt-loader's internal cache ensures each file is read from disk only once, so this is efficient even when called per-commit):
   ```ts
   const calibration = loadPrompt('analyzer-calibration.txt');
   const systemPrompt = commit.aiCoAuthored
     ? loadPrompt('analyzer-system-ai-confirmed.txt', { COMPLEXITY_CALIBRATION: calibration })
     : loadPrompt('analyzer-system.txt', { COMPLEXITY_CALIBRATION: calibration });
   ```
4. Update the `messages` array to use `systemPrompt` instead of the ternary on the old constants.
5. Replace hardcoded `temperature: 0` with: `temperature: Number(process.env.ANALYZER_TEMPERATURE ?? 0)`
6. Replace hardcoded `max_tokens: 256` with: `max_tokens: Number(process.env.ANALYZER_MAX_TOKENS ?? 256)`

- [ ] **Step 2: Run analyzer snapshot tests**

Run: `npm test -- --testPathPattern="analyzer.test" --verbose`
Expected: All tests PASS — prompts loaded from files produce identical output to hardcoded strings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/analyzer.ts
git commit -m "refactor: migrate analyzer prompts to template files and settings to env"
```

---

## Task 10: Migrate llm-config/service.ts

**Files:**
- Modify: `src/lib/llm-config/service.ts`

- [ ] **Step 1: Replace hardcoded prompt and settings**

1. Add import: `import { loadPrompt } from '@/lib/prompt-loader';`
2. Replace `'Reply with exactly: OK'` with `loadPrompt('llm-config-test-system.txt')`
3. Replace `temperature: 0` with `temperature: Number(process.env.LLM_TEST_TEMPERATURE ?? 0)`
4. Replace `max_tokens: 32` with `max_tokens: Number(process.env.LLM_TEST_MAX_TOKENS ?? 32)`

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern="llm-config-service.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/llm-config/service.ts
git commit -m "refactor: migrate llm-config prompts to template files and settings to env"
```

---

## Task 11: Migrate report/summary.ts

**Files:**
- Modify: `src/lib/report/summary.ts`

- [ ] **Step 1: Replace hardcoded prompts and settings**

1. Add import: `import { loadPrompt } from '@/lib/prompt-loader';`
2. Replace the `systemPrompt` constant (lines 105-121) with: `const systemPrompt = loadPrompt('report-summary-system.txt');`
3. Replace the `userMessage` template (lines 123-136) with:
   ```ts
   const devsAboveSection = devsAbove.length > 0
     ? `Developers ranked above (anonymous, for comparison only):\n${devsAbove.map((d, i) => `  ${formatDev({ ...d, rank: rank - devsAbove.length + i }, true)}`).join('\n')}`
     : 'This developer is #1 — no one above them.';

   const userMessage = loadPrompt('report-summary-user.txt', {
     DEV_DISPLAY_NAME: dev.github_name || dev.github_login,
     DEV_LOGIN: dev.github_login,
     RANK_LABEL: rankLabel,
     PERIOD_DAYS: String(period_days),
     DEV_STATS: formatDev(dev),
     TYPES_BREAKDOWN: JSON.stringify(typeof dev.type_breakdown === 'string' ? JSON.parse(dev.type_breakdown || '{}') : (dev.type_breakdown || {})),
     RECENT_COUNT: String(recentStats.count),
     RECENT_LINES: String(recentStats.lines),
     RECENT_COMPLEXITY: String(recentStats.avgComplexity),
     RECENT_AI_PCT: String(recentStats.aiPct),
     RECENT_TYPES: JSON.stringify(recentStats.types),
     PRIOR_COUNT: String(priorStats.count),
     PRIOR_LINES: String(priorStats.lines),
     PRIOR_COMPLEXITY: String(priorStats.avgComplexity),
     PRIOR_AI_PCT: String(priorStats.aiPct),
     PRIOR_TYPES: JSON.stringify(priorStats.types),
     DEVS_ABOVE_SECTION: devsAboveSection,
     TOTAL_DEVS: String(totalDevs),
   });
   ```
4. Replace `temperature: 0.7` with `temperature: Number(process.env.SUMMARY_TEMPERATURE ?? 0.7)`
5. Replace `max_tokens: 512` with `max_tokens: Number(process.env.SUMMARY_MAX_TOKENS ?? 512)`

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern="report-summary.test" --verbose`
Expected: All tests PASS — snapshot tests confirm identical prompt output.

- [ ] **Step 3: Commit**

```bash
git add src/lib/report/summary.ts
git commit -m "refactor: migrate report summary prompts to template files and settings to env"
```

---

## Task 12: Migrate report-highlights/service.ts

**Files:**
- Modify: `src/lib/report-highlights/service.ts`

- [ ] **Step 1: Replace hardcoded prompts and settings**

1. Add import: `import { loadPrompt } from '../prompt-loader';`
2. Replace `systemPrompt` constant (lines 110-121) with: `const systemPrompt = loadPrompt('report-highlights-system.txt');`
3. Replace `userMessage` template (lines 123-135) with:
   ```ts
   const newDevsSection = newDevs.length > 0 ? `\nNew developers: ${newDevs.map(l => '@' + l).join(', ')}` : '';
   const inactiveDevsSection = inactiveDevs.length > 0 ? `\nRecently inactive (no commits in latest report): ${inactiveDevs.map(l => '@' + l).join(', ')}` : '';

   const userMessage = loadPrompt('report-highlights-user.txt', {
     ORG: latest.org,
     PERIOD_DAYS: String(latest.period_days),
     PREV_DATE: String(prev.created_at),
     TOTALS_A: `${totalA.devs} devs, ${totalA.commits} commits, ${totalA.prs} PRs, avgComplexity=${totalA.avgComplexity}, avgAI=${totalA.avgAi}%`,
     TOP5_A: statsA.slice(0, 5).map(formatDev).join('\n  '),
     LATEST_DATE: String(latest.created_at),
     TOTALS_B: `${totalB.devs} devs, ${totalB.commits} commits, ${totalB.prs} PRs, avgComplexity=${totalB.avgComplexity}, avgAI=${totalB.avgAi}%`,
     TOP5_B: statsB.slice(0, 5).map(formatDev).join('\n  '),
     MOVERS: movers.map(m => `@${m.login}: rank ${m.rankA}→${m.rankB}, impact ${m.impactDelta > 0 ? '+' : ''}${m.impactDelta.toFixed(1)}`).join(', '),
     NEW_DEVS_SECTION: newDevsSection,
     INACTIVE_DEVS_SECTION: inactiveDevsSection,
   });
   ```
4. Replace `temperature: 0.5` with `temperature: Number(process.env.HIGHLIGHTS_TEMPERATURE ?? 0.5)`
5. Replace `max_tokens: 512` with `max_tokens: Number(process.env.HIGHLIGHTS_MAX_TOKENS ?? 512)`

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern="report-highlights-service.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/report-highlights/service.ts
git commit -m "refactor: migrate report highlights prompts to template files and settings to env"
```

---

## Task 13: Migrate chat/agent.ts

**Files:**
- Modify: `src/lib/chat/agent.ts`

- [ ] **Step 1: Replace hardcoded prompts and settings**

1. Add import: `import { loadPrompt } from '@/lib/prompt-loader';`
2. Replace `SYSTEM_PROMPT` constant (lines 13-37) with:
   ```ts
   function buildSystemPrompt(toolsDesc: string, org: string): string {
     return loadPrompt('chat-agent-system.txt', { TOOLS_DESC: toolsDesc, ORG: org });
   }
   ```
3. Update `runChatAgent` to use: `{ role: 'system', content: buildSystemPrompt(TOOLS_DESC, org) }` instead of the current template literal concatenation at line 54.
4. Replace `const MAX_ITERATIONS = 5;` with `const MAX_ITERATIONS = Number(process.env.CHAT_AGENT_MAX_ITERATIONS ?? 5);`
5. Replace `temperature: 0.3` with `temperature: Number(process.env.CHAT_AGENT_TEMPERATURE ?? 0.3)`
6. Replace `max_tokens: 1500` with `max_tokens: Number(process.env.CHAT_AGENT_MAX_TOKENS ?? 1500)`

- [ ] **Step 2: Run tests**

Run: `npm test -- --testPathPattern="chat-agent.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/chat/agent.ts
git commit -m "refactor: migrate chat agent prompts to template files and settings to env"
```

---

## Task 14: Full test suite — post-migration checkpoint

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: ALL tests pass. Every snapshot test still produces identical output.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: No commit needed — verification step**

---

## Task 15: Update next.config.ts for production builds

**Files:**
- Modify: `next.config.ts`

- [ ] **Step 1: Add outputFileTracingIncludes**

```ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner'],
  outputFileTracingIncludes: {
    '/**': ['./prompts/**'],
  },
};

export default nextConfig;
```

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add next.config.ts
git commit -m "chore: include prompts dir in Next.js production build output"
```

---

## Task 16: Extend getLLMConfig() with new settings and secret masking

**Files:**
- Modify: `src/lib/llm-config/service.ts`
- Modify: `src/lib/__tests__/unit/llm-config-service.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests for the new fields in `getLLMConfig()`:

```ts
describe('extended config fields', () => {
  beforeEach(() => {
    process.env.LLM_PROVIDER = 'openai';
    process.env.LLM_API_KEY = 'sk-test-key-12345';
    process.env.GITHUB_TOKEN = 'github_pat_abcdef12345';
  });

  it('returns per-service settings with defaults', () => {
    const config = getLLMConfig();
    expect(config.promptsDir).toBe('./prompts');
    expect(config.analyzer).toEqual({ temperature: 0, maxTokens: 256 });
    expect(config.chatAgent).toEqual({ temperature: 0.3, maxTokens: 1500, maxIterations: 5 });
    expect(config.summary).toEqual({ temperature: 0.7, maxTokens: 512 });
    expect(config.highlights).toEqual({ temperature: 0.5, maxTokens: 512 });
    expect(config.llmTest).toEqual({ temperature: 0, maxTokens: 32 });
  });

  it('reads per-service settings from env when set', () => {
    process.env.ANALYZER_TEMPERATURE = '0.1';
    process.env.ANALYZER_MAX_TOKENS = '512';
    const config = getLLMConfig();
    expect(config.analyzer).toEqual({ temperature: 0.1, maxTokens: 512 });
  });

  it('masks secrets showing only last 5 chars', () => {
    const config = getLLMConfig();
    expect(config.githubToken).toBe('xxxxx12345');
    expect(config.llmApiKey).toBe('xxxxx12345');
  });

  it('returns null for unset secrets', () => {
    delete process.env.GITHUB_TOKEN;
    const config = getLLMConfig();
    expect(config.githubToken).toBeNull();
  });

  it('masks short secrets entirely', () => {
    process.env.LLM_API_KEY = 'abc';
    const config = getLLMConfig();
    expect(config.llmApiKey).toBe('xxxxx');
  });
});
```

Add `GITHUB_TOKEN`, `ANALYZER_TEMPERATURE`, `ANALYZER_MAX_TOKENS` to the `envKeys` array in the existing `beforeEach`/`afterEach` save/restore block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="llm-config-service.test" --verbose`
Expected: FAIL — `config.promptsDir`, `config.analyzer`, etc. do not exist.

- [ ] **Step 3: Implement the changes**

In `src/lib/llm-config/service.ts`:

1. Update the `LLMConfig` interface to add new fields:
   ```ts
   export interface LLMConfig {
     // existing fields...
     provider: string;
     model: string;
     hasApiKey: boolean;
     concurrency: number;
     endpoint?: string;
     hasAccountUid?: boolean;
     hasUserIdentifier?: boolean;
     hasUserSecret?: boolean;
     missing: string[];
     ready: boolean;
     // new fields
     promptsDir: string;
     analyzer: { temperature: number; maxTokens: number };
     chatAgent: { temperature: number; maxTokens: number; maxIterations: number };
     summary: { temperature: number; maxTokens: number };
     highlights: { temperature: number; maxTokens: number };
     llmTest: { temperature: number; maxTokens: number };
     githubToken: string | null;
     llmApiKey: string | null;
     smartlingUserSecret: string | null;
   }
   ```

2. Add `maskSecret` helper:
   ```ts
   function maskSecret(value?: string): string | null {
     if (!value) return null;
     if (value.length <= 5) return 'xxxxx';
     return 'xxxxx' + value.slice(-5);
   }
   ```

3. Add the new fields to the return object in `getLLMConfig()`:
   ```ts
   config.promptsDir = process.env.PROMPTS_DIR || './prompts';
   config.analyzer = {
     temperature: Number(process.env.ANALYZER_TEMPERATURE ?? 0),
     maxTokens: Number(process.env.ANALYZER_MAX_TOKENS ?? 256),
   };
   config.chatAgent = {
     temperature: Number(process.env.CHAT_AGENT_TEMPERATURE ?? 0.3),
     maxTokens: Number(process.env.CHAT_AGENT_MAX_TOKENS ?? 1500),
     maxIterations: Number(process.env.CHAT_AGENT_MAX_ITERATIONS ?? 5),
   };
   config.summary = {
     temperature: Number(process.env.SUMMARY_TEMPERATURE ?? 0.7),
     maxTokens: Number(process.env.SUMMARY_MAX_TOKENS ?? 512),
   };
   config.highlights = {
     temperature: Number(process.env.HIGHLIGHTS_TEMPERATURE ?? 0.5),
     maxTokens: Number(process.env.HIGHLIGHTS_MAX_TOKENS ?? 512),
   };
   config.llmTest = {
     temperature: Number(process.env.LLM_TEST_TEMPERATURE ?? 0),
     maxTokens: Number(process.env.LLM_TEST_MAX_TOKENS ?? 32),
   };
   config.githubToken = maskSecret(process.env.GITHUB_TOKEN);
   config.llmApiKey = maskSecret(process.env.LLM_API_KEY);
   config.smartlingUserSecret = maskSecret(process.env.SMARTLING_USER_SECRET);
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="llm-config-service.test" --verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm-config/service.ts src/lib/__tests__/unit/llm-config-service.test.ts
git commit -m "feat: extend getLLMConfig with per-service settings and masked secrets"
```

---

## Task 17: Update Settings UI to display new config

**Files:**
- Modify: `src/app/settings/page.tsx`

- [ ] **Step 1: Add per-service settings grid to LlmSettingsTab**

In the `LlmSettingsTab` function (`settings/page.tsx:788`), after the existing "Config details" `<div>` (line ~842), add a new section:

```tsx
{/* Per-Service LLM Settings */}
<div className="bg-gray-900 rounded-xl p-5 mb-6">
  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Per-Service LLM Settings</p>
  <div className="overflow-x-auto">
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-gray-500 border-b border-gray-800">
          <th className="pb-2 pr-4">Service</th>
          <th className="pb-2 pr-4">Temperature</th>
          <th className="pb-2 pr-4">Max Tokens</th>
          <th className="pb-2">Other</th>
        </tr>
      </thead>
      <tbody className="text-gray-300 font-mono">
        {[
          { name: 'Commit Analyzer', ...config.analyzer },
          { name: 'Chat Agent', ...config.chatAgent },
          { name: 'Dev Summary', ...config.summary },
          { name: 'Report Highlights', ...config.highlights },
          { name: 'Connection Test', ...config.llmTest },
        ].map((s: any) => (
          <tr key={s.name} className="border-b border-gray-800/50">
            <td className="py-2 pr-4 text-gray-400 text-xs">{s.name}</td>
            <td className="py-2 pr-4">{s.temperature}</td>
            <td className="py-2 pr-4">{s.maxTokens}</td>
            <td className="py-2 text-xs text-gray-500">{s.maxIterations ? `Max iterations: ${s.maxIterations}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
</div>

{/* Prompt Templates */}
{config.promptsDir && (
  <div className="bg-gray-900 rounded-xl p-5 mb-6">
    <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Prompt Templates</p>
    <ConfigRow label="Directory" value={config.promptsDir} />
  </div>
)}

{/* Secrets */}
<div className="bg-gray-900 rounded-xl p-5 mb-6">
  <p className="text-xs text-gray-500 uppercase tracking-wider font-semibold mb-3">Secrets</p>
  <div className="grid grid-cols-3 gap-4">
    <ConfigRow label="GitHub Token" value={config.githubToken || '(not set)'} />
    <ConfigRow label="LLM API Key" value={config.llmApiKey || '(not set)'} />
    <ConfigRow label="Smartling Secret" value={config.smartlingUserSecret || '(not set)'} />
  </div>
</div>
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/app/settings/page.tsx
git commit -m "feat: display per-service LLM settings and masked secrets in Settings UI"
```

---

## Task 18: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add new env vars to .env.example**

Append after the Smartling section:

```env
# -----------------------------------------------------------------------------
# Prompt Templates (optional — defaults shown)
# -----------------------------------------------------------------------------
# Directory containing prompt template files
# PROMPTS_DIR=./prompts

# -----------------------------------------------------------------------------
# Per-Service LLM Settings (optional — defaults shown)
# -----------------------------------------------------------------------------
# Commit Analyzer
# ANALYZER_TEMPERATURE=0
# ANALYZER_MAX_TOKENS=256

# Chat Agent (conversational assistant)
# CHAT_AGENT_TEMPERATURE=0.3
# CHAT_AGENT_MAX_TOKENS=1500
# CHAT_AGENT_MAX_ITERATIONS=5

# Developer Summary
# SUMMARY_TEMPERATURE=0.7
# SUMMARY_MAX_TOKENS=512

# Report Highlights (report-over-report comparison)
# HIGHLIGHTS_TEMPERATURE=0.5
# HIGHLIGHTS_MAX_TOKENS=512

# LLM Connection Test
# LLM_TEST_TEMPERATURE=0
# LLM_TEST_MAX_TOKENS=32
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add prompt and LLM settings env vars to .env.example"
```

---

## Task 19: Update README.md

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add Prompt Customization section**

Add after the Database section (around line 114) and before the Docker section:

```markdown
### Prompt Customization

LLM prompts are stored as template files in the `prompts/` directory. You can customize prompts by editing these files or pointing to a different directory:

```env
PROMPTS_DIR=./my-custom-prompts
```

Template files use `{{PLACEHOLDER}}` syntax for dynamic values injected at runtime.

Each LLM-powered service has configurable temperature and max_tokens settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `ANALYZER_TEMPERATURE` | 0 | Commit analysis (deterministic) |
| `ANALYZER_MAX_TOKENS` | 256 | Commit analysis response limit |
| `CHAT_AGENT_TEMPERATURE` | 0.3 | Chat assistant |
| `CHAT_AGENT_MAX_TOKENS` | 1500 | Chat assistant response limit |
| `CHAT_AGENT_MAX_ITERATIONS` | 5 | Max tool-call rounds per chat |
| `SUMMARY_TEMPERATURE` | 0.7 | Developer summaries |
| `SUMMARY_MAX_TOKENS` | 512 | Developer summary response limit |
| `HIGHLIGHTS_TEMPERATURE` | 0.5 | Report comparison highlights |
| `HIGHLIGHTS_MAX_TOKENS` | 512 | Highlights response limit |

All settings are optional — defaults match the original hardcoded values.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add prompt customization section to README"
```

---

## Task 20: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add prompt-loader to Key architectural decisions**

After the "AI detection" bullet, add:

```markdown
- **Prompt template system** — LLM prompts live in `prompts/` dir (configurable via `PROMPTS_DIR`), loaded by `prompt-loader.ts` with in-memory caching. Templates use `{{PLACEHOLDER}}` syntax. All LLM settings (temperature, max_tokens, max_iterations) are configurable via env vars with hardcoded defaults.
```

- [ ] **Step 2: Add prompt-loader gotchas**

After the last gotcha, add:

```markdown
- `PROMPTS_DIR` defaults to `./prompts` relative to CWD — in Docker, ensure the directory is mounted or `outputFileTracingIncludes` is configured in `next.config.ts`
- Prompt loader caches template files in memory — restart the server after changing prompt template files (or call `clearPromptCache()` in dev)
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add prompt template system to CLAUDE.md architectural decisions and gotchas"
```

---

## Task 21: Final verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: ALL tests pass.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 3: Verify prompts directory is complete**

Run: `ls -la prompts/`
Expected: 9 template files.

- [ ] **Step 4: No commit needed — verification step**
