import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/lib/jira/client';
import { requireAdmin } from '@/lib/auth';

// GET: fetch available transitions for an epic
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  const client = getJiraClient();
  if (!client) {
    return NextResponse.json({ error: 'Jira is not configured' }, { status: 404 });
  }

  try {
    const transitions = await client.getTransitions(key);
    return NextResponse.json({ transitions });
  } catch (err) {
    console.error(`[status] Error fetching transitions for ${key}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to fetch transitions' },
      { status: 500 },
    );
  }
}

// PATCH: execute a transition
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { key } = await params;
  const body = await req.json();
  const { transitionId } = body;

  if (!transitionId) {
    return NextResponse.json({ error: 'transitionId is required' }, { status: 400 });
  }

  const client = getJiraClient();
  if (!client) {
    return NextResponse.json({ error: 'Jira is not configured' }, { status: 404 });
  }

  try {
    await client.transitionIssue(key, transitionId);
    return NextResponse.json({ success: true, key });
  } catch (err) {
    console.error(`[status] Error transitioning ${key}:`, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to transition issue' },
      { status: 500 },
    );
  }
}
