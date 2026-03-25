# Jira Story Points Fields — Configurable via Env Var

**Date:** 2026-03-25
**Branch:** jira-data-follow-ups

## Problem

`searchDoneIssues` in `src/lib/jira/client.ts` hardcodes two field IDs (`story_points`, `customfield_10016`) when fetching and mapping story points from Jira. Story points field IDs are instance-specific — there is no universal field ID across Jira deployments. The hardcoded values will silently return `null` for any instance that uses a different custom field.

## Solution

Add a `JIRA_STORY_POINTS_FIELDS` environment variable: a comma-separated list of Jira field IDs the operator has identified as story points fields in their instance. Default is empty (no story points collected). This is intentional — silently guessing wrong field IDs is worse than returning `null`.

## Field ID vs Key

The Jira `/rest/api/3/field` endpoint returns both `id` and `key`. For custom fields these are identical (e.g. `customfield_10016`). The Jira search API (`/search/jql`) accepts field IDs in the `fields` array. The env var stores field IDs.

**How to discover:** `GET https://<host>/rest/api/3/field` — filter results where `name` contains "story" or "point". Use the `id` value of matching fields.

## Changes

### 1. `src/lib/jira/client.ts`

- Add `storyPointsFields: string[]` parameter to `searchDoneIssues`
- Remove hardcoded `story_points` and `customfield_10016` from the `fields` array
- Spread `storyPointsFields` into the `fields` array instead
- In the response mapping, iterate `storyPointsFields` and return the first non-null numeric value as `storyPoints`

### 2. `src/lib/app-config/service.ts`

Add to the `jira` config block:

```ts
storyPointsFields: process.env.JIRA_STORY_POINTS_FIELDS
  ?.split(',').map(p => p.trim()).filter(Boolean) ?? [],
```

### 3. `src/lib/report-runner.ts`

Pass `config.jira.storyPointsFields` as the new parameter when calling `searchDoneIssues`.

### 4. `.env.example`

Add under the Jira section:

```env
# JIRA_STORY_POINTS_FIELDS=
# Comma-separated Jira field IDs for story points (instance-specific).
# Find yours: GET https://<JIRA_HOST>/rest/api/3/field — look for fields
# with "story" or "point" in the name and use their id value.
# Example: JIRA_STORY_POINTS_FIELDS=customfield_10016
```

### 5. `README.md`

In the Jira configuration section, document `JIRA_STORY_POINTS_FIELDS` alongside existing Jira vars. Include the field discovery instructions: call `GET /rest/api/3/field`, filter by name, use the `id`.

### 6. `CLAUDE.md`

Add to Gotchas:

> Jira story points field IDs are instance-specific — `JIRA_STORY_POINTS_FIELDS` must be set explicitly. Discover IDs via `GET /rest/api/3/field`.

### 7. `src/app/settings/page.tsx`

In the Jira config display section (read-only), add a row for story points fields using the same pattern as `projects` — show the list or "not configured" if empty.

### 8. `src/lib/__tests__/unit/jira-client.test.ts`

Update existing `searchDoneIssues` test calls to pass `storyPointsFields` as a parameter (empty array `[]` or a test value).

## Data Flow

```
JIRA_STORY_POINTS_FIELDS env var
  → app-config/service.ts (parsed into string[])
    → report-runner.ts (passed to searchDoneIssues)
      → jira/client.ts (included in search fields; first non-null value → storyPoints)
        → jira_issues.story_points (DB column)
```

## No Schema Changes

The `jira_issues.story_points` column already exists and is nullable. If `JIRA_STORY_POINTS_FIELDS` is empty, `storyPoints` will be `null` for all issues — same as the current behavior for instances where neither hardcoded field exists.

## Testing

- Update `jira-client.test.ts` to pass `storyPointsFields` param
- Add a test case: empty `storyPointsFields` → `storyPoints` is `null`
- Add a test case: configured field present in response → value mapped correctly
- Add a test case: multiple fields configured, first non-null wins
