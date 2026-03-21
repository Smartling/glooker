# Prompt & Settings Extraction Design

**Date:** 2026-03-21
**Branch:** `settings-extraction`
**Status:** Draft

## Goal

Extract all hardcoded LLM prompts and settings (temperature, max_tokens, max_iterations) from source code into external configuration — prompt template files in `prompts/` and numeric settings in `.env`. Migration must be verified by tests that lock in current behavior before any extraction begins.

## Affected Files

Five services contain hardcoded LLM prompts and settings:

| Service | Prompts | Settings |
|---------|---------|----------|
| `src/lib/analyzer.ts` | SYSTEM_PROMPT, SYSTEM_PROMPT_AI_CONFIRMED, COMPLEXITY_CALIBRATION | temperature=0, max_tokens=256 |
| `src/lib/chat/agent.ts` | SYSTEM_PROMPT, conversation tool-result message | temperature=0.3, max_tokens=1500, MAX_ITERATIONS=5 |
| `src/lib/report/summary.ts` | systemPrompt, userMessage template | temperature=0.7, max_tokens=512 |
| `src/lib/report-highlights/service.ts` | systemPrompt, userMessage template | temperature=0.5, max_tokens=512 |
| `src/lib/llm-config/service.ts` | system message ("Reply with exactly: OK") | temperature=0, max_tokens=32 |

## Phase 1: Snapshot Tests (Before Migration)

### Purpose

Lock in current behavior so that after extraction, the same tests prove placeholder substitution and settings loading produce identical results.

### Prompt Snapshot Tests

For each service, add a test that captures the `messages` array passed to `client.chat.completions.create()` and asserts the system prompt matches the current hardcoded text **character-for-character** (exact match).

Pattern:

```ts
it('sends correct system prompt to LLM', async () => {
  const createFn = jest.fn().mockResolvedValue({ choices: [{ message: { content: '...' } }] });
  mockGetLLMClient.mockResolvedValue({ chat: { completions: { create: createFn } } });
  // ... setup DB mocks, call the service function ...
  const callArgs = createFn.mock.calls[0][0];
  const systemMsg = callArgs.messages[0].content;
  expect(systemMsg).toBe(EXPECTED_FULL_SYSTEM_PROMPT_TEXT);
});
```

For services with user message templates (summary, highlights, chat agent), also assert the user message structure with expected placeholder values given the test fixtures.

### Settings Snapshot Tests

For each service, assert the exact settings passed to the LLM client:

```ts
it('passes correct LLM settings', async () => {
  // ... setup and call ...
  const callArgs = createFn.mock.calls[0][0];
  expect(callArgs.temperature).toBe(0);       // exact current value
  expect(callArgs.max_tokens).toBe(256);       // exact current value
  expect(callArgs.model).toBe('test-model');
  expect(callArgs.response_format).toEqual({ type: 'json_object' });
});
```

For `chat/agent.ts`, also test `MAX_ITERATIONS` — verify the agent stops after 5 iterations by mocking the LLM to always return TOOL_CALL lines and asserting the loop terminates.

### Test Files

| Service | Test File | Status |
|---------|-----------|--------|
| `src/lib/analyzer.ts` | `src/lib/__tests__/integration/analyzer.test.ts` | Exists — add prompt + settings assertions |
| `src/lib/report/summary.ts` | `src/lib/__tests__/unit/report-summary.test.ts` | Exists — add prompt + settings assertions |
| `src/lib/report-highlights/service.ts` | `src/lib/__tests__/unit/report-highlights-service.test.ts` | Exists — add prompt + settings assertions |
| `src/lib/chat/agent.ts` | `src/lib/__tests__/unit/chat-agent.test.ts` | **New** — create from scratch |
| `src/lib/llm-config/service.ts` | `src/lib/__tests__/unit/llm-config-service.test.ts` | Exists — add prompt + settings assertions |

### Validation

Run `npm test` after adding all snapshot tests. All must pass against current hardcoded code before proceeding to Phase 2.

## Phase 2: Prompt Template Files

### Directory

```
prompts/                                  # default location (PROMPTS_DIR env var)
├── analyzer-system.txt                   # main commit analysis prompt, includes {{COMPLEXITY_CALIBRATION}}
├── analyzer-system-ai-confirmed.txt      # shorter variant (no maybe_ai field), includes {{COMPLEXITY_CALIBRATION}}
├── analyzer-calibration.txt              # complexity calibration block (shared by both system prompts)
├── chat-agent-system.txt                 # chat assistant system prompt with {{TOOLS_DESC}}, ends with "Current org: {{ORG}}"
├── report-summary-system.txt             # developer summary coach prompt
├── report-summary-user.txt               # user message template with data placeholders
├── report-highlights-system.txt          # report comparison prompt
├── report-highlights-user.txt            # user message template with data placeholders
└── llm-config-test-system.txt            # connection test prompt
```

