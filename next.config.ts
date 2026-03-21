import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['mysql2', 'better-sqlite3', 'croner'],
  outputFileTracingIncludes: {
    '/**': ['./prompts/**'],
  },
};

export default nextConfig;
