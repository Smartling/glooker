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
 */
export async function ensureSeedProject(org: string): Promise<void> {
  try {
    const existing = await listJiraProjects(org);
    if (existing.length > 0) return;

    const raw = process.env.JIRA_PROJECTS_JQL;
    if (!raw) return;

    const parsed = parseLegacyJql(raw);
    if (!parsed) return;

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
