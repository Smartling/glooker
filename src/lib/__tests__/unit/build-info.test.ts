import { getCommit, getVersion, getBuildInfo } from '@/lib/build-info';

const KEYS = ['COMMIT_SHA', 'NEXT_PUBLIC_COMMIT_SHA', 'NEXT_PUBLIC_APP_VERSION', 'npm_package_version'] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; } });
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

describe('build-info', () => {
  it('is "unknown" when nothing is set', () => {
    expect(getCommit()).toBe('unknown');
    expect(getVersion()).toBe('unknown');
  });
  it('uses the baked NEXT_PUBLIC_COMMIT_SHA', () => {
    process.env.NEXT_PUBLIC_COMMIT_SHA = 'b'.repeat(40);
    expect(getCommit()).toBe('b'.repeat(40));
  });
  it('prefers a runtime COMMIT_SHA', () => {
    process.env.COMMIT_SHA = 'a'.repeat(40);
    process.env.NEXT_PUBLIC_COMMIT_SHA = 'b'.repeat(40);
    expect(getCommit()).toBe('a'.repeat(40));
  });
  it('treats an empty baked sha as unknown', () => {
    process.env.NEXT_PUBLIC_COMMIT_SHA = '';
    expect(getCommit()).toBe('unknown');
  });
  it('version prefers the baked value, then npm_package_version', () => {
    process.env.npm_package_version = '1.0.0';
    expect(getVersion()).toBe('1.0.0');
    process.env.NEXT_PUBLIC_APP_VERSION = '2.0.0';
    expect(getBuildInfo()).toEqual({ commit: 'unknown', version: '2.0.0' });
  });
});
