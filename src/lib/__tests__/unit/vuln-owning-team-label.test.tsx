/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-owning-team-label.test.tsx
// GLOOK-59 Task 9: the vulnerability repo "team" custom property is relabeled "Owning team" so
// it isn't confused with a Glooker (people) team — the team table's header (now covered by
// vuln-team-table.test.tsx) and AlertsTable's dropdown (still here until it is replaced).
import React from 'react';
import { render, screen } from '@testing-library/react';
import AlertsTable from '@/app/vulnerabilities/alerts-table';
import { listAlerts } from '@/lib/vulnerabilities/aggregate';

const R = (repoId: number, team: string) => ({ repoId, fullName: `o/r${repoId}`, team, serviceTier: 'production', codebaseType: 'backend', archived: false, dependabotStatus: 'ok', dependabotStatusDetail: null }) as any;
const A = (repoId: number, n: number, over: any = {}) => ({ repoId, number: n, htmlUrl: `u${repoId}${n}`, state: 'open', severity: 'critical', severityChangedAt: null, ghsaId: `G${n}`, cveId: `CVE-${repoId}${n}`, summary: null, cvssScore: 9, epssPercentage: null, withdrawn: false, packageName: 'pkg', ecosystem: 'npm', manifestPath: 'm', relationship: 'direct', scope: null, createdAt: '2026-09-01T00:00:00Z', resolvedAt: null, dismissedReason: null, reopenedCount: 0, lastReopenedAt: null, missing: false, ...over });
const F = { state: 'open' as const, overdue: false, dueSoon: false, reopened: false, runtimeOnly: false, q: '', repo: null as string | null };

it('AlertsTable\'s team dropdown is labeled "Owning team" with an "All owning teams" option', () => {
  const { rows: alertRows, totalCount, truncated } = listAlerts([A(1, 1)], [R(1, 'TeamA')], { codebase: 'backend', state: 'open' }, new Date('2026-09-22T00:00:00Z'));
  render(<AlertsTable rows={alertRows} totalCount={totalCount} truncated={truncated} filters={F} onFiltersChange={() => {}}
    team={null} teams={['TeamA']} onTeamChange={() => {}} />);
  const select = screen.getByLabelText('Owning team') as HTMLSelectElement;
  expect(select).toBeTruthy();
  expect(screen.getByText('All owning teams')).toBeTruthy();
});
