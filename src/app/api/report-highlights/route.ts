import { NextResponse } from 'next/server';
import { getReportHighlights } from '@/lib/report-highlights/service';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  try {
    return NextResponse.json(await getReportHighlights());
  } catch (err) {
    return NextResponse.json(
      { error: `LLM error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}

export const GET = withRequestLog(getHandler);
