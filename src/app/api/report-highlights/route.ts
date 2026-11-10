import { NextRequest, NextResponse } from 'next/server';
import { getReportHighlights } from '@/lib/report-highlights/service';
import { withRequestLog } from '@/lib/logger';
import { internalError } from '@/lib/api-error';
import { resolveRequester } from '@/lib/cost-visibility';

async function getHandler(req: NextRequest) {
  try {
    const requester = await resolveRequester(req.headers);
    return NextResponse.json(await getReportHighlights(requester));
  } catch (err) {
    return internalError('report-highlights', err);
  }
}

export const GET = withRequestLog(getHandler);
