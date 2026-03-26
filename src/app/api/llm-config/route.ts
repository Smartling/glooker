import { NextResponse } from 'next/server';
import { getAppConfig, testLLMConnection } from '@/lib/app-config/service';
import { requireAdmin } from '@/lib/auth';

export async function GET() {
  return NextResponse.json(getAppConfig());
}

export async function POST(req: Request) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  return NextResponse.json(await testLLMConnection());
}
