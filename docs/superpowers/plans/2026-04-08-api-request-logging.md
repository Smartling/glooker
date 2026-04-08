# API Request Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in structured JSON request logging to all API routes, with error logging to a separate file.

**Architecture:** A single `src/lib/logger.ts` module provides `withRequestLog(handler)` — a HOF that wraps route handlers to log requests to `requests.log` and errors to `errors.log` under a configurable `LOG_DIR`. Logging is disabled (no-op) when `LOG_DIR` is unset. A Jest enforcement test ensures all route files import the wrapper.

**Tech Stack:** Node.js `fs` (appendFile), `crypto` (randomUUID), `path` (resolve), Next.js 15 route handlers, Jest

**Spec:** `docs/superpowers/specs/2026-04-08-api-request-logging-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/logger.ts` | Create | Log entry types, `writeRequestLog`, `writeErrorLog`, `withRequestLog` HOF |
| `src/lib/__tests__/unit/logger.test.ts` | Create | Unit tests for logger module |
| `src/lib/__tests__/unit/logger-enforcement.test.ts` | Create | Enforcement test — all route files import `withRequestLog` |
| `src/lib/env-validation.ts` | Modify | Add `LOG_DIR` writability check |
| `.env.example` | Modify | Add `LOG_DIR` comment |
| `.gitignore` | Modify | Add `logs/` |
| `CLAUDE.md` | Modify | Document `withRequestLog` convention |
| 33 `src/app/api/**/route.ts` files | Modify | Wrap all 42 handler exports |

---

### Task 1: Logger Module — Types and Write Functions

**Files:**
- Create: `src/lib/logger.ts`
- Create: `src/lib/__tests__/unit/logger.test.ts`

- [ ] **Step 1: Write tests for the write functions**

Create `src/lib/__tests__/unit/logger.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import os from 'os';

// Must set LOG_DIR before importing logger — it reads at module level
let testLogDir: string;

beforeEach(() => {
  testLogDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glooker-log-'));
  process.env.LOG_DIR = testLogDir;
  // Re-import to pick up new LOG_DIR — jest.resetModules clears the cache
  jest.resetModules();
});

afterEach(() => {
  delete process.env.LOG_DIR;
  fs.rmSync(testLogDir, { recursive: true, force: true });
});

describe('writeRequestLog', () => {
  it('appends a JSON line to requests.log', async () => {
    const { writeRequestLog } = await import('@/lib/logger');
    const entry = {
      timestamp: '2026-04-08T00:00:00.000Z',
      requestId: 'test-id',
      method: 'GET',
      uri: '/api/health',
      query: '',
      statusCode: 200,
      durationMs: 5,
      userEmail: null,
    };
    await writeRequestLog(entry);
    const content = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8');
    expect(JSON.parse(content.trim())).toEqual(entry);
  });

  it('appends multiple entries as separate lines', async () => {
    const { writeRequestLog } = await import('@/lib/logger');
    const entry = {
      timestamp: '2026-04-08T00:00:00.000Z',
      requestId: 'id-1',
      method: 'GET',
      uri: '/api/health',
      query: '',
      statusCode: 200,
      durationMs: 5,
      userEmail: null,
    };
    await writeRequestLog(entry);
    await writeRequestLog({ ...entry, requestId: 'id-2' });
    const lines = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).requestId).toBe('id-1');
    expect(JSON.parse(lines[1]).requestId).toBe('id-2');
  });
});

describe('writeErrorLog', () => {
  it('appends a JSON line to errors.log', async () => {
    const { writeErrorLog } = await import('@/lib/logger');
    const entry = {
      timestamp: '2026-04-08T00:00:00.000Z',
      requestId: 'test-id',
      method: 'POST',
      uri: '/api/report',
      query: '',
      statusCode: 500,
      durationMs: 10,
      userEmail: 'a@b.com',
      error: 'fail',
      stack: 'Error: fail\n    at ...',
    };
    await writeErrorLog(entry);
    const content = fs.readFileSync(path.join(testLogDir, 'errors.log'), 'utf-8');
    expect(JSON.parse(content.trim())).toEqual(entry);
  });
});

describe('no-op when LOG_DIR is unset', () => {
  it('writeRequestLog does nothing', async () => {
    delete process.env.LOG_DIR;
    jest.resetModules();
    const { writeRequestLog } = await import('@/lib/logger');
    // Should not throw
    await writeRequestLog({
      timestamp: '', requestId: '', method: '', uri: '', query: '',
      statusCode: 200, durationMs: 0, userEmail: null,
    });
    // No file created
    expect(fs.readdirSync(testLogDir)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npx jest --testPathPattern="logger.test" -v`

