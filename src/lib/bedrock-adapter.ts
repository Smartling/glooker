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
        async create(params: {
          messages: { role: string; content: string }[];
          model: string;
          temperature?: number;
          max_tokens?: number;
          response_format?: { type: string };
          [key: string]: unknown;
        }) {
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
            const hint = '\n\nYou must respond with valid JSON only. No markdown fences, no explanatory text — just the JSON object.';
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
          if (!response.body) throw new Error('Empty response from Bedrock');
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
