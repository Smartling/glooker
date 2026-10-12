/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-view-props.test.tsx
// viewProps() is the props builder every Wave 3 and Wave 4 slot test starts from, so it is pinned
// against the real hooks: a builder that lacked a member the hooks return would let a slot test pass
// against a shape the page never gives it.
import { render, renderHook, screen } from '@testing-library/react';
import { useAlertList, useSecurityUrl } from '@/app/vulnerabilities/security-state';
import KpiTiles from '@/app/vulnerabilities/kpi-tiles';
import OwnershipCard from '@/app/vulnerabilities/ownership-card';
import TrendCard from '@/app/vulnerabilities/trend-card';
import AlertsStrip from '@/app/vulnerabilities/alerts-strip';
import RepoRail from '@/app/vulnerabilities/repo-rail';
import AlertList from '@/app/vulnerabilities/alert-list';
import { viewProps } from '../support/security-fixtures';

jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());

describe('viewProps', () => {
  it('has exactly the url and list members the real hooks return', () => {
    const url = renderHook(() => useSecurityUrl()).result.current;
    const list = renderHook(() => useAlertList({ codebase: 'backend', team: null, repo: null, severity: 'both' })).result.current;
    const p = viewProps();
    expect(Object.keys(p.url).sort()).toEqual(Object.keys(url).sort());
    expect(Object.keys(p.list).sort()).toEqual(Object.keys(list).sort());
  });

  it('every handler is a jest mock, so a test can assert a call without a router or a hook', () => {
    const p = viewProps();
    const handlers = [...Object.values(p.url), ...Object.values(p.list), p.openDrawer].filter(v => typeof v === 'function');
    expect(handlers.length).toBeGreaterThan(15);
    for (const h of handlers) expect(jest.isMockFunction(h)).toBe(true);
  });

  it('an override replaces one member and leaves the rest of the healthy defaults', () => {
    const openDrawer = jest.fn();
    const p = viewProps({ openDrawer });
    expect(p.openDrawer).toBe(openDrawer);
    expect(p.summary.org).toBe('acme');
    expect(p.data.repos.data?.rows.length).toBeGreaterThan(0);
    expect(p.list.list.page).toBe(1);
  });

  it('every slot module accepts it and renders its test id', () => {
    render(<>
      <KpiTiles {...viewProps()} /><OwnershipCard {...viewProps()} /><TrendCard {...viewProps()} />
      <AlertsStrip {...viewProps()} /><RepoRail {...viewProps()} /><AlertList {...viewProps()} />
    </>);
    for (const id of ['kpi-tiles', 'ownership-card', 'trend-card', 'alerts-strip', 'repo-rail', 'alert-list']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });
});
