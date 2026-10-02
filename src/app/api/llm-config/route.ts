import { NextResponse } from 'next/server';
import { getAppConfig, getPublicAppConfig, testLLMConnection, getLatestReport } from '@/lib/app-config/service';
import { isAdmin, requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: Request) {
  // This GET had no gate at all, so hosts, the Jira service-account username,
  // the LLM endpoint, `missing[]` (which enumerates exactly which credentials
  // are absent) and partial secrets were readable by anyone who could reach the
  // port — and src/app/page.tsx fetches it on every homepage load, so the
  // payload also reached every ordinary user's devtools and HAR captures.
  const latestReport = await getLatestReport();
  if (await isAdmin(req)) {
    return NextResponse.json({ ...getAppConfig(), latestReport });
  }
  return NextResponse.json({ ...getPublicAppConfig(), latestReport });
}

async function postHandler(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(await testLLMConnection());
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
