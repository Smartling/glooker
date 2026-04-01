import { makeCommit } from '../fixtures';

// Mock llm-provider before importing analyzer
jest.mock('@/lib/llm-provider', () => ({
  LLM_MODEL: 'test-model',
  extraBodyProps: () => ({}),
  getLLMClient: jest.fn(),
  tokenLimit: (n: number) => ({ max_completion_tokens: n }),
  promptTag: (name: string) => name ? { __prompt_id: name } : {},
}));

import { analyzeCommit } from '@/lib/analyzer';
import { getLLMClient } from '@/lib/llm-provider';

function mockLLMResponse(content: string) {
  (getLLMClient as jest.Mock).mockResolvedValue({
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content } }],
        }),
      },
    },
  });
}

describe('analyzeCommit', () => {
  it('maps LLM JSON fields correctly', async () => {
    mockLLMResponse(JSON.stringify({
      complexity: 7,
      type: 'feature',
      impact_summary: 'Adds new auth endpoint',
      risk_level: 'medium',
      maybe_ai: false,
    }));
    const result = await analyzeCommit(makeCommit({ sha: 'x1' }));
    expect(result.sha).toBe('x1');
    expect(result.complexity).toBe(7);
    expect(result.type).toBe('feature');
    expect(result.impactSummary).toBe('Adds new auth endpoint');
    expect(result.riskLevel).toBe('medium');
    expect(result.maybeAi).toBe(false);
  });

  it('clamps complexity above 10 to 10', async () => {
    mockLLMResponse(JSON.stringify({ complexity: 15, type: 'feature', impact_summary: '', risk_level: 'low' }));
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(10);
  });

  it('clamps complexity below 1 to 1', async () => {
    mockLLMResponse(JSON.stringify({ complexity: -3, type: 'feature', impact_summary: '', risk_level: 'low' }));
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(1);
  });

  it('falls back to "other" for invalid type', async () => {
    mockLLMResponse(JSON.stringify({ complexity: 5, type: 'bananas', impact_summary: '', risk_level: 'low' }));
    const result = await analyzeCommit(makeCommit());
    expect(result.type).toBe('other');
  });

  it('falls back to "low" for invalid risk', async () => {
    mockLLMResponse(JSON.stringify({ complexity: 5, type: 'feature', impact_summary: '', risk_level: 'extreme' }));
    const result = await analyzeCommit(makeCommit());
    expect(result.riskLevel).toBe('low');
  });

  it('parses JSON wrapped in markdown fences', async () => {
    mockLLMResponse('```json\n{"complexity":6,"type":"bug","impact_summary":"Fixes login","risk_level":"high","maybe_ai":true}\n```');
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(6);
    expect(result.type).toBe('bug');
    expect(result.riskLevel).toBe('high');
    expect(result.maybeAi).toBe(true);
  });

  it('returns defaults for garbage response', async () => {
    mockLLMResponse('this is not json at all');
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(5);
    expect(result.type).toBe('other');
    expect(result.riskLevel).toBe('low');
  });

  it('forces maybeAi to false when aiCoAuthored is true', async () => {
    mockLLMResponse(JSON.stringify({ complexity: 5, type: 'feature', impact_summary: '', risk_level: 'low', maybe_ai: true }));
    const result = await analyzeCommit(makeCommit({ aiCoAuthored: true }));
    expect(result.maybeAi).toBe(false);
  });

  it('handles array content from LLM response', async () => {
    (getLLMClient as jest.Mock).mockResolvedValue({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: ['{"complexity":4,', '"type":"refactor","impact_summary":"Refactors auth","risk_level":"low","maybe_ai":false}'] } }],
          }),
        },
      },
    });
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(4);
    expect(result.type).toBe('refactor');
  });

  it('handles null content from LLM response', async () => {
    (getLLMClient as jest.Mock).mockResolvedValue({
      chat: {
        completions: {
          create: jest.fn().mockResolvedValue({
            choices: [{ message: { content: null } }],
          }),
        },
      },
    });
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(5);
    expect(result.type).toBe('other');
  });

  it('rounds non-integer complexity', async () => {
    mockLLMResponse(JSON.stringify({ complexity: 7.6, type: 'feature', impact_summary: '', risk_level: 'low' }));
    const result = await analyzeCommit(makeCommit());
    expect(result.complexity).toBe(8);
  });

  it('uses shorter system prompt when aiCoAuthored is true', async () => {
    const createFn = jest.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ complexity: 5, type: 'feature', impact_summary: '', risk_level: 'low' }) } }],
    });
    (getLLMClient as jest.Mock).mockResolvedValue({
      chat: { completions: { create: createFn } },
    });

    await analyzeCommit(makeCommit({ aiCoAuthored: true }));
    const messages = createFn.mock.calls[0][0].messages;
    const systemMsg: string = messages[0].content;
    // AI-confirmed prompt doesn't mention maybe_ai
    expect(systemMsg).not.toContain('maybe_ai');
  });

  describe('prompt and settings snapshots', () => {
    function setupWithCreateFn() {
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
      const messages = createFn.mock.calls[0][0].messages;
      const systemMsg: string = messages[0].content;
      expect(systemMsg).toMatchSnapshot();
      expect(systemMsg).toContain('maybe_ai');
      expect(systemMsg).toContain('complexity');
      expect(systemMsg).toContain('Complexity calibration');
    });

    it('sends exact system prompt (AI confirmed, no maybe_ai)', async () => {
      const createFn = setupWithCreateFn();
      await analyzeCommit(makeCommit({ aiCoAuthored: true }));
      const messages = createFn.mock.calls[0][0].messages;
      const systemMsg: string = messages[0].content;
      expect(systemMsg).toMatchSnapshot();
      expect(systemMsg).not.toContain('maybe_ai');
      expect(systemMsg).toContain('complexity');
      expect(systemMsg).toContain('Complexity calibration');
    });

    it('sends exact user message format', async () => {
      const createFn = setupWithCreateFn();
      const commit = makeCommit();
      await analyzeCommit(commit);
      const messages = createFn.mock.calls[0][0].messages;
      const userMsg: string = messages[1].content;
      expect(userMsg).toMatchSnapshot();
      expect(userMsg).toContain(`Repository: ${commit.repo}`);
      expect(userMsg).toContain(`Author: ${commit.authorName} (@${commit.author})`);
      expect(userMsg).toContain(`Commit message: ${commit.message}`);
      expect(userMsg).toContain(commit.diff!);
    });

    it('passes correct LLM settings', async () => {
      const createFn = setupWithCreateFn();
      await analyzeCommit(makeCommit());
      const callArgs = createFn.mock.calls[0][0];
      expect(callArgs.temperature).toBe(0);
      expect(callArgs.max_completion_tokens).toBe(256);
      expect(callArgs.model).toBe('test-model');
      expect(callArgs.response_format).toEqual({ type: 'json_object' });
    });
  });
});
