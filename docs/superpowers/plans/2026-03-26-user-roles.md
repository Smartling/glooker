# User Roles (Admin/Viewer) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin/viewer role system derived from Okta group membership in the ALB OIDC JWT, with frontend gating and backend enforcement on mutating APIs.

**Architecture:** `extractUser()` is extended to return `name` and `groups` from JWT. A new `requireAdmin(req)` helper checks group membership against `AUTH_ADMIN_GROUP` env var. The `/api/auth/me` endpoint derives role and returns it. Frontend uses `canAct = !auth.enabled || auth.user?.role === 'admin'` to gate UI. All mutating API routes call `requireAdmin()` as the first line.

**Tech Stack:** Next.js 15 App Router, React context, Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-03-26-user-roles-design.md`

---

## File Structure

**Modified files:**

| File | Change |
|------|--------|
| `src/lib/auth.ts` | Extend `AuthUser` with `name`/`groups`, add `requireAdmin()` |
| `src/lib/__tests__/unit/auth.test.ts` | Tests for `name`, `groups`, `requireAdmin()` |
| `src/app/api/auth/me/route.ts` | Derive role, use JWT name, add role to response |
| `src/lib/__tests__/unit/auth-me.test.ts` | Tests for role derivation |
| `src/app/auth-context.tsx` | Add `role` to AuthUser, export `canAct` helper |
| `src/app/page.tsx` | Gate Run Report, Resume, Stop buttons |
| `src/app/settings/page.tsx` | Gate tabs by role |
| `src/app/profile/profile-content.tsx` | Show role on profile card |
| `src/app/api/report/route.ts` | Guard POST with `requireAdmin()` |
| `src/app/api/report/[id]/route.ts` | Guard DELETE with `requireAdmin()` |
| `src/app/api/report/[id]/resume/route.ts` | Guard POST with `requireAdmin()` |
| `src/app/api/report/[id]/stop/route.ts` | Guard POST with `requireAdmin()` |
| `src/app/api/schedule/route.ts` | Guard POST with `requireAdmin()` |
| `src/app/api/schedule/[id]/route.ts` | Guard PUT, DELETE with `requireAdmin()` |
| `src/app/api/settings/user-mappings/route.ts` | Guard PUT with `requireAdmin()` |
| `src/app/api/settings/jira/test-connection/route.ts` | Guard POST with `requireAdmin()` |
| `src/app/api/teams/route.ts` | Guard POST with `requireAdmin()` |
| `src/app/api/teams/[id]/route.ts` | Guard PUT, DELETE with `requireAdmin()` |
| `src/app/api/llm-config/route.ts` | Guard POST with `requireAdmin()` |
| `docker-compose.yml` | Add `AUTH_ADMIN_GROUP` env var |
| `.env.example` | Document `AUTH_ADMIN_GROUP` |
| `src/lib/env-validation.ts` | Conditional warning for missing `AUTH_ADMIN_GROUP` |
| `CLAUDE.md` | Document role system |

---

### Task 1: Extend `extractUser()` and add `requireAdmin()`

**Files:**
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/__tests__/unit/auth.test.ts`

- [ ] **Step 1: Add tests for `name` and `groups` extraction**

Append these tests to the existing `describe('extractUser')` block in `src/lib/__tests__/unit/auth.test.ts`:

```typescript
  it('extracts name and groups from JWT payload', () => {
    const headers = new Headers({
      'x-amzn-oidc-data': makeJwt({
        email: 'user@example.com', sub: 'abc',
        name: 'Test User',
        groups: ['splunk-admin', 'Everyone'],
      }),
    });
    const result = extractUser(headers);
    expect(result).toEqual({
      email: 'user@example.com', sub: 'abc',
      name: 'Test User', groups: ['splunk-admin', 'Everyone'],
    });
  });

  it('returns null name and empty groups when missing', () => {
    const headers = new Headers({
      'x-amzn-oidc-data': makeJwt({ email: 'a@b.com', sub: '1' }),
    });
    const result = extractUser(headers);
    expect(result?.name).toBeNull();
    expect(result?.groups).toEqual([]);
  });
```

