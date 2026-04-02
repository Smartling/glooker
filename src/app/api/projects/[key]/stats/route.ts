import { NextRequest, NextResponse } from 'next/server';
import { getEpicRingStats } from '@/lib/projects/epic-stats';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const org = req.nextUrl.searchParams.get('org');

  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

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
