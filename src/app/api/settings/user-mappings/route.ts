import { NextRequest, NextResponse } from 'next/server';
import { getUserMappings, updateUserMapping, JiraNotConfiguredError, JiraUserNotFoundError } from '@/lib/jira';

export async function GET(req: NextRequest) {
  const org = req.nextUrl.searchParams.get('org');
  if (!org) return NextResponse.json({ error: 'org required' }, { status: 400 });
  return NextResponse.json(await getUserMappings(org));
}

export async function PUT(req: Request) {
  const { org, github_login, jira_email } = await req.json();
  if (!org || !github_login) {
    return NextResponse.json({ error: 'org and github_login required' }, { status: 400 });
  }

  try {
    const result = await updateUserMapping(org, github_login, jira_email || null);
    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    if (err instanceof JiraNotConfiguredError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof JiraUserNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
}