### Template Syntax

Simple `{{PLACEHOLDER}}` replacement. No logic, no conditionals — just string substitution.

Example (`chat-agent-system.txt`):
```
You are Glooker Assistant — a data analyst for GitHub org developer analytics.
...
Available tools:

{{TOOLS_DESC}}

Current org: {{ORG}}
```

Note: In the current code, `org` is appended via string concatenation at call time (`agent.ts` line 54). The template consolidates this into a single `{{ORG}}` placeholder at the end.

Example (`analyzer-system.txt`):
```
You are a senior software engineer performing commit impact analysis.
...
{{COMPLEXITY_CALIBRATION}}
Return ONLY the raw JSON object, no markdown fences.
```

The calibration text is loaded separately via `loadPrompt('analyzer-calibration.txt')` and passed as a template variable: `loadPrompt('analyzer-system.txt', { COMPLEXITY_CALIBRATION: calibrationText })`. The loader stays simple — no recursive includes.

### User Message Templates

The user messages in `summary.ts` and `report-highlights/service.ts` contain conditional blocks and complex formatting logic (inline function calls, JSON stringification, conditional sections). The template files will contain placeholders for pre-computed sections. The service code pre-renders each conditional branch into a string, then passes it as a placeholder value. For example:

- `{{DEVS_ABOVE_SECTION}}` — pre-rendered in code as either the formatted list or "This developer is #1..."
- `{{NEW_DEVS_SECTION}}` — pre-rendered as either the new devs line or empty string
- `{{INACTIVE_DEVS_SECTION}}` — same pattern

The real formatting logic stays in the service code; the templates define the overall message structure.

### Prompt Loader

New file: `src/lib/prompt-loader.ts`

```ts
import fs from 'fs';
import path from 'path';

const PROMPTS_DIR = process.env.PROMPTS_DIR
  ? path.resolve(process.env.PROMPTS_DIR)
  : path.resolve(process.cwd(), 'prompts');

// In-memory cache: each file is read once per process lifetime.
// This is important for analyzer.ts which is called per-commit (potentially hundreds of times).
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

/** Clear the cache (for testing). */
export function clearPromptCache(): void {
  cache.clear();
}
```

### Next.js Production Build

The `prompts/` directory is NOT automatically included in `next build` standalone output. To ensure it is available in production:

Add to `next.config.ts`:
```ts
outputFileTracingIncludes: {
  '/**': ['./prompts/**'],
},
```

This ensures the `prompts/` directory is copied alongside the build output.

## Phase 3: .env Settings

### New Environment Variables

```env
# Prompt template directory (default: ./prompts relative to CWD)
PROMPTS_DIR=./prompts

# Analyzer — commit complexity analysis
ANALYZER_TEMPERATURE=0
ANALYZER_MAX_TOKENS=256

# Chat Agent — conversational assistant
CHAT_AGENT_TEMPERATURE=0.3
CHAT_AGENT_MAX_TOKENS=1500
CHAT_AGENT_MAX_ITERATIONS=5

# Developer Summary — performance coach summaries
SUMMARY_TEMPERATURE=0.7
SUMMARY_MAX_TOKENS=512

# Report Highlights — report-over-report comparison
HIGHLIGHTS_TEMPERATURE=0.5
HIGHLIGHTS_MAX_TOKENS=512

# LLM Connection Test
LLM_TEST_TEMPERATURE=0
LLM_TEST_MAX_TOKENS=32
```

### Reading Settings

Each service reads its settings from `process.env` with the current hardcoded values as defaults:

```ts
const temperature = Number(process.env.ANALYZER_TEMPERATURE ?? 0);
const maxTokens = Number(process.env.ANALYZER_MAX_TOKENS ?? 256);
```

This ensures zero behavior change when env vars are not set.

### What stays in code (not extracted)

- `response_format: { type: 'json_object' }` — structural, not tunable
- `extraBodyProps()` spread — provider-specific properties (Smartling operation_name)
- Provider selection (`LLM_PROVIDER`, already in .env)

## Phase 4: Service Migration

Migrate one service at a time. After each migration, run `npm test` to verify all snapshot tests still pass.

### Migration Order

1. `src/lib/prompt-loader.ts` — create the loader first
2. `src/lib/analyzer.ts` — simplest prompts, most test coverage
3. `src/lib/llm-config/service.ts` — trivial, quick win
4. `src/lib/report/summary.ts` — template with data placeholders
5. `src/lib/report-highlights/service.ts` — template with data placeholders
6. `src/lib/chat/agent.ts` — most complex (dynamic TOOLS_DESC, conversation messages)

