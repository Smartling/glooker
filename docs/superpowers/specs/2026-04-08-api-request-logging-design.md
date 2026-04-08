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

On first write, creates `LOG_DIR` with `mkdirSync({ recursive: true })` if it doesn't exist.

Uses `fs.appendFile` (async) for writes. No rotation — the infrastructure (logrotate, Splunk sidecar, etc.) handles that.

### Wrapper function — `withRequestLog(handler)`

Applied to every exported route handler:

```typescript
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) { /* ... */ }
async function postHandler(req: NextRequest) { /* ... */ }

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
```

The wrapper:

1. Generates `requestId` via `crypto.randomUUID()`
2. Extracts `userEmail` via `extractUser(req.headers)` — returns `null` if auth disabled or no JWT
3. Records `startTime` via `Date.now()`
4. Calls the original handler in a try/catch
5. On success: writes to `requests.log`. If status >= 400, also writes to `errors.log`
6. On uncaught exception: writes to both logs with error/stack, returns a 500 response
7. Returns the original response

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

When `LOG_DIR` is set, validate the directory is writable (or can be created). Warn if not — don't crash the server.

### .env.example

```
# LOG_DIR=/var/log/glooker  # Uncomment to enable API request logging
```

### .gitignore

Add `logs/` to prevent local dev logs from being committed.

## Scope

- New file: `src/lib/logger.ts`
- New file: `src/__tests__/logger-enforcement.test.ts`
- Modified: all 33 existing `src/app/api/**/route.ts` files (wrap handlers)
- Modified: `src/lib/env-validation.ts` (add `LOG_DIR` validation)
- Modified: `.env.example` (add `LOG_DIR`)
- Modified: `.gitignore` (add `logs/`)
- Modified: `CLAUDE.md` (document the convention)
