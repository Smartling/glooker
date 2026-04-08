# API Request Logging

## Overview

Add structured JSON request logging to Glooker. Every API request is logged to `requests.log`; errors (4xx/5xx and uncaught exceptions) are additionally logged to `errors.log`. Logging is opt-in — enabled only when the `LOG_DIR` env var is set.

This is an OSS project. The logging feature must work standalone (files on disk) with no dependency on any specific log aggregator. In Smartling's deployment, a Splunk sidecar (configured in the `glooker-deploy` repo) ships these files — but the app itself knows nothing about Splunk.

## Log format

Both files use newline-delimited JSON (one JSON object per line).

### requests.log

Every API request, regardless of status:

```json
{
  "timestamp": "2026-04-08T14:23:01.123Z",
  "requestId": "a1b2c3d4-...",
  "method": "GET",
  "uri": "/api/report",
  "query": "org=my-org&period=30",
  "statusCode": 200,
  "durationMs": 42,
  "userEmail": "jane@example.com"
}
```

### errors.log

Only written for responses with status >= 400 or uncaught exceptions. Same fields as the request log, plus error details:

```json
{
  "timestamp": "2026-04-08T14:23:01.123Z",
  "requestId": "a1b2c3d4-...",
  "method": "POST",
  "uri": "/api/report",
  "query": "",
  "statusCode": 500,
  "durationMs": 120,
  "userEmail": "jane@example.com",
  "error": "Connection refused",
  "stack": "Error: Connection refused\n    at ..."
}
```

### Field definitions

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | string | ISO 8601 UTC |
| `requestId` | string | `crypto.randomUUID()`, generated per request |
| `method` | string | HTTP method (GET, POST, etc.) |
| `uri` | string | Request path (e.g., `/api/report`) |
| `query` | string | Raw query string as-is, empty string if none |
| `statusCode` | number | HTTP response status code |
| `durationMs` | number | Time from handler start to response |
| `userEmail` | string \| null | From ALB OIDC JWT when `AUTH_ENABLED=true`, otherwise `null` |
| `error` | string | Error message (errors.log only) |
| `stack` | string | Error stack trace (errors.log only) |

## Architecture

### Logger module — `src/lib/logger.ts`

Single module that owns all logging logic:

- `writeRequestLog(entry)` — appends a JSON line to `${LOG_DIR}/requests.log`
- `writeErrorLog(entry)` — appends a JSON line to `${LOG_DIR}/errors.log`
- `withRequestLog(handler)` — HOF that wraps Next.js route handlers

When `LOG_DIR` is not set, all functions are no-ops.

On first write, creates `LOG_DIR` with `mkdirSync({ recursive: true })` if it doesn't exist. This is intentionally synchronous — it runs at most once and simplifies initialization. The `recursive: true` flag safely handles concurrent first-write races.

Uses `fs.appendFile` (async) for writes. No rotation — the infrastructure (logrotate, Splunk sidecar, etc.) handles that. If a write fails, the error is caught and logged to `console.error` — logging failures must never affect request handling.

### Wrapper function — `withRequestLog(handler)`

Applied to every exported route handler. The wrapper uses a generic signature to support all handler shapes in the codebase:

- Zero-arg handlers: `GET()` (e.g., `/api/health`, `/api/orgs`)
- Single-arg handlers: `GET(req: NextRequest)` or `GET(req: Request)`
- Two-arg handlers: `GET(req: NextRequest, context: { params: Promise<{ id: string }> })`

```typescript
// Generic signature — preserves the original handler's type
function withRequestLog<T extends (...args: any[]) => Promise<Response>>(handler: T): T
```

**Usage examples:**

```typescript
import { withRequestLog } from '@/lib/logger';

// Standard handler
async function getHandler(req: NextRequest) { /* ... */ }
export const GET = withRequestLog(getHandler);

// Dynamic route with params
async function getById(req: NextRequest, ctx: { params: Promise<{ id: string }> }) { /* ... */ }
export const GET = withRequestLog(getById);

// Zero-arg handler
async function healthCheck() { /* ... */ }
export const GET = withRequestLog(healthCheck);
```

The wrapper:

