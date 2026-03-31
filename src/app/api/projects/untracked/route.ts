import { NextRequest, NextResponse } from 'next/server';
import { getUntrackedWork } from '@/lib/projects/untracked';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  const refresh = req.nextUrl.searchParams.get('refresh') === 'true';

  if (!org) {
    return NextResponse.json({ error: 'org query parameter is required' }, { status: 400 });
  }

  try {
    const result = await getUntrackedWork(org, refresh);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[untracked] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch untracked work' },
      { status: 500 },
    );
  }
}
