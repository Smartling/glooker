// src/app/api/settings/anthropic/test-connection/route.ts
import { NextResponse } from 'next/server';
import { getCcSpendProvider } from '@/lib/cc-spend/provider';
import { withRequestLog } from '@/lib/logger';

async function postHandler() {
  const start = Date.now();
  try {
    const provider = getCcSpendProvider();
    // Use a date 2 days back to clear the 1-hour freshness window.
    const date = new Date(Date.now() - 2 * 86400_000).toISOString().slice(0, 10);
    const probe = await provider.probe(date);
    const latencyMs = Date.now() - start;
    return NextResponse.json({
      success: true,
      userCount: probe.userCount,
      sampleEmail: probe.sampleEmail,
      probeDate: date,
      latencyMs,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      latencyMs,
    });
  }
}

export const POST = withRequestLog(postHandler);
