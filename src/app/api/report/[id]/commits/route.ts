import { NextRequest, NextResponse } from 'next/server';
import { getReportCommits } from '@/lib/report/commits';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login');
  if (!login) return NextResponse.json({ error: 'login is required' }, { status: 400 });
  return NextResponse.json(await getReportCommits(id, login));
}
