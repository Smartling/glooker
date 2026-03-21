import { NextResponse } from 'next/server';
import { testJiraConnection, JiraNotConfiguredError } from '@/lib/jira';

export async function POST() {
  try {
    const user = await testJiraConnection();
    return NextResponse.json({ success: true, user });
  } catch (err) {
    if (err instanceof JiraNotConfiguredError) {
      return NextResponse.json({ success: false, error: err.message }, { status: 400 });
    }
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
