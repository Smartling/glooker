import { NextResponse } from 'next/server';
import { getReportHighlights } from '@/lib/report-highlights/service';

export async function GET() {
  try {
    return NextResponse.json(await getReportHighlights());
  } catch (err) {
    return NextResponse.json(
      { error: `LLM error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }
}
