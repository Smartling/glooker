import { findForeignResolved } from '@/lib/lockfile-registry';

const lock = (packages: Record<string, { resolved?: string; link?: boolean }>) => ({ lockfileVersion: 3, packages });

describe('findForeignResolved', () => {
  it('accepts a lockfile resolved entirely from the public registry', () => {
    expect(findForeignResolved(lock({
      '': {},
      'node_modules/zod': { resolved: 'https://registry.npmjs.org/zod/-/zod-4.6.5.tgz' },
    }))).toEqual([]);
  });

  it('reports every entry resolved from another registry', () => {
    expect(findForeignResolved(lock({
      'node_modules/zod': { resolved: 'https://internal.example/npm/zod/-/zod-4.6.5.tgz' },
      'node_modules/ok': { resolved: 'https://registry.npmjs.org/ok/-/ok-1.0.0.tgz' },
    }))).toEqual(['node_modules/zod -> https://internal.example/npm/zod/-/zod-4.6.5.tgz']);
  });

  it('ignores workspace / link entries and file: deps (real npm lockfile shapes)', () => {
    expect(findForeignResolved(lock({
      '': {},
      'node_modules/local': { resolved: 'packages/local', link: true },
      'node_modules/tarball': { resolved: 'file:../x.tgz' },
    }))).toEqual([]);
  });

  it('still checks git URLs', () => {
    expect(findForeignResolved(lock({
      'node_modules/g': { resolved: 'git+ssh://git@example.com/x.git#abc' },
    }))).toHaveLength(1);
  });

  it('treats a lookalike host as foreign', () => {
    expect(findForeignResolved(lock({
      'node_modules/x': { resolved: 'https://registry.npmjs.org.evil.example/x/-/x-1.0.0.tgz' },
    }))).toHaveLength(1);
  });

  it('rejects input that is not a lockfile', () => {
    expect(() => findForeignResolved({})).toThrow(/packages/);
  });

  it('passes on the repository lockfile itself', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    expect(findForeignResolved(require('../../../../package-lock.json'))).toEqual([]);
  });
});
