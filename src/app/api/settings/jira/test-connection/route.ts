import { NextResponse } from 'next/server';
import { JiraClient } from '@/lib/jira';

export async function POST() {
  try {
    const host = process.env.JIRA_HOST;
    const username = process.env.JIRA_USERNAME;
    const apiToken = process.env.JIRA_API_TOKEN;
    const apiVersion = process.env.JIRA_API_VERSION || '3';

    if (!host || !username || !apiToken) {
      return NextResponse.json({ success: false, error: 'Jira credentials not configured in environment' }, { status: 400 });
    }

    const client = new JiraClient(host, username, apiToken, apiVersion);
    const user = await client.testConnection();

    return NextResponse.json({
      success: true,
      user: { displayName: user.displayName, emailAddress: user.emailAddress },
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
