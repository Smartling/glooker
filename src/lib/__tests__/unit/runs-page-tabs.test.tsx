/** @jest-environment jsdom */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// The brief's plain-closure mock doesn't trigger a re-render on navigation (calling router.replace
// mutates a module-level variable that no component subscribes to). useUrlState relies on
// useSearchParams changing so the tab switch actually shows the new pane — so this mock backs
// useSearchParams with real React state that useRouter's replace updates (same approach as
// url-state-hook.test.ts's renderHook-based coverage, adapted for a full component render).
jest.mock('next/navigation', () => {
  const React = require('react');
  let current = new URLSearchParams();
  let setCurrent: ((p: URLSearchParams) => void) | null = null;
  return {
    useSearchParams: () => {
      const [params, setParams] = React.useState(current);
      setCurrent = setParams;
      return params;
    },
    useRouter: () => ({
      replace: (u: string) => {
        current = new URLSearchParams(u.split('?')[1] ?? '');
        setCurrent?.(current);
      },
    }),
    usePathname: () => '/reports',
  };
});
jest.mock('@/app/auth-context', () => ({ useAuth: () => ({ canAct: true }) }));
jest.mock('@/app/reports/reports-tab', () => ({ __esModule: true, default: () => <div>REPORTS TAB</div> }));
jest.mock('@/app/reports/vulnerability-syncs-tab', () => ({ __esModule: true, default: () => <div>SYNCS TAB</div> }));
const swr = jest.fn();
jest.mock('swr', () => ({ __esModule: true, default: (...a: any[]) => swr(...a) }));

import ReportsTabs from '@/app/reports/reports-tabs';

it('shows only the reports tab when vulnerabilities are disabled', () => {
  swr.mockReturnValue({ data: { vulnerabilities: { enabled: false } } });
  render(<ReportsTabs />);
  expect(screen.getByText('REPORTS TAB')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Dependabot alerts/ })).toBeNull();
});

it('switches tabs when vulnerabilities are enabled', async () => {
  swr.mockReturnValue({ data: { vulnerabilities: { enabled: true } } });
  render(<ReportsTabs />);
  expect(screen.getByText('REPORTS TAB')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Dependabot alerts/ }));
  await waitFor(() => expect(screen.getByText('SYNCS TAB')).toBeTruthy());
});
