import { NextRequest, NextResponse } from 'next/server';
import { getEpicSummary } from '@/lib/projects/epic-summary';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const org = req.nextUrl.searchParams.get('org');
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true';
  const epicSummary = req.nextUrl.searchParams.get('summary') || '';

  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

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
