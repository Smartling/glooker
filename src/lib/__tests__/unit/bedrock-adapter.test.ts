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