Expected: FAIL — `Cannot find module '@/lib/logger'`

- [ ] **Step 3: Implement the logger module**

Create `src/lib/logger.ts`:

```typescript
import fs from 'fs';
import path from 'path';
import { extractUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

// --- Types ---

export interface RequestLogEntry {
  timestamp: string;
  requestId: string;
  method: string;
  uri: string;
  query: string;
  statusCode: number;
  durationMs: number;
  userEmail: string | null;
}

export interface ErrorLogEntry extends RequestLogEntry {
  error: string | null;
  stack: string | null;
}

// --- Configuration ---

const logDir = process.env.LOG_DIR ? path.resolve(process.env.LOG_DIR) : null;
let dirEnsured = false;

function ensureDir(): void {
  if (dirEnsured || !logDir) return;
  fs.mkdirSync(logDir, { recursive: true });
  dirEnsured = true;
}

// --- Write functions ---

export async function writeRequestLog(entry: RequestLogEntry): Promise<void> {
  if (!logDir) return;
  try {
    ensureDir();
    await fs.promises.appendFile(path.join(logDir, 'requests.log'), JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[logger] Failed to write request log:', err);
  }
}

export async function writeErrorLog(entry: ErrorLogEntry): Promise<void> {
  if (!logDir) return;
  try {
    ensureDir();
    await fs.promises.appendFile(path.join(logDir, 'errors.log'), JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error('[logger] Failed to write error log:', err);
  }
}

// --- Wrapper HOF ---

export function withRequestLog<T extends (...args: any[]) => Promise<Response>>(handler: T): T {
  const wrapped = async (...args: any[]): Promise<Response> => {
    const requestId = crypto.randomUUID();
    const startTime = Date.now();

    // Extract request metadata — Next.js always passes Request as args[0]
    const req = args[0] && typeof args[0] === 'object' && 'url' in args[0] ? args[0] as Request : null;
    let uri = '';
    let query = '';
    let method = '';
    let userEmail: string | null = null;

    if (req) {
      const url = new URL(req.url);
      uri = url.pathname;
      query = url.search.slice(1); // remove leading '?'
      method = req.method;
      if ('headers' in req) {
        userEmail = extractUser(req.headers)?.email ?? null;
      }
    }

    try {
      const response = await handler(...args);
      const durationMs = Date.now() - startTime;
      const statusCode = response.status;

      const logEntry: RequestLogEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        method,
        uri,
        query,
        statusCode,
        durationMs,
        userEmail,
      };

      await writeRequestLog(logEntry);

      if (statusCode >= 400) {
        await writeErrorLog({ ...logEntry, error: null, stack: null });
      }

      return response;
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack ?? '' : '';

      const logEntry: ErrorLogEntry = {
        timestamp: new Date().toISOString(),
        requestId,
        method,
        uri,
        query,
        statusCode: 500,
        durationMs,
        userEmail,
        error,
        stack,
      };

      await writeRequestLog({
        timestamp: logEntry.timestamp,
        requestId,
        method,
        uri,
        query,
        statusCode: 500,
        durationMs,
        userEmail,
      });
      await writeErrorLog(logEntry);

      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
  };

  return wrapped as T;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npx jest --testPathPattern="logger.test" -v`

Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
git add src/lib/logger.ts src/lib/__tests__/unit/logger.test.ts && \
git commit -m "feat: add logger module with writeRequestLog, writeErrorLog, and withRequestLog"
```

---

### Task 2: withRequestLog Wrapper Tests

**Files:**
- Modify: `src/lib/__tests__/unit/logger.test.ts`

- [ ] **Step 1: Add wrapper tests**

Append to `src/lib/__tests__/unit/logger.test.ts`:

```typescript
describe('withRequestLog', () => {
  it('calls the original handler and returns its response', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = jest.fn(async () => new Response('ok', { status: 200 }));
    const wrapped = withRequestLog(handler);

    const req = new Request('http://localhost/api/test?org=acme');
    const response = await wrapped(req);

    expect(handler).toHaveBeenCalledWith(req);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
  });

  it('writes request log entry for successful request', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => new Response('ok', { status: 200 });
    const wrapped = withRequestLog(handler);

    await wrapped(new Request('http://localhost/api/report?org=acme'));

    const content = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8');
    const entry = JSON.parse(content.trim());
    expect(entry.method).toBe('GET');
    expect(entry.uri).toBe('/api/report');
    expect(entry.query).toBe('org=acme');
    expect(entry.statusCode).toBe(200);
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
    expect(entry.userEmail).toBeNull();
    expect(entry.requestId).toBeDefined();
    expect(entry.timestamp).toBeDefined();
  });

  it('writes to errors.log for 4xx status with null error/stack', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    const wrapped = withRequestLog(handler);

    await wrapped(new Request('http://localhost/api/report/999'));

    const errContent = fs.readFileSync(path.join(testLogDir, 'errors.log'), 'utf-8');
    const entry = JSON.parse(errContent.trim());
    expect(entry.statusCode).toBe(404);
    expect(entry.error).toBeNull();
    expect(entry.stack).toBeNull();
  });

  it('catches thrown errors, logs with stack, returns 500 JSON', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => { throw new Error('boom'); };
    const wrapped = withRequestLog(handler);

    const response = await wrapped(new Request('http://localhost/api/fail'));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ error: 'Internal Server Error' });

    const reqContent = fs.readFileSync(path.join(testLogDir, 'requests.log'), 'utf-8');
    expect(JSON.parse(reqContent.trim()).statusCode).toBe(500);

    const errContent = fs.readFileSync(path.join(testLogDir, 'errors.log'), 'utf-8');
    const errEntry = JSON.parse(errContent.trim());
    expect(errEntry.error).toBe('boom');
    expect(errEntry.stack).toContain('Error: boom');
  });

  it('forwards all arguments to the handler (context params)', async () => {
    const { withRequestLog } = await import('@/lib/logger');
    const handler = jest.fn(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
      const { id } = await ctx.params;
      return new Response(id, { status: 200 });
    });
    const wrapped = withRequestLog(handler);

    const req = new Request('http://localhost/api/report/abc');
    const ctx = { params: Promise.resolve({ id: 'abc' }) };
    const response = await wrapped(req, ctx);

    expect(handler).toHaveBeenCalledWith(req, ctx);
    expect(await response.text()).toBe('abc');
  });

  it('does not write logs when LOG_DIR is unset', async () => {
    delete process.env.LOG_DIR;
    jest.resetModules();
    const { withRequestLog } = await import('@/lib/logger');
    const handler = async () => new Response('ok', { status: 200 });
    const wrapped = withRequestLog(handler);

    await wrapped(new Request('http://localhost/api/health'));

    expect(fs.readdirSync(testLogDir)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npx jest --testPathPattern="logger.test" -v`

Expected: PASS (all tests including new ones)

- [ ] **Step 3: Commit**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
git add src/lib/__tests__/unit/logger.test.ts && \
git commit -m "test: add withRequestLog wrapper tests"
```

---

### Task 3: Enforcement Test

**Files:**
- Create: `src/lib/__tests__/unit/logger-enforcement.test.ts`

- [ ] **Step 1: Write the enforcement test**

Create `src/lib/__tests__/unit/logger-enforcement.test.ts`:

```typescript
import fs from 'fs';
import path from 'path';

function findRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findRouteFiles(fullPath));
    } else if (entry.name === 'route.ts') {
      results.push(fullPath);
    }
  }
  return results;
}

describe('logger enforcement', () => {
  it('all API route files import withRequestLog', () => {
    const routeFiles = findRouteFiles(path.join('src', 'app', 'api'));
    expect(routeFiles.length).toBeGreaterThan(0);

    const missing: string[] = [];
    for (const file of routeFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (!content.includes('withRequestLog')) {
        missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npx jest --testPathPattern="logger-enforcement" -v`

Expected: FAIL — all 33 route files are missing `withRequestLog` (this is expected; we wrap them in Task 5)

- [ ] **Step 3: Commit**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
git add src/lib/__tests__/unit/logger-enforcement.test.ts && \
git commit -m "test: add enforcement test for withRequestLog in all route files"
```

---

### Task 4: Configuration — env-validation, .env.example, .gitignore

**Files:**
- Modify: `src/lib/env-validation.ts`
- Modify: `.env.example`
- Modify: `.gitignore`

- [ ] **Step 1: Add LOG_DIR validation to env-validation.ts**

Add a new special-case check at the end of the `validateEnv` function, before the report block. Insert after the conditional rules loop and before the `// Report` comment:

```typescript
  // Special-case: LOG_DIR writability check (requires filesystem I/O)
  const logDir = process.env.LOG_DIR;
  if (logDir) {
    const resolved = path.resolve(logDir);
    try {
      fs.mkdirSync(resolved, { recursive: true });
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch (err) {
      warnings.push(`  - LOG_DIR: directory "${resolved}" is not writable — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
```

Add `import fs from 'fs';` and `import path from 'path';` at the top of the file.

- [ ] **Step 2: Add LOG_DIR to .env.example**

Add at the end of the file, after the Authentication section:

```
# -----------------------------------------------------------------------------
# Logging (optional — structured JSON request/error logs)
# -----------------------------------------------------------------------------
# Optional — Directory for log files. When set, all API requests are logged.
# LOG_DIR=/var/log/glooker
```

- [ ] **Step 3: Add logs/ to .gitignore**

Append to `.gitignore`:

```
logs/
```

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npx jest --testPathIgnorePatterns="logger-enforcement"`

Expected: All tests pass (excluding the enforcement test, which is in RED — routes aren't wrapped yet).

- [ ] **Step 5: Commit**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
git add src/lib/env-validation.ts .env.example .gitignore && \
git commit -m "feat: add LOG_DIR env validation, .env.example entry, and gitignore"
```

---

### Task 5: Wrap All Route Handlers

**Files:**
- Modify: all 33 `src/app/api/**/route.ts` files (42 handler exports)

This is a mechanical refactoring: for each exported handler, rename the function (remove `export`), add `import { withRequestLog } from '@/lib/logger'`, and export via `withRequestLog(handler)`.

The transformation pattern for each file:

**Before:**
```typescript
export async function GET(req: NextRequest) { /* ... */ }
export async function POST(req: NextRequest) { /* ... */ }
```

**After:**
```typescript
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) { /* ... */ }
async function postHandler(req: NextRequest) { /* ... */ }

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
```

**Naming convention for inner functions:** Use `<method>Handler` (e.g., `getHandler`, `postHandler`, `putHandler`, `deleteHandler`, `patchHandler`).

- [ ] **Step 1: Wrap routes — batch 1 (simple zero-arg and single-arg GET routes)**

Files (11 files, 12 handlers):
- `src/app/api/health/route.ts` — `GET()` → `getHandler()`
- `src/app/api/orgs/route.ts` — `GET()` → `getHandler()`
- `src/app/api/llm-config/route.ts` — `GET()` + `POST(req: Request)` → `getHandler()` + `postHandler(req: Request)`
- `src/app/api/project-insights/route.ts` — `GET()` → `getHandler()`
- `src/app/api/release-notes/route.ts` — `GET()` → `getHandler()`
- `src/app/api/report-highlights/route.ts` — `GET()` → `getHandler()`
- `src/app/api/developers/route.ts` — `GET(req: NextRequest)` → `getHandler(req: NextRequest)`
- `src/app/api/projects/route.ts` — `GET(req: NextRequest)` → `getHandler(req: NextRequest)`
- `src/app/api/projects/untracked/route.ts` — `GET(req: NextRequest)` → `getHandler(req: NextRequest)`
- `src/app/api/auth/me/route.ts` — `GET(req: Request)` → `getHandler(req: Request)`
- `src/app/api/debug/headers/route.ts` — `GET(req: Request)` → `getHandler(req: Request)`

For each file: add `import { withRequestLog } from '@/lib/logger';`, rename the exported function, add `export const GET = withRequestLog(getHandler);` (and POST where applicable).

- [ ] **Step 2: Wrap routes — batch 2 (multi-handler files: report, schedule, teams, settings)**

Files (8 files, 14 handlers):
- `src/app/api/report/route.ts` — `POST(req)` + `GET()` → `postHandler(req)` + `getHandler()`
- `src/app/api/schedule/route.ts` — `GET()` + `POST(req)` → `getHandler()` + `postHandler(req)`
- `src/app/api/schedule/[id]/route.ts` — `PUT(req, ctx)` + `DELETE(req, ctx)` → `putHandler(req, ctx)` + `deleteHandler(req, ctx)`
- `src/app/api/teams/route.ts` — `GET(req)` + `POST(req)` → `getHandler(req)` + `postHandler(req)`
- `src/app/api/teams/[id]/route.ts` — `PUT(req, ctx)` + `DELETE(req, ctx)` → `putHandler(req, ctx)` + `deleteHandler(req, ctx)`
- `src/app/api/settings/user-mappings/route.ts` — `GET(req)` + `PUT(req)` → `getHandler(req)` + `putHandler(req)`
- `src/app/api/settings/github/test-connection/route.ts` — `POST()` → `postHandler()`
- `src/app/api/settings/jira/test-connection/route.ts` — `POST(req)` → `postHandler(req)`

- [ ] **Step 3: Wrap routes — batch 3 (chat and dynamic report routes)**

Files (9 files, 10 handlers):
- `src/app/api/chat/route.ts` — `POST(req)` → `postHandler(req)`
- `src/app/api/report/[id]/route.ts` — `GET(_req, ctx)` + `DELETE(req, ctx)` → `getHandler(_req, ctx)` + `deleteHandler(req, ctx)`
- `src/app/api/report/[id]/commits/route.ts` — `GET(req, ctx)` → `getHandler(req, ctx)`
- `src/app/api/report/[id]/dev/[login]/route.ts` — `GET(_req, ctx)` → `getHandler(_req, ctx)`
- `src/app/api/report/[id]/dev/[login]/summary/route.ts` — `GET(_req, ctx)` → `getHandler(_req, ctx)`
- `src/app/api/report/[id]/jira-issues/route.ts` — `GET(req, ctx)` → `getHandler(req, ctx)`
- `src/app/api/report/[id]/org/route.ts` — `GET(_req, ctx)` → `getHandler(_req, ctx)`
- `src/app/api/report/[id]/progress/route.ts` — `GET(_req, ctx)` → `getHandler(_req, ctx)`
- `src/app/api/report/[id]/resume/route.ts` — `POST(req, ctx)` → `postHandler(req, ctx)`

- [ ] **Step 4: Wrap routes — batch 4 (remaining: stop, projects dynamic)**

Files (5 files, 6 handlers):
- `src/app/api/report/[id]/stop/route.ts` — `POST(req, ctx)` → `postHandler(req, ctx)`
- `src/app/api/projects/[key]/due/route.ts` — `PATCH(req, ctx)` → `patchHandler(req, ctx)`
- `src/app/api/projects/[key]/stats/route.ts` — `GET(_req, ctx)` → `getHandler(_req, ctx)`
- `src/app/api/projects/[key]/status/route.ts` — `GET(_req, ctx)` + `PATCH(req, ctx)` → `getHandler(_req, ctx)` + `patchHandler(req, ctx)`
- `src/app/api/projects/[key]/summary/route.ts` — `GET(_req, ctx)` → `getHandler(_req, ctx)`

- [ ] **Step 5: Run enforcement test to verify all routes are wrapped**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npx jest --testPathPattern="logger-enforcement" -v`

Expected: PASS — all 33 route files now import `withRequestLog`

- [ ] **Step 6: Run full test suite**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npm test`

Expected: All tests pass (446 existing + new logger tests + enforcement test)

- [ ] **Step 7: Commit**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
git add src/app/api/ && \
git commit -m "feat: wrap all 42 API route handlers with withRequestLog"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add logging convention to CLAUDE.md**

Add to the "Key architectural decisions" section:

```markdown
- **API request logging** (`logger.ts`) — opt-in via `LOG_DIR` env var. All API route handlers must be wrapped with `withRequestLog()` from `src/lib/logger.ts`. Writes structured JSON to `requests.log` (all requests) and `errors.log` (4xx/5xx + exceptions). A Jest enforcement test verifies all route files import the wrapper. When `LOG_DIR` is unset, logging is a no-op.
```

Add to the "Gotchas" section:

```markdown
- All API route handlers must be wrapped with `withRequestLog()` — a Jest enforcement test (`logger-enforcement.test.ts`) checks for the import in every `src/app/api/**/route.ts` file. When adding a new API route, wrap every exported handler (GET, POST, PUT, PATCH, DELETE).
- `LOG_DIR` env var enables API request logging — when unset, `withRequestLog` is a no-op. When set, creates the directory on first write. Log rotation is handled by infrastructure, not the app.
```

- [ ] **Step 2: Commit**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
git add CLAUDE.md && \
git commit -m "docs: add API request logging convention to CLAUDE.md"
```

---

### Task 7: Smoke Test — Manual Verification

- [ ] **Step 1: Run full test suite one final time**

Run: `cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && npm test`

Expected: All tests pass.

- [ ] **Step 2: Manual smoke test with dev server**

```bash
cd /Users/maes/Documents/1macmount/code/glooker/api-request-logging && \
LOG_DIR=./logs npm run dev
```

In another terminal:
```bash
curl http://localhost:3000/api/health
cat ./logs/requests.log
```

Verify `requests.log` contains a JSON line with `method: "GET"`, `uri: "/api/health"`, `statusCode: 200`.

- [ ] **Step 3: Test error logging**

```bash
curl http://localhost:3000/api/report/nonexistent-id
cat ./logs/errors.log
```

Verify `errors.log` contains a JSON line with `statusCode: 404` or `500`.

- [ ] **Step 4: Test with LOG_DIR unset**

Restart dev server without `LOG_DIR`:
```bash
npm run dev
```

```bash
curl http://localhost:3000/api/health
```

Verify no `./logs/` directory was created.

- [ ] **Step 5: Stop dev server and clean up**

```bash
rm -rf ./logs
```
