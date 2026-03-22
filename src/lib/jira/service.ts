import db from '@/lib/db';
import { JiraClient, getJiraClient } from './client';

// ── Jira Issues for a report ──

export async function getJiraIssues(reportId: string, login?: string) {
  const conditions = ['report_id = ?'];
  const values: any[] = [reportId];

  if (login) {
    conditions.push('github_login = ?');
    values.push(login);
  }

  const [rows] = await db.execute(
    `SELECT issue_key, project_key, issue_type, summary, description,
            status, labels, story_points, original_estimate_seconds,
            issue_url, created_at, resolved_at
     FROM jira_issues
     WHERE ${conditions.join(' AND ')}
     ORDER BY resolved_at DESC`,
    values,
  ) as [any[], any];

  return rows.map((r: any) => ({
    ...r,
    labels: typeof r.labels === 'string' ? JSON.parse(r.labels || '[]') : (r.labels || []),
    story_points: r.story_points != null ? Number(r.story_points) : null,
  }));
}

// ── Test Jira connection ──

export async function testJiraConnection() {
  const host = process.env.JIRA_HOST;
  const username = process.env.JIRA_USERNAME;
  const apiToken = process.env.JIRA_API_TOKEN;
  const apiVersion = process.env.JIRA_API_VERSION || '3';

  if (!host || !username || !apiToken) {
    throw new JiraNotConfiguredError();
  }

  const client = new JiraClient(host, username, apiToken, apiVersion);
  const user = await client.testConnection();
  return { displayName: user.displayName, emailAddress: user.emailAddress };
}

// ── User Mappings ──

export async function getUserMappings(org: string) {
  const [reportRows] = await db.execute(
    `SELECT id FROM reports WHERE org = ? AND status = 'completed' ORDER BY created_at DESC LIMIT 1`,
    [org],
  ) as [any[], any];

  if (!reportRows.length) return [];

  const [devRows] = await db.execute(
    `SELECT github_login, github_name, avatar_url FROM developer_stats WHERE report_id = ?`,
    [reportRows[0].id],
  ) as [any[], any];

  const [mappingRows] = await db.execute(
    `SELECT github_login, jira_account_id, jira_email FROM user_mappings WHERE org = ?`,
    [org],
  ) as [any[], any];

  const mappingsByLogin = new Map(
    mappingRows.map((r: any) => [r.github_login, { jira_account_id: r.jira_account_id, jira_email: r.jira_email }]),
  );

  return devRows.map((dev: any) => ({
    github_login: dev.github_login,
    github_name: dev.github_name,
    avatar_url: dev.avatar_url,
    jira_account_id: mappingsByLogin.get(dev.github_login)?.jira_account_id || null,
    jira_email: mappingsByLogin.get(dev.github_login)?.jira_email || null,
    mapped: mappingsByLogin.has(dev.github_login),
  }));
}

export async function updateUserMapping(org: string, githubLogin: string, jiraEmail: string | null) {
  if (!jiraEmail) {
    await db.execute(`DELETE FROM user_mappings WHERE org = ? AND github_login = ?`, [org, githubLogin]);
    return { cleared: true };
  }

  const client = getJiraClient();
  if (!client) throw new JiraNotConfiguredError();

  const user = await client.findUserByEmail(jiraEmail);
  if (!user) throw new JiraUserNotFoundError(jiraEmail);

  await db.execute(
    `INSERT INTO user_mappings (org, github_login, jira_account_id, jira_email, created_at)
     VALUES (?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE jira_account_id = VALUES(jira_account_id), jira_email = VALUES(jira_email)`,
    [org, githubLogin, user.accountId, jiraEmail],
  );

  return {
    jira_account_id: user.accountId,
    jira_display_name: user.displayName,
    jira_email: jiraEmail,
  };
}

// ── Errors ──

export class JiraNotConfiguredError extends Error {
  constructor() {
    super('Jira credentials not configured in environment');
    this.name = 'JiraNotConfiguredError';
  }
}

export class JiraUserNotFoundError extends Error {
  constructor(email: string) {
    super(`No Jira user found for: ${email}`);
    this.name = 'JiraUserNotFoundError';
  }
}
