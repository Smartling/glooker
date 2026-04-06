import { NextResponse } from 'next/server';

export async function GET() {
  const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

  // GitHub check (non-blocking — failure doesn't affect overall status)
  try {
    const start = Date.now();
    const res = await fetch('https://api.github.com/rate_limit', {
      headers: process.env.GITHUB_TOKEN
        ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
        : {},
      signal: AbortSignal.timeout(5000),
    });
    checks.github = {
      status: res.ok ? 'ok' : 'degraded',
      latencyMs: Date.now() - start,
      ...(res.ok ? {} : { error: `HTTP ${res.status}` }),
    };
  } catch (err) {
    checks.github = {
      status: 'unreachable',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version || 'unknown',
    checks,
  });
}
