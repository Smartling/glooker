import { NextResponse } from 'next/server';
import { getReportHighlights } from '@/lib/report-highlights/service';
import { withRequestLog } from '@/lib/logger';
import { internalError } from '@/lib/api-error';

async function getHandler() {
  try {
    return NextResponse.json(await getReportHighlights());
  } catch (err) {
    return internalError('report-highlights', err);
  }
}

export const GET = withRequestLog(getHandler);