1. Generates `requestId` via `crypto.randomUUID()`
2. Extracts `userEmail` via `extractUser(args[0]?.headers)?.email ?? null` — returns `null` if auth disabled, no JWT, or handler has no `req` argument
3. Records `startTime` via `Date.now()`
4. Calls the original handler with all arguments forwarded (`handler(...args)`) in a try/catch
5. On success: writes to `requests.log`. If status >= 400, also writes to `errors.log` with `error: null, stack: null` (no exception was thrown)
6. On uncaught exception: writes to both logs with `error` (message) and `stack` (trace), returns `NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })`
7. Returns the original response

**Error field semantics:**
- For non-exception 4xx/5xx responses (handler returned an error status normally): `error: null`, `stack: null`. The status code itself is the signal.
- For uncaught exceptions (handler threw): `error` contains the error message, `stack` contains the stack trace.

**Logging failures:** If `fs.appendFile` fails (disk full, permissions, etc.), the error is caught and logged to `console.error` as a fallback. A logging failure must never crash the request handler.

**Streaming responses:** For handlers that return streaming responses (e.g., `/api/chat`), `durationMs` reflects time-to-first-byte — the time from handler invocation to when the `Response` object is returned, not when the stream completes.

**No exclusions:** All API routes are logged, including high-frequency endpoints like `/api/health`. Filtering is handled downstream (e.g., Splunk queries).

When `LOG_DIR` is unset, the wrapper still calls the handler — it just skips log writes.

## Enforcement

### Jest test — `src/__tests__/logger-enforcement.test.ts`

- Globs all `src/app/api/**/route.ts` files
- Reads each file and asserts it imports `withRequestLog`
- Fails CI if any route file is missing the import

**Known limitations:**
- A file could import `withRequestLog` but not wrap all exports — the test would pass (false positive)
- Re-export patterns or barrel files could obscure the import — the test would fail incorrectly (false negative)
- If the import path or function name changes, the test needs updating (brittle)

This is a lightweight tripwire, not a guarantee. Code review remains the real enforcement mechanism.

### CLAUDE.md

Add documentation that all API route handlers must be wrapped with `withRequestLog()`.

## Configuration

### Env var

| Var | Required | Default | Description |
|-----|----------|---------|-------------|
| `LOG_DIR` | No | (unset) | Directory for log files. When set, logging is active. When unset, logging is disabled. |

### env-validation.ts

When `LOG_DIR` is set, validate the directory is writable (or can be created) using `fs.accessSync` / `fs.mkdirSync`. This is a departure from the existing string-only validators — it requires a special-case filesystem check outside the standard `validate` callback pattern. Warn if not writable — don't crash the server.

### .env.example

```
# LOG_DIR=/var/log/glooker  # Uncomment to enable API request logging
```

### .gitignore

The existing `.gitignore` already has `*.log` which covers the log files themselves. Add `logs/` to also exclude the default log directory (in case it contains non-`.log` files or is used as a local dev convention).

## Known limitations (deferred)

- **Concurrent write safety:** Multiple concurrent `fs.appendFile` calls could interleave for very large log lines (e.g., deep stack traces). Acceptable at expected load; a write-stream or buffered logger is a future option.
- **Log entry size limits:** No truncation on `query`, `error`, or `stack` fields. A future enhancement could cap `stack` at ~10KB.
- **Sensitive query params:** Query strings are logged as-is and may contain tokens or PII. Redaction/filtering is a follow-up concern.
- **Docker deployment:** When running in Docker, `LOG_DIR` must point to a writable volume mount. Operational guidance deferred to deploy repo.
- **Unit tests for `logger.ts`:** The spec defines an enforcement test but not unit tests for the logger module itself. Worth adding but not blocking.

## Scope

- New file: `src/lib/logger.ts`
- New file: `src/__tests__/logger-enforcement.test.ts`
- Modified: all 33 existing `src/app/api/**/route.ts` files (42 handler exports total — wrap each)
- Modified: `src/lib/env-validation.ts` (add `LOG_DIR` validation)
- Modified: `.env.example` (add `LOG_DIR`)
- Modified: `.gitignore` (add `logs/`)
- Modified: `CLAUDE.md` (document the convention)
