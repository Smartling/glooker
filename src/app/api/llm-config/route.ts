import { NextResponse } from 'next/server';
import { getAppConfig, testLLMConnection } from '@/lib/app-config/service';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  return NextResponse.json(getAppConfig());
}

async function postHandler(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(await testLLMConnection());
}

export const GET = withRequestLog(getHandler);
export const POST = withRequestLog(postHandler);
