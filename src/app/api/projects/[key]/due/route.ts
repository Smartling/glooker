import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/lib/jira/client';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { isValidIssueKey } from '@/lib/jira-key-utils';
import { internalError } from '@/lib/api-error';

async function patchHandler(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { key } = await params;
  // Reject at the boundary so a malformed key is a 400 rather than a 500
  // from deep in the Jira client, and so it never reaches a log line.
  if (!isValidIssueKey(key)) {
    return NextResponse.json({ error: 'Invalid Jira issue key' }, { status: 400 });
  }
  const body = await req.json();
  const { dueDate } = body; // "2026-04-15" or null

  if (dueDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return NextResponse.json({ error: 'dueDate must be YYYY-MM-DD or null' }, { status: 400 });
  }

  const client = getJiraClient();
  if (!client) {
    return NextResponse.json({ error: 'Jira is not configured' }, { status: 404 });
  }

  try {
    await client.updateDueDate(key, dueDate);
    return NextResponse.json({ success: true, key, dueDate });
  } catch (err) {
    return internalError('due-date', err);
  }
}

export const PATCH = withRequestLog(patchHandler);