- [ ] **Step 2: Add tests for `requireAdmin()`**

Add a new `describe('requireAdmin')` block after the `extractUser` block. Add the import for `requireAdmin` at the top alongside `extractUser`:

```typescript
import { extractUser, requireAdmin } from '@/lib/auth';
```

```typescript
describe('requireAdmin', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.AUTH_ENABLED = process.env.AUTH_ENABLED;
    savedEnv.AUTH_HEADER = process.env.AUTH_HEADER;
    savedEnv.AUTH_ADMIN_GROUP = process.env.AUTH_ADMIN_GROUP;
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_HEADER = 'x-amzn-oidc-data';
    process.env.AUTH_ADMIN_GROUP = 'splunk-admin';
  });

  afterEach(() => {
    process.env.AUTH_ENABLED = savedEnv.AUTH_ENABLED;
    process.env.AUTH_HEADER = savedEnv.AUTH_HEADER;
    process.env.AUTH_ADMIN_GROUP = savedEnv.AUTH_ADMIN_GROUP;
  });

  function makeReq(payload?: object): Request {
    const headers: Record<string, string> = {};
    if (payload) {
      const h = Buffer.from(JSON.stringify({ alg: 'ES256' })).toString('base64');
      const b = Buffer.from(JSON.stringify(payload)).toString('base64');
      headers['x-amzn-oidc-data'] = `${h}.${b}.sig`;
    }
    return new Request('http://localhost/api/test', { headers });
  }

  it('returns null (allow) when AUTH_ENABLED is false', async () => {
    process.env.AUTH_ENABLED = 'false';
    expect(await requireAdmin(makeReq())).toBeNull();
  });

  it('returns 403 when no JWT header present', async () => {
    const res = await requireAdmin(makeReq());
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns 403 when AUTH_ADMIN_GROUP is empty', async () => {
    process.env.AUTH_ADMIN_GROUP = '';
    const res = await requireAdmin(makeReq({ email: 'a@b.com', sub: '1', groups: ['splunk-admin'] }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns 403 when user not in admin group', async () => {
    const res = await requireAdmin(makeReq({ email: 'a@b.com', sub: '1', groups: ['Everyone'] }));
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns null (allow) when user is in admin group', async () => {
    const res = await requireAdmin(makeReq({ email: 'a@b.com', sub: '1', groups: ['splunk-admin', 'Everyone'] }));
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="auth\.test" --verbose`
Expected: FAIL — `requireAdmin` not exported, `name`/`groups` not in result

- [ ] **Step 4: Update `src/lib/auth.ts`**

Replace the entire file:

