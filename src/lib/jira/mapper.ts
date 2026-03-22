import db from '@/lib/db';
import { getJiraClient } from './client';

interface JiraMapping {
  accountId: string;
  email: string | null;
}

export async function resolveJiraUser(
  org: string,
  githubLogin: string,
  reportId: string,
  log?: (msg: string) => void,
): Promise<JiraMapping | null> {
  // 1. Check existing mapping
  const [rows] = await db.execute(
    `SELECT jira_account_id, jira_email FROM user_mappings WHERE org = ? AND github_login = ?`,
    [org, githubLogin],
  ) as [any[], any];

  if (rows.length > 0 && rows[0].jira_account_id) {
    return { accountId: rows[0].jira_account_id, email: rows[0].jira_email };
  }

  // 2. Auto-discover via commit emails
  const client = getJiraClient();
  if (!client) return null;

  const [emailRows] = await db.execute(
    `SELECT DISTINCT author_email FROM commit_analyses WHERE report_id = ? AND github_login = ? AND author_email IS NOT NULL AND author_email != ''`,
    [reportId, githubLogin],
  ) as [any[], any];

  const emails: string[] = emailRows.map((r: any) => r.author_email);
  if (emails.length === 0) {
    log?.(`[jira] No commit emails found for @${githubLogin}, cannot auto-discover Jira mapping`);
    return null;
  }

  for (const email of emails) {
    try {
      await new Promise(r => setTimeout(r, 1000));
      const user = await client.findUserByEmail(email);
      if (user) {
        log?.(`[jira] Auto-discovered: @${githubLogin} → ${user.displayName} (${email})`);
        // 3. Persist mapping
        await db.execute(
          `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email, created_at)
           VALUES (?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE jira_account_id = VALUES(jira_account_id), jira_email = VALUES(jira_email)`,
          [org, githubLogin, user.accountId, email],
        );
        return { accountId: user.accountId, email };
      }
    } catch (err) {
      log?.(`[jira] Error looking up ${email} for @${githubLogin}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log?.(`[jira] No Jira user found for @${githubLogin} (tried ${emails.length} email(s))`);
  return null;
}
