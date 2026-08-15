import { NextRequest, NextResponse } from 'next/server';
import { fetchProjectEpics, type ProjectEpic } from '@/lib/projects/service';
import { resolveProjectSources, resolveBoardConfig, buildTeamJql } from '@/lib/projects/sources';
import type { BoardTab } from '@/lib/teams/board-config';
import { withRequestLog } from '@/lib/logger';

const TABS: BoardTab[] = ['In Progress', 'Rollout', 'Backlog', 'Done'];

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  const statusParam = req.nextUrl.searchParams.get('status');
  const tab: BoardTab = TABS.includes(statusParam as BoardTab)
    ? (statusParam as BoardTab)
    : 'In Progress';
  const teamFilter = req.nextUrl.searchParams.get('team');

  // The global source keeps its historical string-surgery behaviour verbatim.
  // Do not "improve" this regex here — see the plan's Global Constraints.
  const baseJql = process.env.JIRA_PROJECTS_JQL;
  let globalJql: string | null = baseJql ?? null;
  if (baseJql) {
    if (tab === 'Rollout') {
      globalJql = baseJql.replace(/status\s*=\s*"[^"]*"/, 'status = "Rollout"');
    } else if (tab === 'Done') {
      globalJql = baseJql.replace(/status\s*=\s*"[^"]*"/, 'statusCategory = "Done"') + ' AND updated >= -30d';
    } else if (tab === 'Backlog') {
      // Backlog is a team-source concept; the global board has no such tab.
      globalJql = null;
    }
  }

  try {
    const sources = await resolveProjectSources(org, { globalJql, team: teamFilter });
    if (sources.length === 0) {
      return NextResponse.json(
        { error: 'No project sources configured. Set JIRA_PROJECTS_JQL or give a team Jira project keys.' },
        { status: 404 },
      );
    }

    const byKey = new Map<string, ProjectEpic>();
    for (const source of sources) {
      const jql = source.kind === 'global'
        ? source.jql
        : buildTeamJql(source.projectKeys, tab, source.config);
      const provenanceTeam = source.kind === 'team' ? source.team : null;
      const epics = await fetchProjectEpics(jql, org, { provenanceTeam });
      for (const epic of epics) {
        // Provenance wins: a team source runs after the global one and overwrites.
        const existing = byKey.get(epic.key);
        if (!existing || provenanceTeam) byKey.set(epic.key, epic);
      }
    }

    const boardConfig = await resolveBoardConfig(org, teamFilter);
    const jiraHost = process.env.JIRA_HOST || null;
    return NextResponse.json({ epics: Array.from(byKey.values()), jiraHost, boardConfig });
  } catch (err) {
    console.error('[projects] Error fetching epics:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch projects' },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
