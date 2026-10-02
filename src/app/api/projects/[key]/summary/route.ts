import { NextRequest, NextResponse } from 'next/server';
import { getEpicSummary } from '@/lib/projects/epic-summary';
import { withRequestLog } from '@/lib/logger';
import { requireAllowedOrg } from '@/lib/orgs/guard';

async function getHandler(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const orgParam = req.nextUrl.searchParams.get('org');
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
  const epicSummary = req.nextUrl.searchParams.get('summary') || '';

  const orgCheck = requireAllowedOrg(orgParam);
  if (!orgCheck.ok) return orgCheck.res;
  const org = orgCheck.org;

  if (process.env.JIRA_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Jira integration is not enabled' }, { status: 404 });
  }

  try {
    const result = await getEpicSummary(key, epicSummary, org, refresh);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`[epic-summary] Error for ${key}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate summary' },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
