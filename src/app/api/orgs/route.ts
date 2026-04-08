import { NextResponse } from 'next/server';
import { listOrgs } from '@/lib/orgs/service';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  try {
    return NextResponse.json(await listOrgs());
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export const GET = withRequestLog(getHandler);
