import { NextResponse } from 'next/server';
import { getProjectInsights } from '@/lib/projects/insights';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  try {
    return NextResponse.json(await getProjectInsights());
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = withRequestLog(getHandler);
