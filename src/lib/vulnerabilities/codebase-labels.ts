// Client-safe: no import of config.ts (which reads process.env), so a page.tsx that only needs
// these two display constants doesn't pull server-only config parsing into the client bundle.
// codebase.ts re-exports both for server callers; every .tsx import should point here instead.
import type { CodebaseGroup } from './types';

export const CODEBASE_GROUPS: readonly CodebaseGroup[] = ['backend', 'frontend', 'shared', 'other', 'all'];
export const CODEBASE_LABELS: Record<CodebaseGroup, string> = {
  backend: 'Backend', frontend: 'Frontend', shared: 'Shared libraries', other: 'Other', all: 'All',
};
