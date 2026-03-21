import { NextResponse } from 'next/server';
import { getAppConfig, testLLMConnection } from '@/lib/llm-config/service';

export async function GET() {
  return NextResponse.json(getAppConfig());
}

export async function POST() {
  return NextResponse.json(await testLLMConnection());
}
