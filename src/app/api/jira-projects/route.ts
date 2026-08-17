import { NextRequest, NextResponse } from 'next/server';
import { listJiraProjects, createJiraProject, JiraProjectDuplicateError } from '@/lib/jira-projects/service';
import { JiraProjectError } from '@/lib/jira-projects/types';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });

  // Pure read — no seeding here. Settings → Projects reloads this list right
  // after a DELETE; migrating on every read would resurrect the last project
  // an admin just deleted. The board (GET /api/projects) still runs the
  // one-time legacy-var migration on first load.
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
