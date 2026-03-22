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
- Add `case 'bedrock'` in `getLLMClient()` that delegates to `createBedrockClient()` from the adapter, cast as `as unknown as OpenAI` (all callers already use `as any` on the `create()` call, so the return type is ceremonial)
- Update `LLM_MODEL` default logic from a ternary to a lookup: `bedrock` → `anthropic.claude-sonnet-4-20250514-v1:0`, `anthropic` → `claude-sonnet-4-20250514`, default → `gpt-4o`
- Client is cached (AWS credentials are long-lived within a session, unlike Smartling tokens)

## Bedrock Adapter (`src/lib/bedrock-adapter.ts`)

New file exporting `createBedrockClient()`, which returns a duck-typed object matching the subset of the OpenAI client that consumers use: `{ chat: { completions: { create() } } }`.

The `create()` method:

1. Destructures only known properties (`messages`, `model`, `temperature`, `max_tokens`, `response_format`) from OpenAI-style params — extra properties from `extraBodyProps()` (e.g., Smartling fields) are silently ignored
2. Separates system messages from user/assistant messages (Bedrock Anthropic format requires `system` as a top-level field, not in the messages array)
3. Builds an `InvokeModel` request body with `anthropic_version: "bedrock-2023-05-31"` (from [Bedrock Anthropic docs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html))
4. If `response_format.type === 'json_object'`, appends to the system prompt: `"\n\nYou must respond with valid JSON only. No markdown fences, no explanatory text — just the JSON object."` (appended to existing system content, not a separate message)
5. If `max_tokens` is not provided, defaults to `4096` (Bedrock requires this field)
6. Calls `BedrockRuntimeClient.send(new InvokeModelCommand(...))`
7. Parses the response and wraps it in an OpenAI `ChatCompletion`-shaped object: `{ choices: [{ message: { content, role } }] }`

No streaming support — the project doesn't use streaming today.

## Error Handling

Bedrock API errors (throttling, access denied, model not available) will propagate as-is from the AWS SDK. Callers already handle LLM errors with catch-and-continue patterns (e.g., `analyzer.ts` catches JSON parse failures). AWS SDK errors have a different shape than `OpenAI.APIError`, but since no caller catches provider-specific error types, this is acceptable. The adapter does not wrap or translate errors.

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
