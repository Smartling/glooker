import { NextRequest, NextResponse } from 'next/server';
import {
  updateJiraProject, deleteJiraProject,
  JiraProjectNotFoundError, JiraProjectDuplicateError,
} from '@/lib/jira-projects/service';
import { JiraProjectError } from '@/lib/jira-projects/types';
import { requireAdmin } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger';

async function putHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  const body = await req.json();

  try {
    await updateJiraProject(id, body);
    return NextResponse.json({ updated: true });
  } catch (err) {
    if (err instanceof JiraProjectNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof JiraProjectDuplicateError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof JiraProjectError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

async function deleteHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  const { id } = await params;
  await deleteJiraProject(id);
  return NextResponse.json({ deleted: true });
}

export const PUT = withRequestLog(putHandler);
export const DELETE = withRequestLog(deleteHandler);
