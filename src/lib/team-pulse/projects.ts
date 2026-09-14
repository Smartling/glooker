// src/lib/team-pulse/projects.ts
//
// GLOOK-11: generates the per-team Current Projects list via LLM clustering.
// Validates the output: filters developers to team_members, drops empty
// projects, and overrides last_activity from actual commit data.

import { getLLMClient, LLM_MODEL, extraBodyProps, tokenLimit, promptTag, samplingParams } from '@/lib/llm-provider';
import { loadPrompt } from '@/lib/prompt-loader';
import type { TeamProject } from './types';

/**
 * Why `cacheable` exists: an empty list has two meanings, and only one of them
 * may be persisted. "This team genuinely has no projects" is a real answer and
 * should be cached. "The model returned projects but none survived validation"
 * is indistinguishable to a reader from the first, and caching it makes the
 * section permanently blank — the GLOOK-51 failure mode arriving by a second
 * route. Same resolution projects/insights.ts reached: serve it, don't store it.
 */
export interface TeamProjectsResult {
  projects: TeamProject[];
  cacheable: boolean;
}
import type { TeamProjectsInput } from './data';
import { renderInflightBlock } from './render';

export const PROJECTS_PROMPT_TAG = 'team-pulse-projects';

/**
 * Raised when the model's output could not be used — truncated by the token
 * budget, or unparseable.
 *
 * Exists so the caller can tell a FAILURE from a legitimate "this team has no
 * projects". Returning [] for both is what made GLOOK-51 permanent: the empty
 * array was cached as a success and the section stayed blank forever.
 */
export class TeamProjectsUnusableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamProjectsUnusableError';
  }
}

/**
 * Token budget for the clustering response, scaled by team size.
 *
 * A flat 1500 truncated Integrations (14 developers) mid-object. Each project
 * costs roughly 120 tokens of JSON and a large team legitimately produces
 * many, so the budget grows with the roster.
 *
 * Calibration note: projects/insights.ts records 12000 as the value that
 * TRUNCATED for it and now runs at 32000. That is a different prompt with a
 * whole-report payload, so it is not a target — but it does mean this
 * ceiling is chosen conservatively rather than known-sufficient. If a
 * `finish_reason=length` for this prompt ever appears in the logs, raise
 * CEILING rather than treating it as a model problem.
 */
export function projectsTokenBudget(teamSize: number): number {
  const BASE = 2000;
  const PER_MEMBER = 400;
  const CEILING = 8000;
  return Math.min(BASE + teamSize * PER_MEMBER, CEILING);
}

/**
 * Strip ```json ... ``` fences some providers wrap responses in despite
 * response_format: json_object. Mirrors the analyzer fence-strip behavior.
 */
function stripJsonFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}


export async function generateTeamProjects(
  data: TeamProjectsInput,
  teamName: string = '',
): Promise<TeamProjectsResult> {
  // Short-circuit: nothing to cluster. A real, cacheable empty.
  if (data.commits.length === 0 && data.jira_issues.length === 0 &&
      data.in_flight_prs.length === 0 && data.in_flight_branches.length === 0) {
    return { projects: [], cacheable: true };
  }

  // Build a per-login index of committed_at for last_activity override.
  const commitByLogin = new Map<string, string[]>(); // login -> sorted committed_at[] desc
  for (const c of data.commits) {
    const arr = commitByLogin.get(c.github_login) || [];
    arr.push(c.committed_at);
    commitByLogin.set(c.github_login, arr);
  }
  for (const arr of commitByLogin.values()) arr.sort((a, b) => b.localeCompare(a));

  const budget = projectsTokenBudget(data.team_members.length);
  const inflightBlock = renderInflightBlock(data.in_flight_prs, data.in_flight_branches);
  const systemPrompt = loadPrompt('team-pulse-projects.txt', {
    TEAM_NAME: teamName,
    TEAM_MEMBERS_JSON: JSON.stringify(data.team_members),
    COMMITS_JSON: JSON.stringify(data.commits),
    JIRA_ISSUES_JSON: JSON.stringify(data.jira_issues),
    IN_FLIGHT_BLOCK: inflightBlock,
  });

  const client = await getLLMClient();
  const response = await client.chat.completions.create({
    model: LLM_MODEL,
    ...samplingParams(0.3),
    ...tokenLimit(budget),
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: 'Cluster the commits and Jira issues into projects and return the JSON object described in the system prompt.' },
    ],
    response_format: { type: 'json_object' },
    ...extraBodyProps(),
    ...promptTag(PROJECTS_PROMPT_TAG),
  } as any);

  const choice = response.choices?.[0];
  const finishReason: string = choice?.finish_reason ?? 'unknown';
  const raw = choice?.message?.content ?? '';
  const cleaned = stripJsonFences(Array.isArray(raw) ? raw.join('') : String(raw));

  // Truncation is a budget problem, not a model problem, and it must not be
  // reported as malformed JSON — that reading sent this bug looking in the
  // wrong place.
  //
  // This is a stricter check than the two nearby precedents, not the same one:
  // projects/insights.ts reads finish_reason only to CLASSIFY a message after a
  // parse has already failed, and projects/untracked.ts logs it and continues
  // into the parse regardless. Neither refuses a truncated response up front.
  if (finishReason === 'length') {
    throw new TeamProjectsUnusableError(
      `[team-pulse-projects] response truncated for team=${teamName} ` +
      `(finish_reason=length, budget=${budget}, ` +
      `team_members=${data.team_members.length}, content_chars=${cleaned.length})`,
    );
  }

  let parsed: { projects?: any[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new TeamProjectsUnusableError(
      `[team-pulse-projects] unparseable response for team=${teamName} ` +
      `(finish_reason=${finishReason}, content_chars=${cleaned.length}); ` +
      `raw=${cleaned.slice(0, 500)}`,
    );
  }

  const teamSet = new Set(data.team_members);
  const out: TeamProject[] = [];
  let droppedNoDevs = 0;

  for (const p of parsed.projects ?? []) {
    const developers: string[] = Array.isArray(p.developers)
      ? p.developers.filter((d: unknown) => typeof d === 'string' && teamSet.has(d))
      : [];
    if (developers.length === 0) { droppedNoDevs++; continue; }

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

  // Diagnostic: log when the LLM-clustering ends up empty so we can tell whether
  // the model returned nothing or the validator dropped everything.
  const llmProjectCount = Array.isArray(parsed.projects) ? parsed.projects.length : 0;
  if (out.length === 0) {
    console.warn(
      `[team-pulse-projects] empty result for team=${teamName} ` +
      `(llm_returned=${llmProjectCount}, dropped_no_devs=${droppedNoDevs}, ` +
      `team_members=${data.team_members.length}, commits=${data.commits.length}, jira=${data.jira_issues.length})`,
    );
  }

  // The model produced projects and the validator dropped all of them — e.g.
  // it emitted display names instead of GitHub logins. Deliberately NOT a
  // throw: the empty may well be the right answer, and raising would buy a
  // paid retry loop. Serve it unpersisted so the next request tries again.
  const cacheable = !(llmProjectCount > 0 && out.length === 0);

  return { projects: out, cacheable };
}