```typescript
import { NextResponse } from 'next/server';

export interface AuthUser {
  email: string;
  sub: string;
  name: string | null;
  groups: string[];
}

export function isAuthEnabled(): boolean {
  return process.env.AUTH_ENABLED === 'true';
}

export function extractUser(headers: Headers): AuthUser | null {
  if (!isAuthEnabled()) return null;

  const headerName = process.env.AUTH_HEADER || 'x-amzn-oidc-data';
  const jwt = headers.get(headerName);
  if (!jwt) return null;

  try {
    const parts = jwt.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    if (!payload.email) return null;
    return {
      email: payload.email,
      sub: payload.sub || '',
      name: payload.name || null,
      groups: Array.isArray(payload.groups) ? payload.groups : [],
    };
  } catch {
    return null;
  }
}

export async function requireAdmin(req: Request): Promise<NextResponse | null> {
  if (!isAuthEnabled()) return null;

  const user = extractUser(req.headers);
  if (!user) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  if (!adminGroup) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (user.groups.includes(adminGroup)) {
    return null;
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="auth\.test" --verbose`
Expected: All tests PASS (original 7 + 7 new = 14)

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth.ts src/lib/__tests__/unit/auth.test.ts
git commit -m "feat: extend extractUser with name/groups, add requireAdmin helper"
```

---

### Task 2: Update `/api/auth/me` to return role and use JWT name

**Files:**
- Modify: `src/app/api/auth/me/route.ts`
- Modify: `src/lib/__tests__/unit/auth-me.test.ts`

- [ ] **Step 1: Add tests for role derivation**

Add these tests to the existing `describe('GET /api/auth/me')` block in `src/lib/__tests__/unit/auth-me.test.ts`:

```typescript
  it('returns role admin when user is in admin group', async () => {
    process.env.AUTH_ADMIN_GROUP = 'splunk-admin';
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({
      email: 'admin@smartling.com', sub: '1',
      name: 'Admin User', groups: ['splunk-admin', 'Everyone'],
    });
    mockExecute.mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.user.role).toBe('admin');
    expect(body.user.name).toBe('Admin User');
  });

  it('returns role viewer when user not in admin group', async () => {
    process.env.AUTH_ADMIN_GROUP = 'splunk-admin';
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({
      email: 'viewer@smartling.com', sub: '2',
      name: 'Viewer User', groups: ['Everyone'],
    });
    mockExecute.mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.user.role).toBe('viewer');
  });

  it('returns viewer when AUTH_ADMIN_GROUP is empty', async () => {
    process.env.AUTH_ADMIN_GROUP = '';
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({
      email: 'a@b.com', sub: '1',
      name: null, groups: ['splunk-admin'],
    });
    mockExecute.mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.user.role).toBe('viewer');
  });

  it('uses JWT name over DB name', async () => {
    process.env.AUTH_ADMIN_GROUP = 'admins';
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({
      email: 'dev@smartling.com', sub: '1',
      name: 'JWT Name', groups: [],
    });
    mockExecute
      .mockResolvedValueOnce([[{
        github_login: 'devuser',
        github_name: 'DB Name',
        avatar_url: null,
      }], []])
      .mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.user.name).toBe('JWT Name');
  });
```

**Important:** You must also update the existing tests in this file:
1. Add `AUTH_ADMIN_GROUP` to the env save/restore in `beforeEach`/`afterEach` (set to `''` by default)
2. Update all existing `mockExtractUser.mockReturnValue(...)` calls to include `name: null, groups: []`
3. Update all existing `toEqual` assertions on the response body to include `role: 'viewer'` in the user object (since `AUTH_ADMIN_GROUP` is empty, role will always be `'viewer'` in existing tests)

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npm test -- --testPathPattern="auth-me" --verbose`
Expected: FAIL — `role` not in response

- [ ] **Step 3: Update `src/app/api/auth/me/route.ts`**

Replace the entire file:

```typescript
import { NextResponse } from 'next/server';
import { extractUser, isAuthEnabled } from '@/lib/auth';
import db from '@/lib/db';

export async function GET(req: Request) {
  if (!isAuthEnabled()) {
    return NextResponse.json({ enabled: false });
  }

  const user = extractUser(req.headers);
  if (!user) {
    return NextResponse.json({ enabled: true, user: null });
  }

  // Derive role from group membership
  const adminGroup = process.env.AUTH_ADMIN_GROUP;
  const role = adminGroup && user.groups.includes(adminGroup) ? 'admin' : 'viewer';

  // Look up GitHub identity via jira_email
  const [identityRows] = await db.execute(
    `SELECT um.github_login, ds.github_name, ds.avatar_url
     FROM user_mappings um
     LEFT JOIN developer_stats ds ON ds.github_login = um.github_login
     LEFT JOIN reports r ON r.id = ds.report_id AND r.status = 'completed'
     WHERE um.jira_email = ?
     ORDER BY r.completed_at DESC
     LIMIT 1`,
    [user.email],
  ) as [any[], any];

  if (!identityRows.length) {
    return NextResponse.json({
      enabled: true,
      user: {
        email: user.email,
        githubLogin: null,
        name: user.name,
        avatarUrl: null,
        team: null,
        role,
      },
    });
  }

  const identity = identityRows[0];

  // Look up team
  let team: { name: string; color: string } | null = null;
  if (identity.github_login) {
    const [teamRows] = await db.execute(
      `SELECT t.name AS team_name, t.color AS team_color
       FROM team_members tm
       JOIN teams t ON t.id = tm.team_id
       WHERE tm.github_login = ?
       LIMIT 1`,
      [identity.github_login],
    ) as [any[], any];

    if (teamRows.length) {
      team = { name: teamRows[0].team_name, color: teamRows[0].team_color };
    }
  }

  return NextResponse.json({
    enabled: true,
    user: {
      email: user.email,
      githubLogin: identity.github_login || null,
      name: user.name || identity.github_name || null,
      avatarUrl: identity.avatar_url || null,
      team,
      role,
    },
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="auth-me" --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/auth/me/route.ts src/lib/__tests__/unit/auth-me.test.ts
git commit -m "feat: derive admin/viewer role from JWT groups in /api/auth/me"
```

