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

  try {
    // Inside the try: `req.json()` throws on a malformed body, and outside it
    // that became an unhandled 500 rather than a 400.
    const body = await req.json();
    const { org, ...input } = body ?? {};
    if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

    return NextResponse.json(await createJiraProject(org, input));
  } catch (err) {
    // `instanceof SyntaxError` (and even `instanceof Error`) is unreliable
    // here: req.json()'s parse error comes from undici's internal realm, not
    // this module's global Error/SyntaxError (observed under the Jest test
    // environment) — check by `.name` instead.
    if ((err as { name?: string })?.name === 'SyntaxError') {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }
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
