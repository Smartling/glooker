import { NextResponse } from 'next/server';
import { listOrgs } from '@/lib/orgs/service';

export async function GET() {
  try {
    return NextResponse.json(await listOrgs());
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
