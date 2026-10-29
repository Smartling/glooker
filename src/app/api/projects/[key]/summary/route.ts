import { NextRequest, NextResponse } from 'next/server';
import { getEpicSummary } from '@/lib/projects/epic-summary';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg, requireOrgMembership } from '@/lib/orgs/guard';
import { isValidIssueKey } from '@/lib/jira-key-utils';
import { internalError } from '@/lib/api-error';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  // Reject at the boundary so a malformed key is a 400 rather than a 500
  // from deep in the Jira client, and so it never reaches a log line.
  if (!isValidIssueKey(key)) {
    return NextResponse.json({ error: 'Invalid Jira issue key' }, { status: 400 });
  }
  const orgParam = req.nextUrl.searchParams.get('org');
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
  const epicSummary = req.nextUrl.searchParams.get('summary') || '';

  const orgCheck = requireAllowedOrg(orgParam);
  if (!orgCheck.ok) return orgCheck.res;
  const org = orgCheck.org;

  const membershipDenied = await requireOrgMembership(req.headers, org);
  if (membershipDenied) return membershipDenied;

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  try {
    const result = await getEpicSummary(key, epicSummary, org, refresh);
    return NextResponse.json(result);
  } catch (err) {
    return internalError('epic-summary', err);
  }
}

export const GET = withRequestLog(getHandler);
