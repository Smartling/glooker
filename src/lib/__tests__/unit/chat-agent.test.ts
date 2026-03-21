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

function makeMockClient(responses: string[]) {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: jest.fn().mockImplementation(() => {
          const content = responses[callCount] ?? '';
          callCount++;
          return Promise.resolve({ choices: [{ message: { content } }] });
        }),
      },
    },
  };
}

describe('chat-agent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('prompt and settings snapshots', () => {
    it('sends exact system prompt with tools description and org', async () => {
      const mockClient = makeMockClient(['Here is the final answer.']);
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      await runChatAgent([{ role: 'user', content: 'Hello' }], 'acme');

      const createCall = mockClient.chat.completions.create.mock.calls[0][0];
      const systemMessage = createCall.messages[0];

      expect(systemMessage.role).toBe('system');
      expect(systemMessage.content).toContain('You are Glooker Assistant');
      expect(systemMessage.content).toContain('TOOL_CALL:');
      expect(systemMessage.content).toContain('Available tools:');
      expect(systemMessage.content).toContain('testTool: A test tool');
      expect(systemMessage.content).toContain('Current org: acme');
      expect(systemMessage.content).toContain('MAX 3-4 short columns');
      expect(systemMessage.content).toContain('Never use tables wider than 4 columns');

      expect(systemMessage.content).toMatchSnapshot();
    });

    it('passes correct LLM settings', async () => {
      const mockClient = makeMockClient(['Direct answer.']);
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      await runChatAgent([{ role: 'user', content: 'Test' }], 'acme');

      const createCall = mockClient.chat.completions.create.mock.calls[0][0];
      expect(createCall.temperature).toBe(0.3);
      expect(createCall.max_tokens).toBe(1500);
      expect(createCall.model).toBe('test-model');
    });
  });

  describe('tool call flow', () => {
    it('executes tool calls and sends results back to LLM', async () => {
      const mockClient = makeMockClient([
        'TOOL_CALL: {"name": "testTool", "args": {"org": "acme"}}',
        'Here is the final answer based on the data.',
      ]);
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      const result = await runChatAgent([{ role: 'user', content: 'Who is top?' }], 'acme');

      expect(executeTool).toHaveBeenCalledWith('testTool', { org: 'acme' });
      expect(result.toolCalls).toHaveLength(1);
      expect(result.response).toBe('Here is the final answer based on the data.');
    });

    it('injects org when args.org is missing', async () => {
      const mockClient = makeMockClient([
        'TOOL_CALL: {"name": "testTool", "args": {}}',
        'Final answer.',
      ]);
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      await runChatAgent([{ role: 'user', content: 'Test' }], 'myorg');

      expect(executeTool).toHaveBeenCalledWith('testTool', { org: 'myorg' });
    });
  });

  describe('MAX_ITERATIONS limit', () => {
    it('stops after 5 iterations and returns fallback message', async () => {
      const mockClient = makeMockClient(Array(10).fill('TOOL_CALL: {"name": "testTool", "args": {"org": "acme"}}'));
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      const result = await runChatAgent([{ role: 'user', content: 'Loop forever' }], 'acme');

      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(5);
      expect(result.response).toBe('I hit the maximum number of data lookups. Try a more specific question.');
    });
  });

  describe('response cleaning', () => {
    it('returns clean response when no tool calls present', async () => {
      const mockClient = makeMockClient(['This is a simple direct answer.']);
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      const result = await runChatAgent([{ role: 'user', content: 'Simple question' }], 'acme');

      expect(result.response).toBe('This is a simple direct answer.');
    });

    it('returns empty toolCalls array for direct answers', async () => {
      const mockClient = makeMockClient(['Direct answer without any tool usage.']);
      (getLLMClient as jest.Mock).mockResolvedValue(mockClient);

      const result = await runChatAgent([{ role: 'user', content: 'Question' }], 'acme');

      expect(result.toolCalls).toEqual([]);
    });
  });
});
