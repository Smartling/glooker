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
  // The search string lives in a store read through useSyncExternalStore, so a component that
  // renders before its subscription is attached still sees every later change. Like the real
  // next/navigation, the router object and its methods are stable for the life of the mock, and
  // useSearchParams returns the same URLSearchParams until the search string changes.
  let currentSearch = initialSearch;
  const listeners = new Set<() => void>();
  const calls: NavCall[] = [];
  const notify = () => listeners.forEach(l => l());
  const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => { listeners.delete(l); };
  };
  const getSearch = () => currentSearch;
  const navigate = (kind: NavCall['kind'], url: string, opts?: unknown) => {
    calls.push({ kind, url, opts });
    currentSearch = url.includes('?') ? url.split('?')[1] : '';
    notify();
  };
  const router = {
    push: (url: string, opts?: unknown) => navigate('push', url, opts),
    replace: (url: string, opts?: unknown) => navigate('replace', url, opts),
  };
  return {
    useRouter: () => router,
    useSearchParams: () => {
      const search = React.useSyncExternalStore(subscribe, getSearch, getSearch);
      return React.useMemo(() => new URLSearchParams(search), [search]);
    },
    usePathname: () => '/vulnerabilities',
    __resetSearch: (qs: string) => { currentSearch = qs; calls.length = 0; notify(); },
    __calls: calls,
  };
}
