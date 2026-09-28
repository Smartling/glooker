/** @jest-environment jsdom */
import React from 'react';
import { render, screen } from '@testing-library/react';
import DataFreshness from '@/components/runs/DataFreshness';
import PageHeader from '@/components/PageHeader';

const base = { label: 'last successful sync', at: '2026-09-28T10:04:00Z', stale: false, latestFailed: false, failedText: 'The latest sync failed.' };

it('shows the formatted time, amber when stale', () => {
  const { rerender } = render(<DataFreshness {...base} />);
  const el = screen.getByText('last successful sync Sep 28, 6:04 AM');
  expect(el.className).toContain('text-gray-500');
  rerender(<DataFreshness {...base} stale />);
  expect(screen.getByText('last successful sync Sep 28, 6:04 AM').className).toContain('text-amber-400');
});

it('shows the failed banner with detail', () => {
  render(<DataFreshness {...base} latestFailed failedDetail="token expired" />);
  expect(screen.getByText(/The latest sync failed\. token expired/)).toBeTruthy();
});

it('on a historical report shows only the notice — no staleness, no failed banner', () => {
  const { container } = render(<DataFreshness {...base} stale latestFailed historicalAt="2026-09-01T10:00:00Z" />);
  expect(container.textContent).toContain('Viewing historical report from Sep 1, 2026 — not the latest report.');
  expect(container.textContent).not.toContain('last successful sync');
  expect(container.textContent).not.toContain('failed');
});

it('PageHeader renders title, meta, freshness, badges, actions and children', () => {
  render(<PageHeader title="acme" meta="30 days" freshness={<span>fresh</span>} badges={<span>badge</span>} actions={<button>PDF</button>}><p>banner</p></PageHeader>);
  for (const t of ['acme', '30 days', 'fresh', 'badge', 'PDF', 'banner']) expect(screen.getByText(t)).toBeTruthy();
});
