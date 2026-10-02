import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const pkg = require('./package.json');

let commitSha = process.env.COMMIT_SHA || '';
if (!commitSha) {
  try {
    commitSha = execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    // git not available (e.g., Docker build without .git)
  }
}


/**
 * Response security headers. The app previously set none at all: no CSP, HSTS,
 * X-Frame-Options, nosniff or Referrer-Policy.
 *
 * Individually minor; together they were the layers that would have contained
 * the stored-XSS sinks (four `dangerouslySetInnerHTML` call sites fed by LLM
 * output) and the UI-redress variant of the missing CSRF defence.
 *
 * CSP notes specific to this app:
 *   - 'unsafe-inline' is required in style-src: Recharts emits inline styles and
 *     components/charts/chart.tsx injects a <style> block of CSS variables.
 *   - img-src must allow avatars.githubusercontent.com — developer_stats
 *     .avatar_url is rendered throughout the dashboards.
 *   - script-src is 'self' with no 'unsafe-inline', which is what actually
 *     blocks an injected handler. Deploy in report-only first if you are unsure:
 *     swap the key for 'Content-Security-Policy-Report-Only'.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner'],
  outputFileTracingIncludes: {
    '/**': ['./prompts/**'],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
