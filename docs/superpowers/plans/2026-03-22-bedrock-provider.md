# AWS Bedrock Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add native AWS Bedrock as an LLM provider so users can use `LLM_PROVIDER=bedrock` with SSO authentication.

**Architecture:** A new `bedrock-adapter.ts` file creates a duck-typed OpenAI client that translates requests to Bedrock's InvokeModel API (Anthropic Messages format) and translates responses back. The existing `llm-provider.ts` gets a new `'bedrock'` case that delegates to this adapter.

**Tech Stack:** `@aws-sdk/client-bedrock-runtime`, TypeScript, Jest

**Spec:** `docs/superpowers/specs/2026-03-22-bedrock-provider-design.md`

---

### Task 1: Install AWS SDK dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the package**

Run: `npm install @aws-sdk/client-bedrock-runtime`

- [ ] **Step 2: Verify installation**

Run: `node -e "require('@aws-sdk/client-bedrock-runtime')"`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @aws-sdk/client-bedrock-runtime dependency"
```

---

### Task 2: Create bedrock adapter with tests (TDD)

**Files:**
- Create: `src/lib/__tests__/unit/bedrock-adapter.test.ts`
- Create: `src/lib/bedrock-adapter.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/unit/bedrock-adapter.test.ts`:

```typescript
jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const mockSend = jest.fn();
  return {
    BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
    InvokeModelCommand: jest.fn().mockImplementation((input: any) => ({ input })),
    __mockSend: mockSend,
  };
});

import { createBedrockClient } from '@/lib/bedrock-adapter';

const { __mockSend: mockSend } = jest.requireMock('@aws-sdk/client-bedrock-runtime');

function bedrockResponse(text: string) {
  return {
    body: new TextEncoder().encode(JSON.stringify({
      content: [{ type: 'text', text }],
      role: 'assistant',
      stop_reason: 'end_turn',
    })),
  };
}

