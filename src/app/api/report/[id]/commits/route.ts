import { NextRequest, NextResponse } from 'next/server';
import { getReportCommits } from '@/lib/report/commits';
import { parseRange } from '@/lib/report/range-options';
import { withRequestLog } from '@/lib/logger';

async function getHandler(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const login = search.get('login');
  if (!login) return NextResponse.json({ error: 'login is required' }, { status: 400 });
  const range = parseRange(search.get('range'));
  if (!range) return NextResponse.json({ error: 'Invalid range' }, { status: 400 });
  return NextResponse.json(await getReportCommits(id, login, range));
}

export const GET = withRequestLog(getHandler);
