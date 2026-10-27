import { NextRequest, NextResponse } from 'next/server';
import { getJiraIssues } from '@/lib/jira';
import { parseRange, loadReportRangeWindow, getRangeJiraIssues } from '@/lib/report/range';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const login = search.get('login') || undefined;
  const range = parseRange(search.get('range'));
  if (!range) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  if (range === 'current') return NextResponse.json(await getJiraIssues(id, login));
  const ctx = await loadReportRangeWindow(id, range);
  if (!ctx) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await getRangeJiraIssues(ctx.org, login, ctx.window));
}

export const GET = withRequestLog(getHandler);
