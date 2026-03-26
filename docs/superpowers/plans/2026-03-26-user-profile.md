# User Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional user profile feature that extracts identity from an ALB OIDC JWT header and displays a profile pill in the header + a `/profile` page.

**Architecture:** Server-side `extractUser()` helper decodes the JWT from request headers. A single `GET /api/auth/me` endpoint looks up the user's GitHub login, avatar, and team from existing tables. A React context caches the result for the session. The feature is gated behind `AUTH_ENABLED=false` (default).

**Tech Stack:** Next.js 15 App Router, React context, MySQL/SQLite (existing DB layer), Jest + ts-jest

**Spec:** `docs/superpowers/specs/2026-03-26-user-profile-design.md`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/auth.ts` | `extractUser(req)` — parse JWT from header, return `{ email, sub }` or `null` |
| `src/app/api/auth/me/route.ts` | GET endpoint — call `extractUser`, query DB, return profile JSON |
| `src/app/auth-context.tsx` | `AuthProvider` + `useAuth()` hook — fetch `/api/auth/me` once, cache in context |
| `src/app/profile/page.tsx` | Profile page — server component guard with `notFound()` + client component for content |
| `src/app/profile/profile-content.tsx` | Client component — profile card UI using `useAuth()` |
| `src/lib/__tests__/unit/auth.test.ts` | Tests for `extractUser()` |
| `src/lib/__tests__/unit/auth-me.test.ts` | Tests for `/api/auth/me` endpoint logic |

**Existing files modified:**

| File | Change |
|------|--------|
| `src/app/layout.tsx` | Wrap children with `AuthProvider` |
| `src/app/page.tsx:372-387` | Add profile pill right of Settings button |
| `docker-compose.yml:38` | Add `AUTH_ENABLED`, `AUTH_HEADER` env vars after Jira block |
| `.env.example` | Document new env vars |
| `src/lib/env-validation.ts:20-58` | Add `AUTH_ENABLED` to `rules` array |
| `CLAUDE.md` | Document feature |

---

### Task 1: `extractUser()` helper with tests

**Files:**
- Create: `src/lib/auth.ts`
- Create: `src/lib/__tests__/unit/auth.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// src/lib/__tests__/unit/auth.test.ts
import { extractUser } from '@/lib/auth';

function makeJwt(payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.fakesignature`;
}

describe('extractUser', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.AUTH_ENABLED = process.env.AUTH_ENABLED;
    savedEnv.AUTH_HEADER = process.env.AUTH_HEADER;
    process.env.AUTH_ENABLED = 'true';
    process.env.AUTH_HEADER = 'x-amzn-oidc-data';
  });

  afterEach(() => {
    process.env.AUTH_ENABLED = savedEnv.AUTH_ENABLED;
    process.env.AUTH_HEADER = savedEnv.AUTH_HEADER;
  });

  it('returns null when AUTH_ENABLED is not true', () => {
    process.env.AUTH_ENABLED = 'false';
    const headers = new Headers({ 'x-amzn-oidc-data': makeJwt({ email: 'a@b.com', sub: '123' }) });
    expect(extractUser(headers)).toBeNull();
  });

  it('extracts email and sub from valid JWT', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': makeJwt({ email: 'user@example.com', sub: 'abc123' }) });
    expect(extractUser(headers)).toEqual({ email: 'user@example.com', sub: 'abc123' });
  });

  it('returns null when header is missing', () => {
    const headers = new Headers();
    expect(extractUser(headers)).toBeNull();
  });

  it('returns null for malformed JWT (no dots)', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': 'notajwt' });
    expect(extractUser(headers)).toBeNull();
  });

  it('returns null for invalid base64', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': 'a.!!!invalid!!!.c' });
    expect(extractUser(headers)).toBeNull();
  });

  it('returns null when payload has no email', () => {
    const headers = new Headers({ 'x-amzn-oidc-data': makeJwt({ sub: '123' }) });
    expect(extractUser(headers)).toBeNull();
  });

  it('uses custom header name from AUTH_HEADER', () => {
    process.env.AUTH_HEADER = 'x-custom-auth';
    const headers = new Headers({ 'x-custom-auth': makeJwt({ email: 'a@b.com', sub: '1' }) });
    expect(extractUser(headers)).toEqual({ email: 'a@b.com', sub: '1' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="auth\.test" --verbose`
Expected: FAIL — `Cannot find module '@/lib/auth'`

- [ ] **Step 3: Implement `extractUser`**

```typescript
// src/lib/auth.ts
export interface AuthUser {
  email: string;
  sub: string;
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
    return { email: payload.email, sub: payload.sub || '' };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --testPathPattern="auth\.test" --verbose`
Expected: All 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth.ts src/lib/__tests__/unit/auth.test.ts
git commit -m "feat: add extractUser helper for ALB OIDC JWT parsing"
```

---

### Task 2: `/api/auth/me` endpoint with tests

**Files:**
- Create: `src/app/api/auth/me/route.ts`
- Create: `src/lib/__tests__/unit/auth-me.test.ts`

- [ ] **Step 1: Write the tests**

```typescript
// src/lib/__tests__/unit/auth-me.test.ts
jest.mock('@/lib/db', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
}));
jest.mock('@/lib/auth');

