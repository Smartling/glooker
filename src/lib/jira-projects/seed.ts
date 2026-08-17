import db from '@/lib/db';
import { listJiraProjects, createJiraProject } from './service';

/**
 * Parse the legacy JIRA_PROJECTS_JQL into the fields a jira_projects row needs.
 * Returns null when either clause is missing — a half-parsed row is worse than
 * none, because the operator gets a board that silently shows the wrong epics.
 */
export function parseLegacyJql(jql: string): { projectKey: string; activeStatus: string } | null {
  const key = jql.match(/project\s*=\s*"?([A-Za-z][A-Za-z0-9_]*)"?/);
  // Deliberately anchored on `status`, not `statusCategory`: the two mean
  // different things and we cannot map a category onto a status name.
  const status = jql.match(/(?:^|\s)status\s*=\s*"([^"]+)"/);
  if (!key || !status) return null;

  // The migration only ever carries `project`, `issuetype` and `status` onto
  // the new row. Any other clause — a `component` filter, a duplicated
  // `status`, etc. — is silently dropped, which can only make the migrated
  // board *wider* than the JQL it replaces (never narrower). Warn so that
  // scope change is discoverable instead of silent; we still migrate what we
  // can rather than refusing outright.
  const carried = new Set(['project', 'issuetype', 'status']);
  const clauseNames = jql
    .split(/\s+AND\s+/i)
    .map((clause) => clause.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1]?.toLowerCase())
    .filter((name): name is string => Boolean(name));
  const dropped = clauseNames.filter((name) => !carried.has(name));
  if (dropped.length > 0) {
    console.warn(
      `[jira-projects] JIRA_PROJECTS_JQL has clauses this migration does not carry over: ` +
      `${dropped.join(', ')}. The migrated project's board will be wider than "${jql}" ` +
      `until they're recreated in Settings → Projects.`,
    );
  }

  return { projectKey: key[1].toUpperCase(), activeStatus: status[1] };
}

// Orgs for which ensureSeedProject has already run to completion this
// process — whether it seeded, skipped, or failed. GET /api/projects calls
// ensureSeedProject on every board load, so without this an admin who
// deletes the only jira_projects row via Settings would see it resurrected
// the next time the board is loaded. Every return path below marks the org
// attempted before returning, so the seed truly runs at most once per org
// per process regardless of outcome.
const seedAttempted = new Set<string>();

// Test-only: forget which orgs have already had a seed attempt, so tests can
// exercise ensureSeedProject repeatedly for the same org.
export function __resetSeedMemoForTest(): void {
  seedAttempted.clear();
}

/**
 * Seed one project from the legacy env var when nothing is configured, so an
 * existing deployment keeps its board without operator action. Never throws:
 * a failure here must not take the Projects page down.
 *
 * Called from GET /api/projects — read-only and not admin-gated (viewers
 * must be able to read the board) — with `org` taken straight from a
 * caller-controlled query param, the same unvalidated convention every route
 * in this codebase uses. Because this function INSERTs, seeding
 * unconditionally would let any caller mint a jira_projects row for an
 * arbitrary org string just by requesting it. So we only seed for an org
 * this deployment already knows about (has a team or a report); a
 * brand-new deployment with neither simply doesn't auto-seed and instead
 * falls through to the existing "No Jira projects configured. Add one in
 * Settings → Projects." message — strictly better than an unauthenticated
 * GET writing rows for org strings nobody chose.
 */
export async function ensureSeedProject(org: string): Promise<void> {
  if (seedAttempted.has(org)) return;

  try {
    const existing = await listJiraProjects(org);
    if (existing.length > 0) {
      seedAttempted.add(org);
      return;
    }

    const raw = process.env.JIRA_PROJECTS_JQL;
    if (!raw) {
      seedAttempted.add(org);
      return;
    }

    const parsed = parseLegacyJql(raw);
    if (!parsed) {
      seedAttempted.add(org);
      console.warn(
        `[jira-projects] seed: JIRA_PROJECTS_JQL could not be parsed, skipping migration: ${raw}`,
      );
      return;
    }

    const [teamRows] = await db.execute(
      `SELECT 1 FROM teams WHERE org = ? LIMIT 1`,
      [org],
    ) as [any[], any];
    if (teamRows.length === 0) {
      const [reportRows] = await db.execute(
        `SELECT 1 FROM reports WHERE org = ? LIMIT 1`,
        [org],
      ) as [any[], any];
      if (reportRows.length === 0) {
        seedAttempted.add(org);
        return;
      }
    }

    // Mark attempted before the insert: whether or not the insert below
    // succeeds, this org gets at most one seed attempt per process.
    seedAttempted.add(org);
    await createJiraProject(org, {
      projectKey: parsed.projectKey,
      displayName: parsed.projectKey,
      activeStatus: parsed.activeStatus,
      // A two-tab board is the honest default for an unknown workflow, and
      // it's faithful to the legacy single-status board — the legacy var
      // never named a middle status. An admin adds one in Settings.
      middleStatus: null,
      hierarchy: 'goal-initiative',
      position: 0,
    });
  } catch (err) {
    seedAttempted.add(org);
    console.error('[jira-projects] seed failed:', err);
  }
}
