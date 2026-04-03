import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/lib/jira/client';
import { requireAdmin } from '@/lib/auth';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { key } = await params;
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
    console.error(`[due-date] Error updating ${key}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update due date' },
      { status: 500 },
    );
  }
}
