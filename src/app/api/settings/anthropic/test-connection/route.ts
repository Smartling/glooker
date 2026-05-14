// src/app/api/settings/anthropic/test-connection/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getCcSpendProvider } from '@/lib/cc-spend/provider';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

/**
 * Mask an email so the response preserves the "we got a real user back" signal
 * without leaking a corporate identity over devtools / screen share / logs.
 * Example: `bob.smith@smartling.com` → `b*********@smartling.com`.
 */
function maskEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  const at = email.indexOf('@');
  if (at <= 0) return undefined;
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes the '@'
  const first = local[0];
  const stars = '*'.repeat(Math.max(local.length - 1, 1));
  return `${first}${stars}${domain}`;
}

async function postHandler(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

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
      sampleEmailMasked: maskEmail(probe.sampleEmail),
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
