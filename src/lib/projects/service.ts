import { getJiraClient } from '@/lib/jira/client';
import db from '@/lib/db';

export interface ProjectEpic {
  key: string;
  summary: string;
  status: string;
  dueDate: string | null;
  assignee: string | null;
  team: { name: string; color: string } | null;
  initiative: { key: string; summary: string } | null;
  goal: { key: string; summary: string } | null;
}

export async function fetchProjectEpics(jql: string, org: string): Promise<ProjectEpic[]> {
  const client = getJiraClient();
  if (!client) throw new Error('Jira is not configured');

  // 1. Fetch epics
  const rawEpics = await client.searchEpics(jql);

  // 2. Collect unique initiative keys to resolve their parents (goals)
  const initiativeKeys = new Set<string>();
  for (const epic of rawEpics) {
    if (epic.parentKey && epic.parentTypeName === 'Initiative') {
      initiativeKeys.add(epic.parentKey);
    }
  }

  // 3. Batch-fetch initiatives to get their parent goals
  const initiativeToGoal = new Map<string, { key: string; summary: string }>();
  if (initiativeKeys.size > 0) {
    const keys = Array.from(initiativeKeys);
    const inClause = keys.map(k => `"${k}"`).join(',');
    const initJql = `key in (${inClause})`;
    const initiatives = await client.searchEpics(initJql);
    for (const init of initiatives) {
      if (init.parentKey && init.parentSummary) {
        initiativeToGoal.set(init.key, { key: init.parentKey, summary: init.parentSummary });
      }
    }
  }

  // 4. Build assignee email→team lookup
  const teamMap = await buildAssigneeTeamMap(org);

  // 5. Assemble results
  const epics: ProjectEpic[] = rawEpics
    .filter(e => e.parentKey && e.parentTypeName === 'Initiative')
    .map(epic => {
      const initiative = epic.parentKey
        ? { key: epic.parentKey, summary: epic.parentSummary || '' }
        : null;
      const goal = epic.parentKey ? initiativeToGoal.get(epic.parentKey) || null : null;
      const team = epic.assigneeEmail ? teamMap.get(epic.assigneeEmail.toLowerCase()) || null : null;

      return {
        key: epic.key,
        summary: epic.summary,
        status: epic.status,
        dueDate: epic.dueDate,
        assignee: epic.assigneeDisplayName,
        team,
        initiative,
        goal,
      };
    });

  // Sort: goal name → initiative name → epic summary
  epics.sort((a, b) => {
    const goalA = a.goal?.summary || '\uffff';
    const goalB = b.goal?.summary || '\uffff';
    if (goalA !== goalB) return goalA.localeCompare(goalB);
    const initA = a.initiative?.summary || '\uffff';
    const initB = b.initiative?.summary || '\uffff';
    if (initA !== initB) return initA.localeCompare(initB);
    return a.summary.localeCompare(b.summary);
  });

  return epics;
}

async function buildAssigneeTeamMap(org: string): Promise<Map<string, { name: string; color: string }>> {
  const [mappings] = await db.execute(
    `SELECT github_login, jira_email FROM user_mappings WHERE org = ?`,
    [org],
  ) as [any[], any];

  const emailToLogin = new Map<string, string>();
  for (const m of mappings) {
    if (m.jira_email) {
      emailToLogin.set(m.jira_email.toLowerCase(), m.github_login);
    }
  }

  const [teamRows] = await db.execute(
    `SELECT tm.github_login, t.name, t.color
     FROM team_members tm
     JOIN teams t ON t.id = tm.team_id
     WHERE t.org = ?`,
    [org],
  ) as [any[], any];

  const loginToTeam = new Map<string, { name: string; color: string }>();
  for (const row of teamRows) {
    loginToTeam.set(row.github_login, { name: row.name, color: row.color });
  }

  const emailToTeam = new Map<string, { name: string; color: string }>();
  for (const [email, login] of emailToLogin) {
    const team = loginToTeam.get(login);
    if (team) {
      emailToTeam.set(email, team);
    }
  }

  return emailToTeam;
}