---

### Task 3: Update AuthContext with role and `canAct` helper

**Files:**
- Modify: `src/app/auth-context.tsx`

- [ ] **Step 1: Update the AuthUser interface and add canAct**

In `src/app/auth-context.tsx`, add `role` to the `AuthUser` interface:

```typescript
interface AuthUser {
  email: string;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  team: { name: string; color: string } | null;
  role: 'admin' | 'viewer';
}
```

Update the `useAuth` export to also provide a convenience helper. Change:

```typescript
export function useAuth() {
  return useContext(AuthContext);
}
```

To:

```typescript
export function useAuth() {
  const ctx = useContext(AuthContext);
  // canAct: true when auth is off (OSS) or user is admin
  const canAct = !ctx.enabled || ctx.user?.role === 'admin';
  return { ...ctx, canAct };
}
```

- [ ] **Step 2: Verify dev server compiles**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001`
Expected: 200

- [ ] **Step 3: Commit**

```bash
git add src/app/auth-context.tsx
git commit -m "feat: add role to AuthContext, export canAct helper"
```

---

### Task 4: Gate frontend UI elements by role

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/settings/page.tsx`
- Modify: `src/app/profile/profile-content.tsx`

- [ ] **Step 1: Gate action buttons on main page**

In `src/app/page.tsx`, the `useAuth()` call already exists (added in the profile feature). Change:

```typescript
const auth = useAuth();
```

To destructure `canAct`:

```typescript
const { canAct, ...auth } = useAuth();
```

Then wrap these elements with `{canAct && (...)}`:

1. **Run Report button** (~line 685): Wrap the `<button>` that says "Run Report" and its containing `<form>` in `{canAct && (...)}`

2. **Resume link** (~line 586): Change `{canResume && (` to `{canAct && canResume && (`

3. **Stop button** (~line 698): Change `{running && (` to `{canAct && running && (`

- [ ] **Step 2: Gate Settings tabs**

In `src/app/settings/page.tsx`, add the import and hook call:

```typescript
import { useAuth } from '../auth-context';
```

Inside `SettingsPage()`, add:

```typescript
const { canAct } = useAuth();
```

Change the tabs array to filter by role. Replace the inline array (lines 66-70):

```typescript
{([
  { id: 'schedules' as Tab, label: 'Schedules', icon: '🕐' },
  { id: 'teams' as Tab, label: 'Teams', icon: '👥' },
  { id: 'app' as Tab, label: 'App Settings', icon: '⚙️' },
  { id: 'appearance' as Tab, label: 'Appearance', icon: '🎨' },
]).map(tab => (
```

With:

```typescript
{([
  { id: 'schedules' as Tab, label: 'Schedules', icon: '🕐', adminOnly: true },
  { id: 'teams' as Tab, label: 'Teams', icon: '👥', adminOnly: true },
  { id: 'app' as Tab, label: 'App Settings', icon: '⚙️', adminOnly: true },
  { id: 'appearance' as Tab, label: 'Appearance', icon: '🎨', adminOnly: false },
]).filter(tab => !tab.adminOnly || canAct).map(tab => (
```