import db from '@/lib/db';
import { isAuthEnabled, extractUser } from '@/lib/auth';
import { GET } from '@/app/api/auth/me/route';

const mockExecute = db.execute as jest.Mock;
const mockIsAuthEnabled = isAuthEnabled as jest.Mock;
const mockExtractUser = extractUser as jest.Mock;

function makeRequest(headers?: Record<string, string>): Request {
  return new Request('http://localhost:3000/api/auth/me', {
    headers: headers ? new Headers(headers) : new Headers(),
  });
}

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns { enabled: false } when auth is disabled', async () => {
    mockIsAuthEnabled.mockReturnValue(false);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ enabled: false });
    expect(mockExtractUser).not.toHaveBeenCalled();
  });

  it('returns { enabled: true, user: null } when no JWT header', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue(null);
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({ enabled: true, user: null });
  });

  it('returns full profile when email matches user_mappings', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({ email: 'msogin@smartling.com', sub: '123' });
    mockExecute
      .mockResolvedValueOnce([[{
        github_login: 'msogin',
        github_name: 'Max Sogin',
        avatar_url: 'https://avatars.githubusercontent.com/u/123',
      }], []])
      .mockResolvedValueOnce([[{
        team_name: 'Platform',
        team_color: '#3B82F6',
      }], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      user: {
        email: 'msogin@smartling.com',
        githubLogin: 'msogin',
        name: 'Max Sogin',
        avatarUrl: 'https://avatars.githubusercontent.com/u/123',
        team: { name: 'Platform', color: '#3B82F6' },
      },
    });
  });

  it('returns email-only user when no user_mappings match', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({ email: 'unknown@example.com', sub: '456' });
    mockExecute.mockResolvedValueOnce([[], []]);

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body).toEqual({
      enabled: true,
      user: {
        email: 'unknown@example.com',
        githubLogin: null,
        name: null,
        avatarUrl: null,
        team: null,
      },
    });
    // Only one DB call (identity lookup), no team lookup
    expect(mockExecute).toHaveBeenCalledTimes(1);
  });

  it('returns user without team when no team_members match', async () => {
    mockIsAuthEnabled.mockReturnValue(true);
    mockExtractUser.mockReturnValue({ email: 'dev@smartling.com', sub: '789' });
    mockExecute
      .mockResolvedValueOnce([[{
        github_login: 'devuser',
        github_name: 'Dev User',
        avatar_url: null,
      }], []])
      .mockResolvedValueOnce([[], []]); // no team

    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.user.githubLogin).toBe('devuser');
    expect(body.user.team).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --testPathPattern="auth-me" --verbose`
Expected: FAIL (tests should run but verify mocking works)

- [ ] **Step 3: Implement the endpoint**

```typescript
// src/app/api/auth/me/route.ts
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
      user: { email: user.email, githubLogin: null, name: null, avatarUrl: null, team: null },
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
      name: identity.github_name || null,
      avatarUrl: identity.avatar_url || null,
      team,
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
git commit -m "feat: add /api/auth/me endpoint for user profile lookup"
```

---

### Task 3: AuthProvider context + useAuth hook

**Files:**
- Create: `src/app/auth-context.tsx`
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Create AuthProvider**

```typescript
// src/app/auth-context.tsx
'use client';

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

interface AuthUser {
  email: string;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  team: { name: string; color: string } | null;
}

interface AuthContextType {
  enabled: boolean;
  user: AuthUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
  enabled: false,
  user: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthContextType>({
    enabled: false,
    user: null,
    loading: true,
  });

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        setState({
          enabled: data.enabled ?? false,
          user: data.user ?? null,
          loading: false,
        });
      })
      .catch(() => {
        setState({ enabled: false, user: null, loading: false });
      });
  }, []);

  return (
    <AuthContext.Provider value={state}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
```

- [ ] **Step 2: Wrap layout with AuthProvider**

In `src/app/layout.tsx`, add the import and wrap children:

```typescript
import { AuthProvider } from './auth-context';

// In the return, wrap inside ThemeProvider:
<ThemeProvider>
  <AuthProvider>
    {children}
  </AuthProvider>
</ThemeProvider>
```

- [ ] **Step 3: Verify dev server compiles**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: 200 (no compile errors)

- [ ] **Step 4: Commit**

```bash
git add src/app/auth-context.tsx src/app/layout.tsx
git commit -m "feat: add AuthProvider context with useAuth hook"
```

---

### Task 4: Profile pill in main page header

**Files:**
- Modify: `src/app/page.tsx:372-387`

- [ ] **Step 1: Add profile pill to header**

In `src/app/page.tsx`, add the `useAuth` import at the top with other imports:

```typescript
import { useAuth } from './auth-context';
```

Inside the component function, add:

```typescript
const auth = useAuth();
```

Replace the header `<div>` that contains the Settings button (lines 372-387). Change it from a single Settings button to a flex container with Settings + profile pill:

```tsx
<div className="mb-8 flex items-center justify-between">
  <div>
    <h1 className="text-3xl font-bold tracking-tight text-white cursor-pointer hover:text-accent-light transition-colors" onClick={() => { setActiveReport(null); setDevelopers([]); setProgress(null); setRunning(false); stopPolling(); }}>Glooker</h1>
    <p className="text-gray-400 mt-1">GitHub org developer impact analytics</p>
  </div>
  <div className="flex items-center gap-2.5">
    <button
      onClick={() => window.location.href = '/settings'}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-300 bg-gray-900 hover:bg-gray-800 rounded-lg border border-gray-800 transition-colors"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      Settings
    </button>
    {auth.enabled && auth.user && !auth.loading && (
      <a
        href="/profile"
        className="flex items-center gap-2 pl-1 pr-3 py-1 bg-gray-900 hover:bg-gray-800 rounded-full border border-gray-800 transition-colors"
      >
        {auth.user.avatarUrl ? (
          <img src={auth.user.avatarUrl} alt="" className="w-7 h-7 rounded-full border-2 border-gray-700" />
        ) : (
          <div className="w-7 h-7 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
            {(auth.user.name || auth.user.email)[0].toUpperCase()}
          </div>
        )}
        <span className="text-xs font-medium text-gray-300">
          {auth.user.githubLogin || auth.user.email}
        </span>
      </a>
    )}
  </div>
</div>
```

- [ ] **Step 2: Verify dev server compiles and pill is hidden (AUTH_ENABLED is not set)**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`
Expected: 200

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add profile pill to main page header"
```

---

### Task 5: `/profile` page

**Files:**
- Create: `src/app/profile/page.tsx` (server component — feature flag guard)
- Create: `src/app/profile/profile-content.tsx` (client component — UI)

- [ ] **Step 1: Create the server component wrapper**

```typescript
// src/app/profile/page.tsx
import { notFound } from 'next/navigation';
import ProfileContent from './profile-content';

export default function ProfilePage() {
  if (process.env.AUTH_ENABLED !== 'true') {
    notFound();
  }
  return <ProfileContent />;
}
```

- [ ] **Step 2: Create the client component**

```typescript
// src/app/profile/profile-content.tsx
'use client';

import { useAuth } from '../auth-context';
import { useRouter } from 'next/navigation';

export default function ProfileContent() {
  const auth = useAuth();
  const router = useRouter();

  if (auth.loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="animate-pulse bg-gray-900 rounded-xl p-8 h-48" />
      </div>
    );
  }

  if (!auth.user) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center text-gray-500">
        No user identity found.
      </div>
    );
  }

  const user = auth.user;

  return (
    <div className="max-w-2xl mx-auto px-4 py-16">
      <button
        onClick={() => router.push('/')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-300 mb-8 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div className="bg-gray-900 rounded-xl p-8 border border-gray-800">
        <div className="flex items-center gap-5 mb-6">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="w-20 h-20 rounded-full border-2 border-gray-700" />
          ) : (
            <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-2xl text-gray-400">
              {(user.name || user.email)[0].toUpperCase()}
            </div>
          )}
          <div>
            {user.name && <h1 className="text-xl font-bold text-white">{user.name}</h1>}
            <p className="text-gray-400">{user.email}</p>
          </div>
        </div>

        <div className="space-y-4 border-t border-gray-800 pt-6">
          {user.githubLogin && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">GitHub</span>
              <span className="text-sm text-gray-300">{user.githubLogin}</span>
            </div>
          )}
          {user.team && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500">Team</span>
              <span className="text-sm text-gray-300 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: user.team.color }} />
                {user.team.name}
              </span>
            </div>
          )}
        </div>

        <p className="text-xs text-gray-600 mt-8">
          Identity provided by your organization&apos;s identity provider
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify page returns 404 when auth disabled**

