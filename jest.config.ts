import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/lib'],
  setupFiles: ['<rootDir>/src/lib/__tests__/setup/resize-observer.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json' }],
    // `jose` (pulled in by src/lib/auth.ts) is ESM-only and ships no CJS build,
    // so its .js files have to be transformed too — hence the allowJs override
    // here and the `jose` entry in transformIgnorePatterns below. Without both,
    // every suite that touches auth dies with "Cannot use import statement
    // outside a module" pointing at jose/dist/webapi/index.js, which reads like
    // a transform-config problem rather than an ESM one.
    '^.+\\.m?js$': ['ts-jest', {
      tsconfig: { allowJs: true, module: 'commonjs', target: 'es2022', esModuleInterop: true, isolatedModules: true },
    }],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(p-limit|yocto-queue|@octokit|universal-user-agent|before-after-hook|jose)/)',
  ],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    'src/hooks/**/*.ts',
    '!src/lib/__tests__/**',
    '!src/lib/db/**',
  ],
  restoreMocks: true,
  clearMocks: true,
};

export default config;
