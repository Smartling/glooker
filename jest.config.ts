import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/lib'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(p-limit|yocto-queue|@octokit|universal-user-agent|before-after-hook)/)',
  ],
  collectCoverageFrom: [
    'src/lib/**/*.ts',
    '!src/lib/__tests__/**',
    '!src/lib/db/**',
  ],
  restoreMocks: true,
  clearMocks: true,
};

export default config;
