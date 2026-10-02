import { NextRequest, NextResponse } from 'next/server';
import { getEpicRingStats } from '@/lib/projects/epic-stats';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
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
    console.error(`[epic-stats] Error for ${key}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch stats' },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