describe('bedrock-adapter', () => {
  beforeEach(() => {
    mockSend.mockReset();
    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    InvokeModelCommand.mockClear();
  });

  it('translates OpenAI-style request to Bedrock InvokeModel', async () => {
    mockSend.mockResolvedValue(bedrockResponse('hello'));

    const client = createBedrockClient();
    await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Hi' },
      ],
      temperature: 0.5,
      max_tokens: 100,
    });

    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const cmdInput = InvokeModelCommand.mock.calls[0][0];
    const body = JSON.parse(cmdInput.body);

    expect(cmdInput.modelId).toBe('anthropic.claude-sonnet-4-20250514-v1:0');
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.system).toBe('You are helpful.');
    expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    expect(body.temperature).toBe(0.5);
    expect(body.max_tokens).toBe(100);
  });

  it('returns OpenAI-shaped response', async () => {
    mockSend.mockResolvedValue(bedrockResponse('world'));

    const client = createBedrockClient();
    const result = await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    });

    expect(result.choices[0].message.role).toBe('assistant');
    expect(result.choices[0].message.content).toBe('world');
  });

  it('separates system messages from conversation messages', async () => {
    mockSend.mockResolvedValue(bedrockResponse('ok'));

    const client = createBedrockClient();
    await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [
        { role: 'system', content: 'System A' },
        { role: 'system', content: 'System B' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Bye' },
      ],
      max_tokens: 100,
    });

    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const body = JSON.parse(InvokeModelCommand.mock.calls[0][0].body);

    expect(body.system).toBe('System A\n\nSystem B');
    expect(body.messages).toEqual([
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi' },
      { role: 'user', content: 'Bye' },
    ]);
  });

  it('appends JSON hint when response_format is json_object', async () => {
    mockSend.mockResolvedValue(bedrockResponse('{"ok":true}'));

    const client = createBedrockClient();
    await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [
        { role: 'system', content: 'Be helpful.' },
        { role: 'user', content: 'Give JSON' },
      ],
      max_tokens: 100,
      response_format: { type: 'json_object' },
    });

    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const body = JSON.parse(InvokeModelCommand.mock.calls[0][0].body);

    expect(body.system).toContain('Be helpful.');
    expect(body.system).toContain('You must respond with valid JSON only.');
  });

  it('defaults max_tokens to 4096 when not provided', async () => {
    mockSend.mockResolvedValue(bedrockResponse('hi'));

    const client = createBedrockClient();
    await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const body = JSON.parse(InvokeModelCommand.mock.calls[0][0].body);

    expect(body.max_tokens).toBe(4096);
  });

  it('omits system field when no system messages are present', async () => {
    mockSend.mockResolvedValue(bedrockResponse('hi'));

    const client = createBedrockClient();
    await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
    });

    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const body = JSON.parse(InvokeModelCommand.mock.calls[0][0].body);

    expect(body.system).toBeUndefined();
  });

  it('propagates AWS SDK errors unchanged', async () => {
    const awsError = new Error('ThrottlingException');
    mockSend.mockRejectedValue(awsError);

    const client = createBedrockClient();
    await expect(
      client.chat.completions.create({
        model: 'anthropic.claude-sonnet-4-20250514-v1:0',
        messages: [{ role: 'user', content: 'Hi' }],
      })
    ).rejects.toBe(awsError);
  });

  it('ignores extra properties (e.g. from extraBodyProps)', async () => {
    mockSend.mockResolvedValue(bedrockResponse('hi'));

    const client = createBedrockClient();
    await client.chat.completions.create({
      model: 'anthropic.claude-sonnet-4-20250514-v1:0',
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 100,
      smartling_additional_properties: { operation_name: 'test' },
    } as any);

    const { InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
    const body = JSON.parse(InvokeModelCommand.mock.calls[0][0].body);

    expect(body.smartling_additional_properties).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="bedrock-adapter"`
Expected: FAIL — `Cannot find module '@/lib/bedrock-adapter'`

- [ ] **Step 3: Write the adapter implementation**

Create `src/lib/bedrock-adapter.ts`:

```typescript
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * Creates a duck-typed OpenAI client backed by AWS Bedrock InvokeModel.
 * Uses Anthropic Messages API format on Bedrock.
 *
 * Auth: uses the default AWS credential provider chain (respects AWS_PROFILE, AWS_REGION).
 * anthropic_version: "bedrock-2023-05-31" — per Bedrock Anthropic docs.
 */
export function createBedrockClient() {
  const bedrockClient = new BedrockRuntimeClient({
    region: process.env.AWS_REGION || 'us-east-1',
  });

  return {
    chat: {
      completions: {
        async create(params: any) {
          const { messages, model, temperature, max_tokens, response_format } = params;

          // Separate system messages from conversation messages
          const systemMessages: string[] = [];
          const conversationMessages: { role: string; content: string }[] = [];

          for (const msg of messages) {
            if (msg.role === 'system') {
              systemMessages.push(msg.content);
            } else {
              conversationMessages.push({ role: msg.role, content: msg.content });
            }
          }

          let system = systemMessages.join('\n\n') || undefined;

          // Append JSON hint if response_format is json_object
          if (response_format?.type === 'json_object') {
            const hint = '\n\nYou must respond with valid JSON only. No markdown fences, no explanatory text \u2014 just the JSON object.';
            system = system ? system + hint : hint.trim();
          }

          const body: Record<string, unknown> = {
            anthropic_version: 'bedrock-2023-05-31',
            messages: conversationMessages,
            max_tokens: max_tokens ?? 4096,
          };
          if (system) body.system = system;
          if (temperature !== undefined) body.temperature = temperature;

          const command = new InvokeModelCommand({
            modelId: model,
            body: JSON.stringify(body),
            contentType: 'application/json',
            accept: 'application/json',
          });

          const response = await bedrockClient.send(command);
          const decoded = JSON.parse(new TextDecoder().decode(response.body));

          return {
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: decoded.content?.[0]?.text ?? '',
                },
              },
            ],
          };
        },
      },
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="bedrock-adapter"`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/bedrock-adapter.ts src/lib/__tests__/unit/bedrock-adapter.test.ts
git commit -m "feat: add Bedrock adapter translating OpenAI requests to InvokeModel"
```

---

### Task 3: Integrate bedrock provider into llm-provider.ts with tests (TDD)

**Files:**
- Modify: `src/lib/llm-provider.ts`
- Modify: `src/lib/__tests__/unit/llm-provider.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/lib/__tests__/unit/llm-provider.test.ts`:

In the `LLM_MODEL` describe block, add:

```typescript
    it('defaults to bedrock claude model for bedrock provider', () => {
      process.env.LLM_PROVIDER = 'bedrock';
      delete process.env.LLM_MODEL;
      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      expect(mod.LLM_MODEL).toBe('anthropic.claude-sonnet-4-20250514-v1:0');
    });
```

In the `getLLMClient` describe block, add:

```typescript
    it('creates Bedrock client via adapter', async () => {
      process.env.LLM_PROVIDER = 'bedrock';

      jest.doMock('@/lib/bedrock-adapter', () => ({
        createBedrockClient: jest.fn().mockReturnValue({ chat: { completions: { create: jest.fn() } } }),
      }));

      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const client = await mod.getLLMClient();
      expect(client).toBeDefined();
      expect(client.chat.completions.create).toBeDefined();
    });

    it('caches Bedrock client on second call', async () => {
      process.env.LLM_PROVIDER = 'bedrock';

      jest.doMock('@/lib/bedrock-adapter', () => ({
        createBedrockClient: jest.fn().mockReturnValue({ chat: { completions: { create: jest.fn() } } }),
      }));

      let mod: any;
      jest.isolateModules(() => {
        mod = require('@/lib/llm-provider');
      });
      const first = await mod.getLLMClient();
      const second = await mod.getLLMClient();
      expect(first).toBe(second);
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="llm-provider"`
Expected: FAIL — bedrock tests fail (no bedrock case in provider)

- [ ] **Step 3: Update llm-provider.ts**

In `src/lib/llm-provider.ts`, make these changes:

1. Update the `Provider` type (line 15):

```typescript
type Provider = 'openai' | 'anthropic' | 'smartling' | 'openai-compatible' | 'bedrock';
```

2. Update the `LLM_MODEL` default (lines 22-24):

```typescript
const MODEL_DEFAULTS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  bedrock:   'anthropic.claude-sonnet-4-20250514-v1:0',
};

export const LLM_MODEL =
  process.env.LLM_MODEL || MODEL_DEFAULTS[provider] || 'gpt-4o';
```

3. Update the JSDoc (lines 3-13) to include `bedrock`:

```
 *   bedrock            — AWS Bedrock (Anthropic models via InvokeModel)
```

4. Add `case 'bedrock'` before the `default` case (after the smartling case):

```typescript
    case 'bedrock': {
      const { createBedrockClient } = await import('./bedrock-adapter');
      cachedClient = createBedrockClient() as unknown as OpenAI;
      return cachedClient;
    }
```

5. Update the error message in `default` to include `bedrock`:

```typescript
      throw new Error(`Unknown LLM_PROVIDER: ${provider}. Use: openai, anthropic, smartling, openai-compatible, or bedrock`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="llm-provider"`
Expected: All tests PASS (existing + 3 new)

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/llm-provider.ts src/lib/__tests__/unit/llm-provider.test.ts
git commit -m "feat: add bedrock provider to LLM provider factory"
```

---

### Task 4: Update .env.example documentation

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update LLM_PROVIDER comment**

Change line 18 from:
```
# Choose your LLM provider: openai, anthropic, openai-compatible, or smartling
```
to:
```
# Choose your LLM provider: openai, anthropic, openai-compatible, smartling, or bedrock
```

- [ ] **Step 2: Update LLM_MODEL comment**

Change line 24 from:
```
# Model to use (defaults: gpt-4o for openai, claude-sonnet-4-20250514 for anthropic)
```
to:
```
# Model to use (defaults: gpt-4o for openai, claude-sonnet-4-20250514 for anthropic, anthropic.claude-sonnet-4-20250514-v1:0 for bedrock)
```

- [ ] **Step 3: Add Bedrock section**

After the Smartling section (after line 54), add:

```
# -----------------------------------------------------------------------------
# AWS Bedrock (only if LLM_PROVIDER=bedrock)
# -----------------------------------------------------------------------------
# Uses the default AWS credential provider chain.
# For SSO: run `aws sso login --profile your-profile` first.
# AWS_PROFILE=your-profile
# AWS_REGION=us-east-1
```

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs: add Bedrock provider configuration to .env.example"
```
