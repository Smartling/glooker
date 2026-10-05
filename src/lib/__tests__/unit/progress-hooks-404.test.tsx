/** @jest-environment jsdom */
// PR #77 review: a progress poll that 404s (the report or sync no longer exists) must stop
// retrying instead of polling every 1.5s forever.
import React from 'react';
import { render, act } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useReportProgress } from '@/app/reports/use-report-progress';

function Probe({ id }: { id: string }) {
  useReportProgress(id, true, () => {});
  return null;
}

it('useReportProgress stops polling after a 404', async () => {
  jest.useFakeTimers();
  const fetchMock = jest.fn(() => Promise.resolve({ ok: false, status: 404, json: async () => ({ error: 'Report not found' }) }));
  (global as any).fetch = fetchMock;
  render(<SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}><Probe id="gone" /></SWRConfig>);
  await act(async () => { await Promise.resolve(); });
  const afterFirst = fetchMock.mock.calls.length;
  expect(afterFirst).toBeGreaterThanOrEqual(1);
  await act(async () => { jest.advanceTimersByTime(10_000); await Promise.resolve(); });
  expect(fetchMock.mock.calls.length).toBe(afterFirst);
  jest.useRealTimers();
});
