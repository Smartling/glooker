import { NextResponse } from 'next/server';
import { getGitHubProvider } from '@/lib/github';
import { withRequestLog } from '@/lib/logger';

async function postHandler() {
  const start = Date.now();
  try {
    const provider = getGitHubProvider();
    const orgs = await provider.listOrgs();
    const latencyMs = Date.now() - start;
    return NextResponse.json({
      success: true,
      orgs: orgs.map(o => o.login),
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
