import { NextRequest, NextResponse } from 'next/server';
import { getJiraIssues } from '@/lib/jira';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const login = req.nextUrl.searchParams.get('login') || undefined;
  return NextResponse.json(await getJiraIssues(id, login));
}
