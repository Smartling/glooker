import { NextRequest, NextResponse } from 'next/server';
import { listDevelopers, listDevelopersFromGitHub } from '@/lib/developers/service';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  const q = req.nextUrl.searchParams.get('q') || '';
  const source = req.nextUrl.searchParams.get('source');

  if (!org) return NextResponse.json({ error: 'org is required' }, { status: 400 });

  if (source === 'github') {
    try {
      return NextResponse.json(await listDevelopersFromGitHub(org, q || undefined));
    } catch {
      return NextResponse.json({ error: 'GitHub API error' }, { status: 500 });
    }
  }

  const limit = Number(req.nextUrl.searchParams.get('limit')) || 0;
  return NextResponse.json(await listDevelopers(org, { query: q || undefined, limit }));
}
