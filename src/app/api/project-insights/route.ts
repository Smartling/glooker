import { NextRequest, NextResponse } from 'next/server';
import { getProjectInsights } from '@/lib/projects/insights';
import { withRequestLog } from '@/lib/logger';
import { internalError } from '@/lib/api-error';
import { resolveRequester } from '@/lib/cost-visibility';

async function getHandler(req: NextRequest) {
  try {
    const requester = await resolveRequester(req.headers);
    return NextResponse.json(await getProjectInsights(undefined, requester));
  } catch (err) {
    return internalError('project-insights', err);
  }
}

export const GET = withRequestLog(getHandler);