Run: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/profile`
Expected: 404 (since `AUTH_ENABLED` is not set)

- [ ] **Step 4: Commit**

```bash
git add src/app/profile/page.tsx src/app/profile/profile-content.tsx
git commit -m "feat: add /profile page for authenticated users"
```

---

### Task 6: Configuration — env vars, validation, docs

**Files:**
- Modify: `docker-compose.yml:40`
- Modify: `.env.example`
- Modify: `src/lib/env-validation.ts:63-96`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add env vars to docker-compose.yml**

After the `JIRA_STORY_POINTS_FIELDS` line, add:

```yaml
      # Auth (optional — for ALB OIDC deployments)
      AUTH_ENABLED: ${AUTH_ENABLED:-}
      AUTH_HEADER: ${AUTH_HEADER:-x-amzn-oidc-data}
```

- [ ] **Step 2: Add env vars to `.env.example`**

Add a new section after the Jira block:

```
# -----------------------------------------------------------------------------
# Authentication (optional — for ALB OIDC deployments)
# -----------------------------------------------------------------------------
# Optional (default: false) — Enable user identity extraction from ALB OIDC header
# AUTH_ENABLED=false
# Optional (default: x-amzn-oidc-data) — Header name containing the OIDC JWT
# AUTH_HEADER=x-amzn-oidc-data
```

- [ ] **Step 3: Add validation to `env-validation.ts`**

Add `AUTH_ENABLED` as an optional rule with boolean validation to the `rules` array (after the `LLM_CONCURRENCY` entry, around line 57):

```typescript
  {
    name: 'AUTH_ENABLED',
    required: false,
    description: 'Enable user profile via ALB OIDC (true/false)',
    validate: (v) =>
      ['true', 'false'].includes(v)
        ? null
        : 'must be true or false',
  },
