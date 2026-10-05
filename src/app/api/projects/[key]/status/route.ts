import { NextRequest, NextResponse } from 'next/server';
import { getJiraClient } from '@/lib/jira/client';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';
import { isValidIssueKey } from '@/lib/jira-key-utils';
import { internalError } from '@/lib/api-error';

// GET: fetch available transitions for an epic
async function getHandler(
  _req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const { key } = await params;
  // Reject at the boundary so a malformed key is a 400 rather than a 500
  // from deep in the Jira client, and so it never reaches a log line.
  if (!isValidIssueKey(key)) {
    return NextResponse.json({ error: 'Invalid Jira issue key' }, { status: 400 });
  }
  const client = getJiraClient();
  if (!client) {
    return NextResponse.json({ error: 'Jira is not configured' }, { status: 404 });
  }

  try {
    // Deliberately unfiltered — an admin may move an epic to any status the
    // workflow allows, including ones this board shows no tab for. Each entry
    // carries `toStatusCategory` so the client can classify the destination
    // instead of assuming anything it does not recognise is Done.
    const transitions = await client.getTransitions(key);
    return NextResponse.json({ transitions });
  } catch (err) {
    return internalError('status-transitions', err);
  }
}

// PATCH: execute a transition
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
    // The response deliberately does not echo the destination status or its
    // category. Jira's transition POST returns 204 with no body, and the id we
    // were handed stops being offered once the transition has run, so naming
    // the destination here would cost a second Jira round-trip for data the
    // caller already holds: GET on this route returns every transition with
    // its `toStatusCategory`, and that is what the board classifies against.
    return NextResponse.json({ success: true, key });
  } catch (err) {
    return internalError('status-transition', err);
  }
}

export const GET = withRequestLog(getHandler);
export const PATCH = withRequestLog(patchHandler);
