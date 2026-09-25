/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-policy-panel.test.tsx
// PolicyPanel takes resolvedSince: ResolvedSince (replacing startDate: string) and
// renders it through format.ts's resolvedCaption. This covers the three caption states — the other
// two places (TeamPivot, the KPI tile on vulnerabilities-content.tsx) are covered by
// vuln-team-pivot.test.tsx and vuln-content-resolved-caption.test.tsx respectively.
// Also covers `scope` (the "scope: <property> = <value>" caption) and `policyInvalid` (an
// invalid SLA policy must read as invalid, never as merely empty).
import React from 'react';
import { render, screen } from '@testing-library/react';
import PolicyPanel from '@/app/vulnerabilities/policy-panel';

const policy = [{ id: 'critical-2020-01', severity: 'critical', days: 9, effectiveFrom: '2020-01-08', until: null, pending: false }];
const scope = { property: 'service_tier', value: 'production' };

it('a real date renders "Resolved counted since <date>"', () => {
  render(<PolicyPanel policy={policy} resolvedSince={{ date: '2020-01-08', invalid: false }} highActive={false} scope={scope} policyInvalid={false} />);
  expect(screen.getByText(/Resolved counted since 2020-01-08/)).toBeTruthy();
});

it('date: null (VULN_RESOLVED_SINCE unset) renders "Resolved counted all time"', () => {
  render(<PolicyPanel policy={policy} resolvedSince={{ date: null, invalid: false }} highActive={false} scope={scope} policyInvalid={false} />);
  expect(screen.getByText(/Resolved counted all time/)).toBeTruthy();
});

it('invalid renders "Resolved counted since —"', () => {
  render(<PolicyPanel policy={policy} resolvedSince={{ date: null, invalid: true }} highActive={false} scope={scope} policyInvalid={false} />);
  expect(screen.getByText(/Resolved counted since —/)).toBeTruthy();
});

it('renders the scope caption from `scope`', () => {
  render(<PolicyPanel policy={policy} resolvedSince={{ date: '2020-01-08', invalid: false }} highActive={false} scope={scope} policyInvalid={false} />);
  expect(screen.getByText(/scope: service_tier = production/)).toBeTruthy();
});

describe('empty vs. invalid policy', () => {
  it('an empty (not invalid) policy shows "No SLA policy yet" — a new line', () => {
    render(<PolicyPanel policy={[]} resolvedSince={{ date: null, invalid: false }} highActive={false} scope={scope} policyInvalid={false} />);
    expect(screen.getByText('No SLA policy yet')).toBeTruthy();
  });

  it('an invalid policy shows the invalid text instead of "No SLA policy yet" — it must never read as merely empty', () => {
    render(<PolicyPanel policy={[]} resolvedSince={{ date: null, invalid: false }} highActive={false} scope={scope} policyInvalid={true} />);
    expect(screen.getByText('SLA policy configuration is invalid — see the error above')).toBeTruthy();
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  it('a non-empty policy shows neither the empty nor the invalid line', () => {
    render(<PolicyPanel policy={policy} resolvedSince={{ date: '2020-01-08', invalid: false }} highActive={false} scope={scope} policyInvalid={false} />);
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
    expect(screen.queryByText(/SLA policy configuration is invalid/)).toBeNull();
  });

  it('an invalid policy hides "high · SLA not yet active" — an invalid policy must never read as a real figure', () => {
    render(<PolicyPanel policy={[]} resolvedSince={{ date: null, invalid: false }} highActive={false} scope={scope} policyInvalid={true} />);
    expect(screen.queryByText(/high · SLA not yet active/)).toBeNull();
  });
});
