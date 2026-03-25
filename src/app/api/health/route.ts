import { NextResponse } from 'next/server';

export async function GET() {
  // npm_package_version is set automatically when started via `npm start`.
  // If started directly (e.g., `node server.js`), falls back to 'unknown'.
  return NextResponse.json({
    status: 'ok',
    version: process.env.npm_package_version || 'unknown',
  });
}
