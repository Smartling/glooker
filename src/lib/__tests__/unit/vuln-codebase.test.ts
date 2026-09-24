import { codebaseGroupOf, inCodebaseView, isInScope } from '@/lib/vulnerabilities/codebase';
import type { CodebaseGroups } from '@/lib/vulnerabilities/types';

// codebaseGroupOf/isInScope now read the deployment-configured groups/in-scope
// value by default (getVulnConfig()), but every case here passes them explicitly instead of
// relying on env — so this file never needs process.env or __clearVulnConfigCache.
const GROUPS: CodebaseGroups = { backend: ['service', 'api'], frontend: ['web'], shared: ['library'] };

it('maps codebaseType to configured groups; an unlisted value is other; null is other', () => {
  expect(codebaseGroupOf('service', GROUPS)).toBe('backend');
  expect(codebaseGroupOf('api', GROUPS)).toBe('backend');
  expect(codebaseGroupOf('web', GROUPS)).toBe('frontend');
  expect(codebaseGroupOf('library', GROUPS)).toBe('shared');
  expect(codebaseGroupOf('mystery', GROUPS)).toBe('other');
  expect(codebaseGroupOf(null, GROUPS)).toBe('other');
});
it('all includes everything', () => {
  expect(inCodebaseView('web', 'all')).toBe(true);
  expect(inCodebaseView(null, 'all')).toBe(true);
  expect(inCodebaseView('web', 'backend')).toBe(false);
});
it('isInScope compares against the configured in-scope value, passed explicitly', () => {
  expect(isInScope('live', 'live')).toBe(true);
  expect(isInScope('production', 'live')).toBe(false);
  expect(isInScope(null, 'live')).toBe(false);
});
