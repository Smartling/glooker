import { NextResponse } from 'next/server';
import { getAppConfig, testLLMConnection, getLatestReport, getReportFreshness, getVulnerabilityFreshness } from '@/lib/app-config/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  const [config, latestReport, reportFreshness, vulnerabilityFreshness] = await Promise.all([
    Promise.resolve(getAppConfig()),
    getLatestReport(),
    getReportFreshness(),
    getVulnerabilityFreshness(),
  ]);
  return NextResponse.json({ ...config, latestReport, reportFreshness, vulnerabilityFreshness });
}

async function postHandler(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(await testLLMConnection());
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
