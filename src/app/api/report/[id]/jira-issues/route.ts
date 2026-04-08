import { NextRequest, NextResponse } from 'next/server';
import { getJiraIssues } from '@/lib/jira';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login') || undefined;
  return NextResponse.json(await getJiraIssues(id, login));
}

export const GET = withRequestLog(getHandler);
