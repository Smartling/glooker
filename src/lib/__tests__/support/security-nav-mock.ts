// src/lib/__tests__/support/security-nav-mock.ts
// A reactive stand-in for next/navigation. push/replace update the search string and re-render
// every component that called useSearchParams(), the same round trip the real router makes, and
// each call is recorded with its options so tests can assert push vs replace and `scroll: false`.
//
// Use it as:
//   jest.mock('next/navigation', () => require('../support/security-nav-mock').createNavigationMock());
//   const nav = () => jest.requireMock('next/navigation') as ReturnType<typeof createNavigationMock>;
//   nav().__resetSearch('team=Payments');   // call inside act() if a component is mounted
import React from 'react';

export interface NavCall { kind: 'push' | 'replace'; url: string; opts: unknown }

export function createNavigationMock(initialSearch = '') {
  let currentSearch = initialSearch;
  const listeners = new Set<() => void>();
  const calls: NavCall[] = [];
  const notify = () => listeners.forEach(l => l());
  const navigate = (kind: NavCall['kind'], url: string, opts?: unknown) => {
    calls.push({ kind, url, opts });
    currentSearch = url.includes('?') ? url.split('?')[1] : '';
    notify();
  };
  return {
    useRouter: () => ({
      push: (url: string, opts?: unknown) => navigate('push', url, opts),
      replace: (url: string, opts?: unknown) => navigate('replace', url, opts),
    }),
    useSearchParams: () => {
      const [, force] = React.useReducer((c: number) => c + 1, 0);
      React.useEffect(() => {
        listeners.add(force);
        return () => { listeners.delete(force); };
      }, []);
      return new URLSearchParams(currentSearch);
    },
    usePathname: () => '/vulnerabilities',
    __resetSearch: (qs: string) => { currentSearch = qs; calls.length = 0; notify(); },
    __calls: calls,
  };
}
