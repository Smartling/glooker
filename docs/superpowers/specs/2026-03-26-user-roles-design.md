# User Roles (Admin/Viewer) — Design Spec

## Problem

Glooker's user profile feature (`AUTH_ENABLED`) extracts identity from ALB OIDC JWT but has no role system. All authenticated users can perform all actions. We need admin/viewer roles so that only admins can run reports, manage schedules, and change settings — while viewers get full read access.

## Scope

- Derive role from Okta group membership in the JWT `groups` claim
- Admin group configurable via `AUTH_ADMIN_GROUP` env var
- Frontend: hide action buttons for viewers, gate Settings tabs
- Backend: 403 on mutating APIs for non-admins
- Show role on `/profile` page
- Use JWT `name` field directly (instead of DB lookup)

### Out of scope

- Multiple admin groups (single group for now)
- Custom roles beyond admin/viewer
- Per-report or per-team permissions

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `AUTH_ADMIN_GROUP` | `""` (empty) | Okta group name that grants admin role. When empty, all users are viewers. |

Existing env vars unchanged: `AUTH_ENABLED`, `AUTH_HEADER`.

When `AUTH_ENABLED=false`: no auth, no roles, everything visible — identical to current OSS behavior.

**Deployment gotcha:** If `AUTH_ENABLED=true` but `AUTH_ADMIN_GROUP` is not set or empty, **no one is admin** — all mutating APIs return 403 for everyone. This is a safe default but will be confusing if the operator forgets to set `AUTH_ADMIN_GROUP`. The startup env validation should warn about this.

## Data Flow

```
ALB injects x-amzn-oidc-data JWT
    ↓
extractUser(headers) → { email, sub, name, groups }
    ↓
/api/auth/me: groups.includes(AUTH_ADMIN_GROUP) → role = 'admin' | 'viewer'
    ↓
Response: { enabled, user: { email, name, githubLogin, avatarUrl, team, role } }
    ↓
AuthProvider caches → useAuth().user.role
```

No DB changes. No new tables. Role is derived on every `/api/auth/me` call from JWT + env var.

## JWT Payload (relevant fields)

```json
{
  "sub": "00u155nxlsbVlBy1j2p7",
  "email": "dpavlov@smartling.com",
  "name": "Dmitriy Pavlov",
  "groups": ["splunk-admin", "1 IT Ops", "Everyone", ...],
  "exp": 1774553657
}
```

## Changes to `extractUser()`

Currently returns `{ email, sub }`. Updated to return:

```typescript
interface AuthUser {
  email: string;
  sub: string;
  name: string | null;
  groups: string[];
}
```

All errors still return `null`. Missing `name` → `null`. Missing `groups` → `[]`.

## Changes to `GET /api/auth/me`

1. Extract `name` and `groups` from `extractUser()` result
2. Derive role: `user.groups.includes(process.env.AUTH_ADMIN_GROUP || '') ? 'admin' : 'viewer'`
   - When `AUTH_ADMIN_GROUP` is empty string, `includes('')` is always true — but we guard: if `AUTH_ADMIN_GROUP` is not set or empty, role is `'viewer'` for everyone
3. Use JWT `name` as primary name source, fall back to `developer_stats.github_name` only if JWT name is empty
4. Add `role` to response:

```json
{
  "enabled": true,
  "user": {
    "email": "dpavlov@smartling.com",
    "name": "Dmitriy Pavlov",
    "githubLogin": "dpavlov-smartling",
    "avatarUrl": "https://...",
    "team": { "name": "Platform", "color": "#3B82F6" },
    "role": "admin"
  }
}
```

## Backend Enforcement: `requireAdmin(req)`

New helper in `src/lib/auth.ts`:

```typescript
function requireAdmin(req: Request): NextResponse | null
```

Logic:
1. If `AUTH_ENABLED` is not `true` → return `null` (allow — no auth means no restrictions)
2. Call `extractUser(req.headers)` → if `null`, return 403
3. If `AUTH_ADMIN_GROUP` is not set or empty → return 403 (no admin group configured = no one is admin)
4. If `groups.includes(AUTH_ADMIN_GROUP)` → return `null` (allow)
5. Otherwise → return `NextResponse.json({ error: 'Forbidden' }, { status: 403 })`

### Protected APIs (require admin)

