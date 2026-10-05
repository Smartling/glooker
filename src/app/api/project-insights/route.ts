import { NextResponse } from 'next/server';
import { getProjectInsights } from '@/lib/projects/insights';
import { withRequestLog } from '@/lib/logger';
import { internalError } from '@/lib/api-error';

async function getHandler() {
  try {
    return NextResponse.json(await getProjectInsights());
  } catch (err) {
    return internalError('project-insights', err);
  }
}

export const GET = withRequestLog(getHandler);
