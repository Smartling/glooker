import { NextRequest, NextResponse } from 'next/server';
import { fetchProjectEpics } from '@/lib/projects/service';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  const jql = process.env.JIRA_PROJECTS_JQL;
  if (!jql) {
    return NextResponse.json({ error: 'JIRA_PROJECTS_JQL is not configured' }, { status: 404 });
  }

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  try {
    const epics = await fetchProjectEpics(jql, org);
    const jiraHost = process.env.JIRA_HOST || null;
    return NextResponse.json({ epics, jiraHost });
  } catch (err) {
    console.error('[projects] Error fetching epics:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch projects' },
      { status: 500 },
    );
  }
}
