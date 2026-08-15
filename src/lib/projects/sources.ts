import { listTeams } from '@/lib/teams/service';
import { parseBoardConfig, PROJECT_KEY_RE, type BoardConfig, type BoardTab } from '@/lib/teams/board-config';

/**
 * Where the Projects board gets its epics.
 *
 * `global` is the long-standing JIRA_PROJECTS_JQL, run and tab-mutated exactly as
 * before. `team` sources are GLOOK-38: a team that declares Jira project keys owns
 * those epics by provenance, so attribution does not depend on who commits.
 */
export type ProjectSource =
  | { kind: 'global'; jql: string }
  | {
      kind: 'team';
      team: { name: string; color: string };
      projectKeys: string[];
      config: BoardConfig;
    };

export interface ResolveSourcesOptions {
  /** JIRA_PROJECTS_JQL, already tab-mutated by the route. Omit to skip the global source. */
  globalJql?: string | null;
  /** Team-filter selection from the UI. */
  team?: string | null;
}

/**
 * Build the JQL for a team source. Uses `statusCategory` rather than `status` so it
 * survives per-project workflow naming: RND's "Backlog" is category "To Do" and its
 * "Rejected" is category "Done".
 */
export function buildTeamJql(projectKeys: string[], tab: BoardTab, config: BoardConfig): string {
  if (projectKeys.length === 0) {
    throw new Error('buildTeamJql requires at least one project key');
  }
  for (const key of projectKeys) {
    if (!PROJECT_KEY_RE.test(key)) {
      throw new Error(`buildTeamJql received an invalid project key: ${key}`);
    }
  }
  const inList = projectKeys.map(k => `"${k}"`).join(', ');
  const base = `project in (${inList}) AND issuetype = Epic`;

  switch (tab) {
    case 'In Progress':
      return `${base} AND statusCategory = "In Progress"`;
    case 'Backlog':
      return `${base} AND statusCategory = "To Do"`;
    case 'Rollout':
      // Rollout is a status, not a category — there is no "Rollout" statusCategory.
      return `${base} AND status = "Rollout"`;
    case 'Done': {
      const d = config.doneWindowDays;
      // Rejected epics sit in statusCategory Done but carry a null resolutiondate,
      // so `resolved >= -Nd` alone can never match them.
      const window = config.includeRejected
        ? `(resolved >= -${d}d OR updated >= -${d}d)`
        : `resolved >= -${d}d`;
      return `${base} AND statusCategory = "Done" AND ${window}`;
    }
  }
}

export async function resolveProjectSources(
  org: string,
  opts: ResolveSourcesOptions,
): Promise<ProjectSource[]> {
  const teams = await listTeams(org);

  const teamSources: ProjectSource[] = [];
  for (const t of teams) {
    const config = parseBoardConfig(t.board_config);
    if (config.jiraProjectKeys.length === 0) continue;
    if (opts.team && t.name !== opts.team) continue;
    teamSources.push({
      kind: 'team',
      team: { name: t.name, color: t.color },
      projectKeys: config.jiraProjectKeys,
      config,
    });
  }

  // A team filter that selects a configured team means the caller wants that
  // team's board specifically — don't drag the whole global epic set in with it.
  if (opts.team && teamSources.length > 0) return teamSources;

  const sources: ProjectSource[] = [];
  if (opts.globalJql) sources.push({ kind: 'global', jql: opts.globalJql });
  sources.push(...teamSources);
  return sources;
}

/**
 * The board config that should shape the UI, or null when the view is mixed.
 * Per-team layout only makes sense for a single-team view.
 */
export async function resolveBoardConfig(
  org: string,
  teamName: string | null,
): Promise<BoardConfig | null> {
  if (!teamName) return null;
  const teams = await listTeams(org);
  const match = teams.find((t: any) => t.name === teamName);
  if (!match) return null;
  const config = parseBoardConfig(match.board_config);
  return config.jiraProjectKeys.length > 0 ? config : null;
}
