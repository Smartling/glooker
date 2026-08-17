import { NextRequest, NextResponse } from 'next/server';
import { fetchProjectEpics } from '@/lib/projects/service';
import { listJiraProjects } from '@/lib/jira-projects/service';
import { ensureSeedProject, parseLegacyJql } from '@/lib/jira-projects/seed';
import { buildProjectJql } from '@/lib/jira-projects/jql';
import type { BoardTabKind, JiraProjectWithLegacyFlag } from '@/lib/jira-projects/types';
import { withRequestLog } from '@/lib/logger';

const TABS: BoardTabKind[] = ['active', 'middle', 'done'];

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  const statusParam = req.nextUrl.searchParams.get('status');
  const tab: BoardTabKind = TABS.includes(statusParam as BoardTabKind)
    ? (statusParam as BoardTabKind)
    : 'active';
  const projectKey = req.nextUrl.searchParams.get('project');

  try {
    // Migrates an existing deployment on first request; no-op thereafter.
    await ensureSeedProject(org);

    const configured = await listJiraProjects(org);
    if (configured.length === 0) {
      return NextResponse.json(
        { error: 'No Jira projects configured. Add one in Settings → Projects.' },
        { status: 404 },
      );
    }

    // `configured` was just fetched above; resolve the requested project from
    // it instead of a second round trip to the DB for data already in hand.
    const project = projectKey
      ? configured.find(p => p.projectKey === projectKey.trim().toUpperCase())
      : configured[0];

    if (!project) {
      return NextResponse.json({ error: `Unknown Jira project: ${projectKey}` }, { status: 404 });
    }

    // Which project (if any) the legacy JIRA_PROJECTS_JQL var names. Derived
    // per request, never stored — see JiraProjectWithLegacyFlag.
    const legacyRaw = process.env.JIRA_PROJECTS_JQL;
    const legacyProjectKey = legacyRaw ? parseLegacyJql(legacyRaw)?.projectKey ?? null : null;
    const projectWithLegacy: JiraProjectWithLegacyFlag = {
      ...project,
      isLegacy: legacyProjectKey !== null
        && legacyProjectKey.toUpperCase() === project.projectKey.toUpperCase(),
    };

    const jiraHost = process.env.JIRA_HOST || null;

    // A project with no middle status has a two-tab board; asking for its
    // middle tab is a legal URL that simply has nothing behind it.
    if (tab === 'middle' && !project.middleStatus) {
      return NextResponse.json({ epics: [], jiraHost, project: projectWithLegacy });
    }

    const epics = await fetchProjectEpics(buildProjectJql(project, tab), org);
    return NextResponse.json({ epics, jiraHost, project: projectWithLegacy });
  } catch (err) {
    console.error('[projects] Error fetching epics:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch projects' },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
