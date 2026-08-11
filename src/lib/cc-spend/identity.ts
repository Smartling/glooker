/**
 * Single source of truth for Anthropic email → github_login resolution, shared
 * by the cost, skills and model applies so the three cannot drift apart.
 *
 * commit_analyses is primary (authoritative for this report's window);
 * user_mappings is the fallback and never overrides a commit-derived mapping.
 * Takes a `tx` so callers can run it inside their own transaction.
 */
export async function buildEmailToLoginMap(
  tx: { execute: (sql: string, params?: any[]) => Promise<any> },
  reportId: string,
  org: string,
): Promise<Map<string, string>> {
  const emailToLogin = new Map<string, string>();

  const [commitEmails] = await tx.execute(
    `SELECT DISTINCT LOWER(author_email) AS email, github_login
     FROM commit_analyses
     WHERE report_id = ? AND author_email IS NOT NULL AND author_email <> ''`,
    [reportId],
  ) as [any[], any];
  for (const r of commitEmails) {
    if (r.email && r.github_login) emailToLogin.set(r.email, r.github_login);
  }

  const [jiraMappings] = await tx.execute(
    `SELECT LOWER(jira_email) AS email, github_login
     FROM user_mappings
     WHERE org = ? AND jira_email IS NOT NULL AND jira_email <> ''`,
    [org],
  ) as [any[], any];
  for (const r of jiraMappings) {
    if (r.email && r.github_login && !emailToLogin.has(r.email)) {
      emailToLogin.set(r.email, r.github_login);
    }
  }

  return emailToLogin;
}
