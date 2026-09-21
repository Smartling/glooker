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

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner',
    // Mastra pulls server-only native/dynamic deps that the bundler must not inline
    '@mastra/core', '@mastra/mcp', '@mastra/memory', '@mastra/libsql', '@libsql/client'],
  outputFileTracingIncludes: {
    '/**': ['./prompts/**'],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
