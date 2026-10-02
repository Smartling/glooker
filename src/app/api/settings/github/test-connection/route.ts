import { NextResponse } from 'next/server';
import { getGitHubProvider } from '@/lib/github';
import { withRequestLog } from '@/lib/logger';
import { requireAdmin } from '@/lib/auth';

async function postHandler(req: Request) {
  // This returns every organisation the server's PAT can see, so it is a
  // credentialed enumeration primitive, not a harmless connectivity probe.
  // It was the only *_test-connection route without an admin gate.
  const denied = await requireAdmin(req);
  if (denied) return denied;

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
