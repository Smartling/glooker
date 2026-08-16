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
  return { projectKey: key[1].toUpperCase(), activeStatus: status[1] };
}

/**
 * Seed one project from the legacy env var when nothing is configured, so an
 * existing deployment keeps its board without operator action. Never throws:
 * a failure here must not take the Projects page down.
 *
 * `org` is called from GET /api/projects and GET /api/jira-projects, both
 * read-only and neither admin-gated (viewers must be able to read the
 * board), with `org` taken straight from a caller-controlled query param —
 * the same unvalidated convention every route in this codebase uses. Because
 * this function INSERTs, seeding unconditionally would let any caller mint a
 * jira_projects row for an arbitrary org string just by requesting it. So we
 * only seed for an org this deployment already knows about (has a team or a
 * report); a brand-new deployment with neither simply doesn't auto-seed and
 * instead falls through to the existing "No Jira projects configured. Add
 * one in Settings → Projects." message — strictly better than an
 * unauthenticated GET writing rows for org strings nobody chose.
 */
export async function ensureSeedProject(org: string): Promise<void> {
  try {
    const existing = await listJiraProjects(org);
    if (existing.length > 0) return;

    const raw = process.env.JIRA_PROJECTS_JQL;
    if (!raw) return;

    const parsed = parseLegacyJql(raw);
    if (!parsed) return;

    const [teamRows] = await db.execute(
      `SELECT 1 FROM teams WHERE org = ? LIMIT 1`,
      [org],
    ) as [any[], any];
    if (teamRows.length === 0) {
      const [reportRows] = await db.execute(
        `SELECT 1 FROM reports WHERE org = ? LIMIT 1`,
        [org],
      ) as [any[], any];
      if (reportRows.length === 0) return;
    }

    await createJiraProject(org, {
      projectKey: parsed.projectKey,
      displayName: parsed.projectKey,
      activeStatus: parsed.activeStatus,
      middleStatus: 'Rollout',
      hierarchy: 'goal-initiative',
      position: 0,
    });
  } catch (err) {
    console.error('[jira-projects] seed failed:', err);
  }
}