### What Gets Extracted vs Stays in Code

| Extracted to `prompts/` | Stays in code |
|---|---|
| System prompt text | Placeholder injection logic (building TOOLS_DESC, formatting dev stats) |
| Complexity calibration rules | Response parsing and validation (clamp, validateType, etc.) |
| User message templates (structure) | Conditional section pre-rendering |
| | DB queries, caching, error handling |
| | `extraBodyProps()` spread |

| Extracted to `.env` | Stays in code |
|---|---|
| temperature, max_tokens, max_iterations | `response_format: { type: 'json_object' }` (structural) |
| PROMPTS_DIR | Provider selection (`LLM_PROVIDER`, already in .env) |

## Phase 5: Settings UI Update

### Current State

The Settings page (`src/app/settings/page.tsx`) has an "LLM Settings" tab that shows:
- Provider name, Model, Concurrency
- Missing env vars (if config incomplete)
- Connection test button

### New: Full Configuration Display

Extend the `GET /api/llm-config` endpoint and `getLLMConfig()` service to return all new settings. The LLM Settings tab will display every externalized config value in a structured grid.

#### API Response Extension

`getLLMConfig()` returns additional fields:

```ts
{
  // existing fields...
  provider, model, hasApiKey, concurrency, endpoint, missing, ready,

  // new: per-service settings
  promptsDir: process.env.PROMPTS_DIR || './prompts',
  analyzer: { temperature: 0, maxTokens: 256 },
  chatAgent: { temperature: 0.3, maxTokens: 1500, maxIterations: 5 },
  summary: { temperature: 0.7, maxTokens: 512 },
  highlights: { temperature: 0.5, maxTokens: 512 },
  llmTest: { temperature: 0, maxTokens: 32 },

  // new: secret masking for display
  githubToken: maskSecret(process.env.GITHUB_TOKEN),
  llmApiKey: maskSecret(process.env.LLM_API_KEY),
  smartlingUserSecret: maskSecret(process.env.SMARTLING_USER_SECRET),
}
```

#### Secret Masking

Secrets are masked for display — show only the last 5 characters, replace the rest with `xxxxx`:

```ts
function maskSecret(value?: string): string | null {
  if (!value) return null;
  if (value.length <= 5) return 'xxxxx';
  return 'xxxxx' + value.slice(-5);
}
```

Examples:
- `sk-abc123xyz789` → `xxxxx89789`
- `github_pat_abc` → `xxxxxx_abc`
- (not set) → `null`

#### UI Layout

The LLM Settings tab adds a new section below the existing config details:

**"Per-Service LLM Settings"** — a grid showing each service's temperature, max_tokens, and max_iterations (where applicable):

| Service | Temperature | Max Tokens | Other |
|---------|-------------|-----------|-------|
| Commit Analyzer | 0 | 256 | |
| Chat Agent | 0.3 | 1500 | Max iterations: 5 |
| Dev Summary | 0.7 | 512 | |
| Report Highlights | 0.5 | 512 | |
| Connection Test | 0 | 32 | |

**"Prompt Templates"** — shows `PROMPTS_DIR` path and lists the template files found in that directory.

**"Secrets"** — masked display of configured secrets (GitHub token, LLM API key, Smartling secret) so users can verify they are set without exposing values.

All values are read-only with the existing note: "Edit `.env.local` to change settings."

## Phase 6: Documentation Updates

### `.env.example`

Add all new env vars with their default values and comments explaining each section.

### `README.md`

Add a "Prompt Customization" section under Configuration explaining:
- `PROMPTS_DIR` and how to override prompt templates
- Per-service temperature/max_tokens settings
- List of template files and their purpose

### `CLAUDE.md`

Add to "Key architectural decisions":
- Prompt template system: prompts live in `prompts/` dir, loaded via `prompt-loader.ts` with in-memory cache, `{{PLACEHOLDER}}` syntax
- All LLM settings (temperature, max_tokens) configurable via env vars with hardcoded defaults

Add to "Gotchas":
- `PROMPTS_DIR` defaults to `./prompts` relative to CWD — in Docker, ensure the directory is mounted or `outputFileTracingIncludes` is configured in `next.config.ts`
- Prompt loader caches files in memory — restart the server after changing prompt template files (or call `clearPromptCache()` in dev)

## Validation Criteria

1. All Phase 1 snapshot tests pass against current hardcoded code (baseline)
2. After full migration, the exact same tests pass without modification
3. No `.env.local` changes required for existing deployments (defaults match current hardcoded values)
4. `npm run build` succeeds
5. Settings UI displays all new config values correctly with secrets masked
6. Manual smoke test: run a report, verify LLM calls work as before
