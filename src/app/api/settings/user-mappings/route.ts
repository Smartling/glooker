import { NextRequest, NextResponse } from 'next/server';
import { getUserMappings, updateUserMapping, JiraNotConfiguredError, JiraUserNotFoundError } from '@/lib/jira';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';

async function getHandler(req: NextRequest) {
  const orgCheck = requireAllowedOrg(req.nextUrl.searchParams.get('org'));
  if (!orgCheck.ok) return orgCheck.res;
  return NextResponse.json(await getUserMappings(orgCheck.org));
}

async function putHandler(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const { org, github_login, jira_email } = await req.json();
  const orgCheck = requireAllowedOrg(org);
  if (!orgCheck.ok) return orgCheck.res;
  if (!github_login) {
    return NextResponse.json({ error: 'github_login required' }, { status: 400 });
  }

  try {
    const result = await updateUserMapping(org, github_login, jira_email || null);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof JiraNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JiraUserNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}

export const GET = withRequestLog(getHandler);
export const PUT = withRequestLog(putHandler);
