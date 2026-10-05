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
 * The Content-Security-Policy is NOT set here: it carries a per-request nonce, so
 * src/proxy.ts sets it (see src/lib/csp.ts for why a static policy breaks hydration).
 */

const SECURITY_HEADERS = [
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
