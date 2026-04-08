import type { NextConfig } from 'next';
import { execSync } from 'child_process';

const pkg = require('./package.json');

let commitSha = '';
try {
  commitSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // git not available (e.g., Docker build without .git)
}

const nextConfig: NextConfig = {
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner'],
  outputFileTracingIncludes: {
    '/**': ['./prompts/**'],
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_COMMIT_SHA: commitSha,
  },
};

export default nextConfig;
