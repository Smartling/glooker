import { NextResponse } from 'next/server';
import { getLLMConfig, testLLMConnection } from '@/lib/llm-config/service';

export async function GET() {
  return NextResponse.json(getLLMConfig());
}

export async function POST() {
  return NextResponse.json(await testLLMConnection());
}