| Method | Endpoint | Action |
|--------|----------|--------|
| POST | `/api/report` | Start new report |
| DELETE | `/api/report/[id]` | Delete report |
| POST | `/api/report/[id]/resume` | Resume report |
| POST | `/api/report/[id]/stop` | Stop report |
| POST | `/api/schedule` | Create schedule |
| PUT | `/api/schedule/[id]` | Update schedule |
| DELETE | `/api/schedule/[id]` | Delete schedule |
| PUT | `/api/settings/user-mappings` | Update user mappings |
| POST | `/api/settings/jira/test-connection` | Test Jira connection |
| POST | `/api/teams` | Create team |
| PUT | `/api/teams/[id]` | Update team |
| DELETE | `/api/teams/[id]` | Delete team |
| POST | `/api/llm-config` | Test LLM connection |

### Unprotected APIs (no role check)

All GET endpoints, `GET /api/auth/me`, `GET /api/health`, `POST /api/chat` (read-only Q&A about reports — uses LLM but doesn't mutate data).

### Note on org report page

The org report page (`report/[id]/org/page.tsx`) was checked — it has no action buttons, only data display. No gating needed there.

## Frontend Enforcement

### AuthContext update

`AuthUser` interface gains `role: 'admin' | 'viewer'`. Helper:

```typescript
// In auth-context.tsx
const isAdmin = auth.enabled && auth.user?.role === 'admin';
```

When `AUTH_ENABLED=false`: `auth.enabled` is `false`, so `isAdmin` is `false`, but since auth is disabled the conditional rendering pattern is:

```typescript
// Show action when: auth is off (OSS mode) OR user is admin
const canAct = !auth.enabled || auth.user?.role === 'admin';
```

This ensures OSS users (no auth) see everything, while authenticated viewers see restricted UI.

### Main page (`page.tsx`)

Hidden for viewers (shown for admins and when auth is off):
- "Run Report" / "Generate" button
- "Resume" button on stopped reports
- "Stop" button on running reports

### Settings page (`settings/page.tsx`)

- **Appearance tab** → always visible (themes are per-browser)
- **LLM Config tab** → admin only
- **Jira tab** → admin only
- **Teams tab** → admin only
- **Schedules tab** → admin only

When a viewer visits `/settings`, they see only the Appearance tab. No "access denied" message — just fewer tabs.

### Profile page (`profile/profile-content.tsx`)

Add a row to the profile card:
```
Role        Admin
```
or
```
Role        Viewer
```

## Files to Create

None — all changes modify existing files.

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/auth.ts` | Extend `AuthUser` with `name`/`groups`, add `requireAdmin()`, update `extractUser()` |
| `src/lib/__tests__/unit/auth.test.ts` | Add tests for `groups`, `name` extraction, `requireAdmin()` |
| `src/app/api/auth/me/route.ts` | Derive role from groups, use JWT name, add role to response |
| `src/lib/__tests__/unit/auth-me.test.ts` | Add tests for role derivation |
| `src/app/auth-context.tsx` | Add `role` to `AuthUser` interface |
| `src/app/page.tsx` | Gate action buttons with `canAct` |
| `src/app/settings/page.tsx` | Gate tabs by role |
| `src/app/profile/profile-content.tsx` | Show role on profile card |
| `src/app/api/report/route.ts` | Add `requireAdmin()` guard to POST |
| `src/app/api/report/[id]/route.ts` | Add `requireAdmin()` guard to DELETE |
| `src/app/api/report/[id]/resume/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/report/[id]/stop/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/schedule/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/schedule/[id]/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/settings/user-mappings/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/settings/jira/test-connection/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/teams/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/teams/[id]/route.ts` | Add `requireAdmin()` guard |
| `src/app/api/llm-config/route.ts` | Add `requireAdmin()` guard |
| `docker-compose.yml` | Add `AUTH_ADMIN_GROUP` env var |
| `.env.example` | Document `AUTH_ADMIN_GROUP` |
| `src/lib/env-validation.ts` | Add conditional warning: warn if `AUTH_ENABLED=true` but `AUTH_ADMIN_GROUP` is empty |
| `CLAUDE.md` | Document role system |

## Schema Changes

None.

## Testing

### Unit tests

- `extractUser()`: valid JWT with groups/name returns all fields; missing groups returns `[]`; missing name returns `null`
- `requireAdmin()`: returns `null` when `AUTH_ENABLED=false`; returns 403 when no admin group configured; returns 403 when user not in admin group; returns `null` when user is in admin group
- `/api/auth/me`: returns correct role for admin/viewer; uses JWT name over DB name; returns `'viewer'` when `AUTH_ADMIN_GROUP` is empty

### Manual verification

- Auth off: all actions visible, no role checks
- Auth on, admin user: all actions visible, role shows "Admin" on profile
- Auth on, viewer user: action buttons hidden, Settings shows only Appearance, mutating APIs return 403