Also set the default `activeTab` to `'appearance'` instead of `'app'` when not admin. The single `useAuth()` call (added above) must come before `useState`. Change:

```typescript
const [activeTab, setActiveTab] = useState<Tab>('app');
```

To:

```typescript
const [activeTab, setActiveTab] = useState<Tab>(canAct ? 'app' : 'appearance');
```

- [ ] **Step 3: Show role on profile page**

In `src/app/profile/profile-content.tsx`, the `useAuth()` hook already provides the user. Add a role row after the team row in the profile card:

```tsx
{auth.user.role && (
  <div className="flex items-center justify-between">
    <span className="text-sm text-gray-500">Role</span>
    <span className="text-sm text-gray-300 capitalize">{auth.user.role}</span>
  </div>
)}
```

Add this inside the `<div className="space-y-4 border-t border-gray-800 pt-6">` block, after the team section.

- [ ] **Step 4: Verify dev server compiles**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3001`
Expected: 200

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/settings/page.tsx src/app/profile/profile-content.tsx
git commit -m "feat: gate UI elements by admin/viewer role"
```

---

### Task 5: Add `requireAdmin()` guards to all mutating API routes

**Files:**
- Modify: 11 API route files (see list below)

Each file needs the same pattern. Add at the top of the mutating handler:

```typescript
import { requireAdmin } from '@/lib/auth';

// Inside the handler function, as the first line:
const denied = await requireAdmin(req);
if (denied) return denied;
```

**Important:** Several handlers use `_req` (underscore = unused parameter) or have no request parameter at all. You must:
- Rename `_req` to `req` in: `report/[id]/route.ts` DELETE, `report/[id]/resume/route.ts` POST, `report/[id]/stop/route.ts` POST, `schedule/[id]/route.ts` DELETE, `teams/[id]/route.ts` DELETE
- Add `req: Request` as the first parameter in: `llm-config/route.ts` POST (currently has no params)

- [ ] **Step 1: Add guards to report routes**

Files and handlers to guard:
- `src/app/api/report/route.ts` → `POST` handler
- `src/app/api/report/[id]/route.ts` → `DELETE` handler (leave `GET` unguarded)
- `src/app/api/report/[id]/resume/route.ts` → `POST` handler
- `src/app/api/report/[id]/stop/route.ts` → `POST` handler

For each file:
1. Add `import { requireAdmin } from '@/lib/auth';` at the top
2. Add `const denied = await requireAdmin(req); if (denied) return denied;` as the first line of the mutating handler

- [ ] **Step 2: Add guards to schedule routes**

- `src/app/api/schedule/route.ts` → `POST` handler
- `src/app/api/schedule/[id]/route.ts` → `PUT` and `DELETE` handlers

Same pattern as Step 1.

- [ ] **Step 3: Add guards to settings and teams routes**

- `src/app/api/settings/user-mappings/route.ts` → `PUT` handler
- `src/app/api/settings/jira/test-connection/route.ts` → `POST` handler
- `src/app/api/teams/route.ts` → `POST` handler
- `src/app/api/teams/[id]/route.ts` → `PUT` and `DELETE` handlers
- `src/app/api/llm-config/route.ts` → `POST` handler

Same pattern as Step 1.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing tests should still pass since mocks don't inject auth headers)

- [ ] **Step 5: Commit**

```bash
git add src/app/api/report/route.ts src/app/api/report/\[id\]/route.ts src/app/api/report/\[id\]/resume/route.ts src/app/api/report/\[id\]/stop/route.ts src/app/api/schedule/route.ts src/app/api/schedule/\[id\]/route.ts src/app/api/settings/user-mappings/route.ts src/app/api/settings/jira/test-connection/route.ts src/app/api/teams/route.ts src/app/api/teams/\[id\]/route.ts src/app/api/llm-config/route.ts
git commit -m "feat: add requireAdmin guard to all mutating API routes"
```

