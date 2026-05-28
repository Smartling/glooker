// src/lib/team-pulse/projects.ts
//
// GLOOK-11: generates the per-team Current Projects list via LLM clustering.
// Validates the output: filters developers to team_members, drops empty
// projects, and overrides last_activity from actual commit data.

import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import type { TeamProject } from './types';
import type { TeamProjectsInput } from './data';

export const PROJECTS_PROMPT_TAG = 'team-pulse-projects';

/**
 * Strip ```json ... ``` fences some providers wrap responses in despite
 * response_format: json_object. Mirrors the analyzer fence-strip behavior.
 */
function stripJsonFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

export async function generateTeamProjects(data: TeamProjectsInput): Promise<TeamProject[]> {
  // Short-circuit: nothing to cluster.
  if (data.commits.length === 0 && data.jira_issues.length === 0) {
    return [];
  }

  // Build a per-login index of committed_at for last_activity override.
  const commitByLogin = new Map<string, string[]>(); // login -> sorted committed_at[] desc
  for (const c of data.commits) {
    const arr = commitByLogin.get(c.github_login) || [];
    arr.push(c.committed_at);
    commitByLogin.set(c.github_login, arr);
  }
  for (const arr of commitByLogin.values()) arr.sort((a, b) => b.localeCompare(a));

  const systemPrompt = loadPrompt('team-pulse-projects.txt', {
    TEAM_NAME: '',
    TEAM_MEMBERS_JSON: JSON.stringify(data.team_members),
    COMMITS_JSON: JSON.stringify(data.commits),
    JIRA_ISSUES_JSON: JSON.stringify(data.jira_issues),
  });

  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    temperature: 0.3,
    ...tokenLimit(1500),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: 'Cluster the commits and Jira issues into projects and return the JSON object described in the system prompt.' },
    ],
    response_format: { type: 'json_object' },
    ...extraBodyProps(),
    ...promptTag(PROJECTS_PROMPT_TAG),
  } as any);

  const raw = response.choices?.[0]?.message?.content ?? '';
  const cleaned = stripJsonFences(Array.isArray(raw) ? raw.join('') : String(raw));

  let parsed: { projects?: any[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  const teamSet = new Set(data.team_members);
  const out: TeamProject[] = [];

  for (const p of parsed.projects ?? []) {
    const developers: string[] = Array.isArray(p.developers)
      ? p.developers.filter((d: unknown) => typeof d === 'string' && teamSet.has(d))
      : [];
    if (developers.length === 0) continue;

    // Override last_activity with the most recent commit by any of the cluster's developers.
    // Best-effort proxy: max committed_at across all commits authored by these developers.
    let lastActivity: string = typeof p.last_activity === 'string' ? p.last_activity : '';
    for (const d of developers) {
      const arr = commitByLogin.get(d);
      if (arr && arr.length && (lastActivity === '' || arr[0] > lastActivity)) {
        lastActivity = arr[0];
      }
    }

    out.push({
      name:              String(p.name ?? '').trim() || 'Untitled project',
      summary:           String(p.summary ?? '').trim(),
      developers,
      jira_count:        Number.isFinite(p.jira_count) ? Number(p.jira_count) : 0,
      estimated_commits: Number.isFinite(p.estimated_commits) ? Number(p.estimated_commits) : 0,
      estimated_prs:     Number.isFinite(p.estimated_prs) ? Number(p.estimated_prs) : 0,
      last_activity:     lastActivity,
    });
  }

  return out;
}
