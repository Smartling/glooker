import { randomUUID } from 'crypto';
import db from '../db/index';
import { validateJiraProject, type JiraProject } from './types';

export class JiraProjectNotFoundError extends Error {
  constructor(id: string) {
    super(`Jira project not found: ${id}`);
    this.name = 'JiraProjectNotFoundError';
  }
}

export class JiraProjectDuplicateError extends Error {
  constructor(key: string) {
    super(`Jira project "${key}" is already configured for this org`);
    this.name = 'JiraProjectDuplicateError';
  }
}

function toProject(r: any): JiraProject {
  return {
    id: r.id,
    org: r.org,
    projectKey: r.project_key,
    displayName: r.display_name,
    activeStatus: r.active_status,
    middleStatus: r.middle_status ?? null,
    hierarchy: r.hierarchy,
    position: Number(r.position),
  };
}

const COLUMNS = 'id, org, project_key, display_name, active_status, middle_status, hierarchy, position';

export async function listJiraProjects(org: string): Promise<JiraProject[]> {
  const [rows] = await db.execute(
    `SELECT ${COLUMNS} FROM jira_projects WHERE org = ? ORDER BY position, project_key`,
    [org],
  ) as [any[], any];
  return rows.map(toProject);
}

export async function createJiraProject(org: string, input: unknown): Promise<JiraProject> {
  const v = validateJiraProject(input);
  const id = randomUUID();
  try {
    await db.execute(
      `INSERT INTO jira_projects (id, org, project_key, display_name, active_status, middle_status, hierarchy, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, org, v.projectKey, v.displayName, v.activeStatus, v.middleStatus, v.hierarchy, v.position],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      throw new JiraProjectDuplicateError(v.projectKey);
    }
    throw err;
  }
  return { id, org, ...v };
}

export async function updateJiraProject(id: string, input: unknown): Promise<void> {
  const [existing] = await db.execute(`SELECT id FROM jira_projects WHERE id = ?`, [id]) as [any[], any];
  if (existing.length === 0) throw new JiraProjectNotFoundError(id);

  const v = validateJiraProject(input);
  try {
    await db.execute(
      `UPDATE jira_projects
         SET project_key = ?, display_name = ?, active_status = ?, middle_status = ?, hierarchy = ?, position = ?
       WHERE id = ?`,
      [v.projectKey, v.displayName, v.activeStatus, v.middleStatus, v.hierarchy, v.position, id],
    );
  } catch (err: any) {
    if (err?.code === 'ER_DUP_ENTRY' || err?.message?.includes('UNIQUE')) {
      throw new JiraProjectDuplicateError(v.projectKey);
    }
    throw err;
  }
}

export async function deleteJiraProject(id: string): Promise<void> {
  const [result] = await db.execute(`DELETE FROM jira_projects WHERE id = ?`, [id]) as [any, any];
  if (!result?.affectedRows) {
    throw new JiraProjectNotFoundError(id);
  }
}