---

### Task 6: Configuration — env vars, validation, docs

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `src/lib/env-validation.ts`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add env var to docker-compose.yml**

After the `AUTH_HEADER` line, add:

```yaml
      AUTH_ADMIN_GROUP: ${AUTH_ADMIN_GROUP:-}
```

- [ ] **Step 2: Add to `.env.example`**

In the Authentication section (after the `AUTH_HEADER` line), add:

```
# Optional — Okta group name that grants admin role (when empty, all users are viewers)
# AUTH_ADMIN_GROUP=splunk-admin
```

- [ ] **Step 3: Add conditional warning to `env-validation.ts`**

Add to the `conditionalRules` array (after the existing `JIRA_ENABLED` block):

```typescript
  {
    when: () => process.env.AUTH_ENABLED === 'true',
    featureLabel: 'AUTH_ENABLED=true',
    vars: [
      { name: 'AUTH_ADMIN_GROUP', description: 'Okta group for admin role (without this, no one can run reports or manage settings)' },
    ],
  },
```

- [ ] **Step 4: Update CLAUDE.md**

Add to the Gotchas section:

```
- `AUTH_ADMIN_GROUP` defines which Okta group grants admin role. When `AUTH_ENABLED=true` but `AUTH_ADMIN_GROUP` is empty, all users are viewers and all mutating APIs return 403. This is a safe default but will block report generation — always set `AUTH_ADMIN_GROUP` alongside `AUTH_ENABLED`.
- Admin/viewer role is derived from JWT `groups` claim on every request — no DB storage. Changing a user's Okta groups takes effect on their next page load.
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example src/lib/env-validation.ts CLAUDE.md
git commit -m "feat: add AUTH_ADMIN_GROUP config, env validation, and docs"
```

---

### Task 7: Integration test — end-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Test with auth disabled (default)**

1. Ensure `AUTH_ENABLED` is NOT set in `.env.local`
2. Visit `http://localhost:3001` — confirm all action buttons visible (OSS mode)
3. Visit `http://localhost:3001/settings` — confirm all 4 tabs visible

- [ ] **Step 3: Test admin role with simulated JWT**

```bash
JWT_PAYLOAD=$(echo -n '{"email":"msogin@smartling.com","sub":"123","name":"Max Sogin","groups":["splunk-admin","Everyone"]}' | base64)
JWT="header.${JWT_PAYLOAD}.signature"

# Test /api/auth/me returns admin role
curl -s -H "x-amzn-oidc-data: $JWT" http://localhost:3001/api/auth/me | jq .user.role
# Expected: "admin"

# Test mutating API is allowed
curl -s -X POST -H "x-amzn-oidc-data: $JWT" -H "Content-Type: application/json" -d '{}' http://localhost:3001/api/report | head -c 200
# Expected: NOT a 403 (may be 400 for missing params, which is fine)
```

Requires `AUTH_ENABLED=true` and `AUTH_ADMIN_GROUP=splunk-admin` in `.env.local`.

- [ ] **Step 4: Test viewer role with simulated JWT**

```bash
JWT_PAYLOAD=$(echo -n '{"email":"viewer@smartling.com","sub":"456","name":"Viewer User","groups":["Everyone"]}' | base64)
JWT="header.${JWT_PAYLOAD}.signature"

# Test /api/auth/me returns viewer role
curl -s -H "x-amzn-oidc-data: $JWT" http://localhost:3001/api/auth/me | jq .user.role
# Expected: "viewer"

# Test mutating API is blocked
curl -s -X POST -H "x-amzn-oidc-data: $JWT" -H "Content-Type: application/json" -d '{}' http://localhost:3001/api/report
# Expected: {"error":"Forbidden"} with status 403
```

- [ ] **Step 5: Clean up `.env.local`**

Remove `AUTH_ENABLED` and `AUTH_ADMIN_GROUP` from `.env.local` if added for testing.