```

Note: `AUTH_HEADER` is not validated — it has a sensible default (`x-amzn-oidc-data`) in `auth.ts` and warning on absence would be spurious.

- [ ] **Step 4: Add to CLAUDE.md**

In the Gotchas section, add:

```
- `AUTH_ENABLED=true` enables user profile feature — extracts identity from ALB OIDC JWT header (`x-amzn-oidc-data` by default). Requires `user_mappings` table populated (via Jira auto-discovery) for full GitHub profile linking. Off by default — zero impact when disabled.
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example src/lib/env-validation.ts CLAUDE.md
git commit -m "feat: add AUTH_ENABLED config, env validation, and docs"
```

---

### Task 7: Integration test — end-to-end manual verification

- [ ] **Step 1: Test with auth disabled (default)**

1. Ensure `AUTH_ENABLED` is NOT set in `.env.local`
2. Run dev server: `npm run dev`
3. Visit `http://localhost:3000` — confirm no profile pill visible
4. Visit `http://localhost:3000/profile` — confirm it returns 404
5. Fetch `http://localhost:3000/api/auth/me` — confirm `{ "enabled": false }`

- [ ] **Step 2: Test with auth enabled (simulated)**

1. Set `AUTH_ENABLED=true` in `.env.local`
2. Restart dev server
3. Fetch `/api/auth/me` — confirm `{ "enabled": true, "user": null }` (no JWT header in local dev)
4. Test with a fake JWT header using curl:

```bash
JWT_PAYLOAD=$(echo -n '{"email":"msogin@smartling.com","sub":"test123"}' | base64)
JWT="header.${JWT_PAYLOAD}.signature"
curl -s -H "x-amzn-oidc-data: $JWT" http://localhost:3001/api/auth/me | jq .
```

Expected: response with `githubLogin: "msogin"`, `avatarUrl`, and `team` data (if user_mappings and teams exist in the local DB)

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass (existing + new)

- [ ] **Step 4: Remove `AUTH_ENABLED` from `.env.local`**

Clean up — don't leave auth enabled in local dev config.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A && git commit -m "fix: integration test fixups for user profile"
```

Only if there were issues found during manual testing. Skip if everything passed.
