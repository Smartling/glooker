# User Profile Page — Design Spec

## Problem

Glooker runs without authentication by default. For Smartling's internal deployment, the ALB injects an OIDC JWT (`x-amzn-oidc-data` header) after Okta login. We want to use this identity to show a user profile — without breaking the default no-auth experience for OSS users.

## Scope

- Optional feature, off by default (`AUTH_ENABLED=false`)
- Extract user identity from ALB OIDC JWT header
- Profile pill in header (avatar + name, right of Settings button)
- `/profile` page showing user info
- Read-only — no new DB tables, no DB writes

### Out of scope

- Role/permissions system (future project)
- App-level login/logout (ALB handles this)
- User management UI
- JWT signature verification (ALB is trusted; traffic can't reach the app without it)

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `AUTH_ENABLED` | `false` | Enable user identity extraction |
| `AUTH_HEADER` | `x-amzn-oidc-data` | Request header containing the OIDC JWT |

`AUTH_HEADER` is only relevant when `AUTH_ENABLED=true`. Env validation follows the conditional pattern used by `JIRA_ENABLED` — warn if `AUTH_ENABLED=true` but `AUTH_HEADER` is unset (though the default is sensible so this is unlikely).

When `AUTH_ENABLED=false`: no JWT extraction, no profile pill, `/api/auth/me` returns `{ enabled: false }`, `/profile` calls `notFound()` from `next/navigation` (renders the standard Next.js 404 page — the page file exists but guards on the feature flag at runtime).

## Data Flow

```
Browser → ALB (injects x-amzn-oidc-data JWT) → Next.js server
```

### JWT payload (from ALB)

```json
{
  "sub": "00u155nxlsbVlBy1j2p7",
  "email": "dpavlov@smartling.com",
  "email_verified": true,
  "exp": 1774552447,
  "iss": "https://smartling-login.okta.com"
}
```

### `extractUser(req)` helper

Reads the configured header, splits on `.`, base64-decodes the second segment, and parses JSON. **All errors are caught and return `null`** — malformed JWTs, missing segments, invalid base64, unparseable JSON. No throwing. Returns `{ email: string, sub: string } | null`.

### `GET /api/auth/me`

1. If `AUTH_ENABLED` is not `true`, return `{ enabled: false }`
2. Call `extractUser(req)` — if `null`, return `{ enabled: true, user: null }`
3. Extract `email` from the result
4. Look up user data from existing tables using two queries:

**Query 1 — user identity (from user_mappings + latest developer_stats):**

```sql
SELECT
  um.github_login,
  ds.github_name,
  ds.avatar_url
FROM user_mappings um
LEFT JOIN developer_stats ds
  ON ds.github_login = um.github_login
LEFT JOIN reports r
  ON r.id = ds.report_id AND r.status = 'completed'
WHERE um.jira_email = ?
ORDER BY r.completed_at DESC
LIMIT 1
```

**Query 2 — team (separate query to avoid cross-join issues):**

```sql
SELECT t.name AS team_name, t.color AS team_color
FROM team_members tm
JOIN teams t ON t.id = tm.team_id
WHERE tm.github_login = ?
LIMIT 1
```

The `github_login` for query 2 comes from query 1's result (skip if query 1 returned no match).

5. Return response:

```json
{
  "enabled": true,
  "user": {
    "email": "dpavlov@smartling.com",
    "githubLogin": "dpavlov-smartling",
    "name": "Dmitry Pavlov",
    "avatarUrl": "https://avatars.githubusercontent.com/u/...",
    "team": { "name": "Platform", "color": "#3B82F6" }
  }
}
```

If no `user_mappings` match is found, return with email only:

```json
{
  "enabled": true,
  "user": {
    "email": "dpavlov@smartling.com",
    "githubLogin": null,
    "name": null,
    "avatarUrl": null,
    "team": null
  }
}
```

If no JWT header is present (shouldn't happen behind ALB, but defensive):

```json
{
  "enabled": true,
  "user": null
}
```

### Limitations

- **Requires Jira integration for full profile.** The email→GitHub link depends on `user_mappings`, which is populated by the Jira auto-discovery feature. Users without a `user_mappings` row (Jira disabled, or email not matched) will see email only — no avatar, no GitHub login, no team.
- **`jira_email` is nullable.** If a `user_mappings` row exists but `jira_email` is NULL, the lookup will miss it. This is an edge case — the auto-discovery flow always populates `jira_email`.
- **Multi-org.** If the same email appears in `user_mappings` for multiple orgs, the query returns the first match. This is acceptable — avatar and name are the same regardless of org. The query does not filter by org.
- **No server-side caching.** Each page load that triggers the frontend `useAuth()` fetch hits the DB. This is acceptable — the query is lightweight (indexed lookups, LIMIT 1) and the app is single-user / low-traffic.

## Frontend

### AuthProvider (React context)

- Wraps the app in `layout.tsx` (inside `ThemeProvider`)
- Calls `GET /api/auth/me` once on mount
- Provides `useAuth()` hook returning `{ enabled: boolean, user: User | null, loading: boolean }`
- No refetching — cached for the session lifetime, refreshes on full page reload

### Profile pill (header)

- Renders to the right of the Settings button
- Shows GitHub avatar (28px circle) + GitHub login as text, or email as fallback if no GitHub link
- Clicking navigates to `/profile`
- Hidden when `enabled` is `false` or `loading` is `true`
- Only appears on the main page (`page.tsx`) which has the Settings button. The report sub-pages (`report/[id]/org/page.tsx`, `report/[id]/dev/[login]/page.tsx`) have a minimal "Back / Glooker" nav without Settings — no pill there.

### `/profile` page

Simple card showing:
- Avatar (large)
- Email address
- GitHub login (if linked)
- Team name + color badge (if assigned)
- Subtle note: "Identity provided by your organization's identity provider"

When `AUTH_ENABLED=false`: the page uses a server component wrapper that reads `process.env.AUTH_ENABLED` directly and calls `notFound()` from `next/navigation`, producing the standard 404. The profile content itself is a client component rendered inside the server wrapper.

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/auth.ts` | `extractUser(req)` helper — reads env vars, parses JWT payload, catches all errors, returns `{ email, sub }` or `null` |
| `src/app/api/auth/me/route.ts` | GET endpoint — calls `extractUser`, queries existing tables, returns profile |
| `src/app/auth-context.tsx` | `AuthProvider` context + `useAuth()` hook |
| `src/app/profile/page.tsx` | Profile page component (guards with `notFound()` when auth disabled) |

## Files to Modify

| File | Change |
|------|--------|
| `src/app/layout.tsx` | Wrap children with `AuthProvider` |
| `src/app/page.tsx` | Add profile pill to header (right of Settings button) |
| `docker-compose.yml` | Add `AUTH_ENABLED`, `AUTH_HEADER` env vars |
| `.env.example` | Document new env vars |
| `src/lib/env-validation.ts` | Add conditional validation (same pattern as `JIRA_ENABLED`) |
| `CLAUDE.md` | Document the feature |

## Schema Changes

None. All data comes from existing tables (`user_mappings`, `developer_stats`, `team_members`, `teams`).

## Testing

- Unit test for `extractUser()` — valid JWT returns `{ email, sub }`, missing header returns `null`, malformed JWT (bad base64, missing segments, invalid JSON) returns `null`
- Unit test for `/api/auth/me` — `AUTH_ENABLED=false` returns `{ enabled: false }`, enabled + valid JWT + email found returns full profile, enabled + email not in mappings returns email-only user, enabled + no header returns `{ enabled: true, user: null }`
- Manual verification: toggle `AUTH_ENABLED`, confirm pill appears/disappears, confirm `/profile` shows 404 when disabled
