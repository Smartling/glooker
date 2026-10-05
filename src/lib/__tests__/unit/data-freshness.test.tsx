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
  // GLOOK-59 final fix item 3: children get top spacing so a banner/notice doesn't sit flush
  // against the title row.
  expect(screen.getByText('banner').closest('.mt-3')).not.toBeNull();
});

it('bannerOnly renders just the failed banner, never the label — nothing at all when not failed', () => {
  const { rerender } = render(<DataFreshness {...base} bannerOnly />);
  expect(screen.queryByText(/last successful sync/)).toBeNull();
  rerender(<DataFreshness {...base} latestFailed failedDetail="token expired" bannerOnly />);
  expect(screen.getByText(/The latest sync failed\. token expired/)).toBeTruthy();
  expect(screen.queryByText(/last successful sync/)).toBeNull();
});

it('bannerOnly renders nothing for a historical snapshot (the historical notice, not a failed banner)', () => {
  const { container } = render(<DataFreshness {...base} historicalAt="2026-09-01T10:00:00Z" bannerOnly />);
  expect(container.textContent).toBe('');
});

// GLOOK-59 final fix item 2: PageHeader's badges row is `flex items-center gap-2` with no wrap, so
// a failed-run banner rendered inside that row (alongside other badges) gets squeezed rather than
// wrapping full-width. The fix: a label-only DataFreshness (`latestFailed={false}`) goes in
// `freshness` (shares the row with `badges`), and a second, `bannerOnly` DataFreshness goes in
// PageHeader `children` (rendered as its own block below the row).
it('keeps the failed-sync banner out of the badges row (PageHeader + split label/bannerOnly)', () => {
  render(
    <PageHeader
      title="Security · acme"
      freshness={<DataFreshness {...base} latestFailed={false} />}
      badges={<span data-testid="badge-row-marker">sync history →</span>}
    >
      <DataFreshness {...base} latestFailed failedDetail="token expired" bannerOnly />
    </PageHeader>,
  );
  const badgesRow = screen.getByTestId('badge-row-marker').closest('.flex.items-center.gap-2');
  expect(badgesRow).not.toBeNull();
  const banner = screen.getByText(/The latest sync failed\. token expired/);
  expect(badgesRow!.contains(banner)).toBe(false);
  // The label still renders, next to the badge, same as before.
  expect(screen.getByText('last successful sync Sep 28, 6:04 AM')).toBeTruthy();
});
