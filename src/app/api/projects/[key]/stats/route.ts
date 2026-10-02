import { NextRequest, NextResponse } from 'next/server';
import { getEpicRingStats } from '@/lib/projects/epic-stats';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';
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

  const orgCheck = requireAllowedOrg(orgParam);
  if (!orgCheck.ok) return orgCheck.res;
  const org = orgCheck.org;

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  try {
    const stats = await getEpicRingStats(key, org);
    return NextResponse.json(stats);
  } catch (err) {
    return internalError('epic-stats', err);
  }
}

export const GET = withRequestLog(getHandler);
