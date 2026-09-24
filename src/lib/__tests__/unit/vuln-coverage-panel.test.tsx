/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-coverage-panel.test.tsx
// the coverage panel's unmeasured list must tell a `dependabot-off` row
// apart from an `error` row — "Dependabot off" for the former, the GitHub detail for the latter.
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CoveragePanel from '@/app/vulnerabilities/coverage-panel';
import type { Coverage, CoverageRow } from '@/lib/vulnerabilities/aggregate';

const row = (over: Partial<CoverageRow> = {}): CoverageRow => ({
  repoId: 1, fullName: 'o/r1', serviceTier: 'production', codebaseType: 'backend', team: 'T1',
  openCritical: 1, openHigh: 0, detail: null, dependabotStatus: 'error', ...over,
});

it('shows "Dependabot off" for a dependabot-off row and the detail for an error row', () => {
  const coverage: Coverage = {
    needsTagging: [], excludedByPolicy: [],
    unmeasured: [
      row({ repoId: 1, fullName: 'o/off-repo', dependabotStatus: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' }),
      row({ repoId: 2, fullName: 'o/err-repo', dependabotStatus: 'error', detail: 'HTTP 500: mock status check failure' }),
    ],
  };
  render(<CoveragePanel coverage={coverage} />);
  fireEvent.click(screen.getByText(/Unmeasured/));
  expect(screen.getByText('Dependabot off')).toBeTruthy();
  expect(screen.getByText('HTTP 500: mock status check failure')).toBeTruthy();
  expect(screen.queryByText('Dependabot alerts are disabled for this repository.')).toBeNull();
});

// The "Unmeasured" list also holds dependabot-off rows, which aren't errors — the
// title said otherwise.
it('titles the unmeasured list "Unmeasured (Dependabot status error or off)"', () => {
  const coverage: Coverage = { needsTagging: [], excludedByPolicy: [], unmeasured: [] };
  render(<CoveragePanel coverage={coverage} />);
  expect(screen.getByText(/Unmeasured \(Dependabot status error or off\)/)).toBeTruthy();
});
