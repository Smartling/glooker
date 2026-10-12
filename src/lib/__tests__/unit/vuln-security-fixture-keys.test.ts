jest.mock('@octokit/rest', () => ({ Octokit: jest.fn() })); // queries -> scheduler -> github.ts
// src/lib/__tests__/unit/vuln-security-fixture-keys.test.ts
// The alerts route fixture echoes `appliedFilters` through its own key list. If the server's list grows
// or shrinks and the fixture's does not, every page test keeps passing against an echo the real route
// no longer sends. Pinned equal, in order.
import { ALERT_FILTER_KEYS } from '@/lib/vulnerabilities/queries';
import { ALERT_ECHO_KEYS } from '../support/security-fixtures';

it('the alerts fixture echoes exactly the keys the server echoes (queries.ts ALERT_FILTER_KEYS)', () => {
  expect([...ALERT_ECHO_KEYS]).toEqual([...ALERT_FILTER_KEYS]);
});
