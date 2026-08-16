import { NextRequest, NextResponse } from 'next/server';
import { listJiraProjects, createJiraProject, JiraProjectDuplicateError } from '@/lib/jira-projects/service';
import { ensureSeedProject } from '@/lib/jira-projects/seed';
import { JiraProjectError } from '@/lib/jira-projects/types';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });

  // Settings → Projects and the board's project selector both read this list.
  // Migrating here too (not just from GET /api/projects) closes the gap where
  // an admin who opens Settings before anyone opens the board would otherwise
  // configure a project, make listJiraProjects non-empty, and permanently
  // short-circuit the legacy JIRA_PROJECTS_JQL seed. Never throws; no-op once
  // any row exists.
  await ensureSeedProject(org);

  return NextResponse.json(await listJiraProjects(org));
}

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const body = await req.json();
  const { org, ...input } = body ?? {};
  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  try {
    return NextResponse.json(await createJiraProject(org, input));
  } catch (err) {
    if (err instanceof JiraProjectDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof JiraProjectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
