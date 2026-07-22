import { NextResponse } from 'next/server';
import { getReleaseNotes } from '@/lib/release-notes/service';
import { withRequestLog } from '@/lib/logger';

async function getHandler() {
  return NextResponse.json(await getReleaseNotes());
}

export const GET = withRequestLog(getHandler);
