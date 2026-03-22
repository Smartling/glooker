# AWS Bedrock LLM Provider

## Overview

Add native AWS Bedrock support as a new LLM provider (`LLM_PROVIDER=bedrock`), using `@aws-sdk/client-bedrock-runtime` with `InvokeModel` targeting Anthropic's Messages API format on Bedrock. Authentication uses the default AWS credential provider chain, supporting SSO via `AWS_PROFILE`.

## Approach

Use `@aws-sdk/client-bedrock-runtime` to call Bedrock's `InvokeModel` API directly, with a thin adapter layer that translates between OpenAI-style requests/responses and Bedrock's Anthropic Messages format. Consumers of `getLLMClient()` remain unchanged.

### Alternatives considered

- **Bedrock Converse API:** Cleaner message format but handles JSON mode differently, requiring workarounds. No meaningful advantage over direct InvokeModel for our use case.
- **LiteLLM proxy with `openai-compatible`:** Zero code changes but requires running a separate process. Poor developer experience.

## Provider Integration

- Add `'bedrock'` to the `Provider` union type in `llm-provider.ts`
- Add `case 'bedrock'` in `getLLMClient()` that delegates to `createBedrockClient()` from the adapter
- Default model: `anthropic.claude-sonnet-4-20250514-v1:0` when `LLM_PROVIDER=bedrock` and no `LLM_MODEL` override
- Client is cached (AWS credentials are long-lived within a session, unlike Smartling tokens)

## Bedrock Adapter (`src/lib/bedrock-adapter.ts`)

New file exporting `createBedrockClient()`, which returns a duck-typed object matching the subset of the OpenAI client that consumers use: `{ chat: { completions: { create() } } }`.

The `create()` method:

1. Extracts `messages`, `model`, `temperature`, `max_tokens`, and `response_format` from OpenAI-style params
2. Separates system messages from user/assistant messages (Bedrock Anthropic format requires `system` as a top-level field, not in the messages array)
3. Builds an `InvokeModel` request body with `anthropic_version: "bedrock-2023-05-31"`
4. If `response_format.type === 'json_object'`, prepends a JSON output hint to the system prompt (Bedrock Anthropic doesn't support `response_format` natively; the existing project already strips markdown fences as a safety net)
5. Calls `BedrockRuntimeClient.send(new InvokeModelCommand(...))`
6. Parses the response and wraps it in an OpenAI `ChatCompletion`-shaped object: `{ choices: [{ message: { content, role } }] }`

No streaming support — the project doesn't use streaming today.

## Environment Variables

Standard AWS env vars (not app-specific):

- `AWS_PROFILE` — SSO profile name
- `AWS_REGION` — Bedrock region (defaults to `us-east-1`)

## Dependencies

- `@aws-sdk/client-bedrock-runtime` — only AWS SDK package needed

## Files Changed

| File | Action |
|------|--------|
| `src/lib/bedrock-adapter.ts` | New — adapter translating OpenAI ↔ Bedrock |
| `src/lib/llm-provider.ts` | Modify — add `bedrock` provider case |
| `src/lib/__tests__/unit/llm-provider.test.ts` | Modify — add tests for bedrock provider |
| `src/lib/__tests__/unit/bedrock-adapter.test.ts` | New — adapter unit tests |
| `.env.example` | Modify — document Bedrock config |
| `package.json` | Modify — add `@aws-sdk/client-bedrock-runtime` |
