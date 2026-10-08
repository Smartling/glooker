/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-security-header.test.tsx
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import SecurityHeader, { securityMeta, staleHours, ConfigErrorBanner, CoverageLine, type SecurityHeaderProps } from '@/app/vulnerabilities/security-header';
import { COVERAGE_LINE_MIN_H, COVERAGE_BADGE_SLOT_W, COVERAGE_EXCLUDED_SLOT_W, COVERAGE_TAGGING_SLOT_W, COVERAGE_RULE_PAD } from '@/app/vulnerabilities/dimensions';
import { unmeasuredBadgeText } from '@/app/vulnerabilities/labels';
import type { CoverageData, Slot } from '@/app/vulnerabilities/api-types';
import { summaryFixture, reposFixture, REPO_ROWS, repoRow, coverageFixture, coverageRow, slot, syncInfo } from '../support/security-fixtures';

const NOW = new Date('2026-09-23T12:00:00Z');
function props(over: Partial<SecurityHeaderProps> = {}): SecurityHeaderProps {
  return {
    summary: summaryFixture(),
    repos: slot(reposFixture(REPO_ROWS)),
    coverage: slot(coverageFixture()),
    codebase: 'backend', summaryStale: false, openDrawer: jest.fn(), now: NOW,
    ...over,
  };
}
const unmeasuredRow = coverageRow({ repoId: 9, openCritical: 4, detail: 'x' });

describe('securityMeta', () => {
  it('reads "<Codebase> · N <scope> repositories · N owning teams", with the scope label as data', () => {
    expect(securityMeta({ codebase: 'backend', scopeValue: 'production', repoCount: 11, teamCount: 4 }))
      .toBe('Backend · 11 production repositories · 4 owning teams · synced daily');
    expect(securityMeta({ codebase: 'all', scopeValue: 'live', repoCount: 3, teamCount: 2 })).toBe('All · 3 live repositories · 2 owning teams · synced daily');
  });
  it('uses singular forms for one', () => {
    expect(securityMeta({ codebase: 'shared', scopeValue: 'production', repoCount: 1, teamCount: 1 }))
      .toBe('Shared libraries · 1 production repository · 1 owning team · synced daily');
  });
  it('without counts (rows still loading) it is never empty and carries no number', () => {
    expect(securityMeta({ codebase: 'backend', scopeValue: 'production', repoCount: null, teamCount: null })).toBe('Backend · production repositories · synced daily');
  });
});

describe('staleHours', () => {
  it('is the whole hours since the last successful sync, never negative', () => {
    expect(staleHours('2026-09-21T18:00:00Z', NOW)).toBe(42);
    expect(staleHours('2026-09-23T11:30:00Z', NOW)).toBe(0);
    expect(staleHours('2026-09-24T00:00:00Z', NOW)).toBe(0);
  });
});

describe('SecurityHeader', () => {
  // Revert: drop the " · synced daily" ending from securityMeta: the line no longer matches the mockup's header.
  it('shows the title with the org, and the meta line from the repos rows and the scope value, ending "· synced daily"', () => {
    render(<SecurityHeader {...props()} />);
    expect(screen.getByText('Security · acme')).toBeTruthy();
    // REPO_ROWS: 4 repositories across 3 owning teams (Payments, Search, Platform).
    expect(screen.getByText('Backend · 4 production repositories · 3 owning teams · synced daily')).toBeTruthy();
  });

  it('counts Unassigned as an owning team: a repository with no team still counts toward the owning teams', () => {
    render(<SecurityHeader {...props({ repos: slot(reposFixture([...REPO_ROWS, repoRow('acme/orphan', 'Unassigned')])) })} />);
    // REPO_ROWS: 4 repositories across Payments, Search and Platform; the orphan adds a fifth repository and a fourth team.
    expect(screen.getByText('Backend · 5 production repositories · 4 owning teams · synced daily')).toBeTruthy();
  });

  // Revert: pass `repos.data` whatever `repos.stale` says: the previous codebase's counts appear under the new codebase's name.
  it('while the rows are the previous codebase\'s (stale) the line is the count-less form for the NEW codebase, never old counts under the new label', () => {
    const old = slot(reposFixture(REPO_ROWS, { codebase: 'frontend' }), { stale: true });
    render(<SecurityHeader {...props({ repos: old, codebase: 'backend' })} />);
    expect(screen.getByText('Backend · production repositories · synced daily')).toBeTruthy();
    expect(screen.getByTestId('security-header').textContent).not.toMatch(/\d+ production repositor/);
  });

  // Revert: label the line from the `codebase` prop while counting the slot's rows.
  it('the codebase label comes from the same response as the counts', () => {
    render(<SecurityHeader {...props({ repos: slot(reposFixture(REPO_ROWS, { codebase: 'frontend' })), codebase: 'backend' })} />);
    expect(screen.getByText('Frontend · 4 production repositories · 3 owning teams · synced daily')).toBeTruthy();
  });

  it('the scope label follows summary.scope.value', () => {
    render(<SecurityHeader {...props({ summary: summaryFixture({ scope: { property: 'service_tier', value: 'live' } }) })} />);
    expect(screen.getByText(/4 live repositories/)).toBeTruthy();
  });

  it('wraps PageHeader so its mb-6 does not stack on the page gap', () => {
    render(<SecurityHeader {...props()} />);
    expect(screen.getByTestId('security-header').className).toContain('[&>div]:mb-0');
  });

  it('shows the stale tag with the whole hours since the sync, and no tag when not stale', () => {
    const stale = syncInfo({ stale: true, lastSuccessfulAt: '2026-09-21T18:00:00Z' });
    const { rerender } = render(<SecurityHeader {...props({ summary: summaryFixture({ sync: stale }) })} />);
    expect(screen.getByTestId('stale-tag').textContent).toBe('▲ STALE · 42H');
    rerender(<SecurityHeader {...props()} />);
    expect(screen.queryByTestId('stale-tag')).toBeNull();
  });

  it('shows the failed-sync banner with a "!" icon and the first issue; it is not inside the meta paragraph', () => {
    const failed = syncInfo({ lastStatus: 'failed', issues: [{ kind: 'sync', message: 'token expired' }] });
    render(<SecurityHeader {...props({ summary: summaryFixture({ sync: failed }) })} />);
    const banner = screen.getByRole('alert');
    expect(banner.textContent).toContain('The latest sync failed; showing data from the last good sync.');
    expect(banner.textContent).toContain('token expired');
    expect(within(banner).getByText('!')).toBeTruthy();
    expect(banner.closest('p')).toBeNull();
  });

  // Revert: print `issues[0].message` unconditionally: an empty issue list leaves a trailing space and the word "undefined" is one refactor away.
  it('a failed sync with no issue message reads as the sentence alone, with no trailing space or "undefined"', () => {
    render(<SecurityHeader {...props({ summary: summaryFixture({ sync: syncInfo({ lastStatus: 'failed', issues: [] }) }) })} />);
    expect(screen.getByRole('alert').textContent).toBe('!The latest sync failed; showing data from the last good sync.');
  });

  it('no banner when the latest sync did not fail', () => {
    render(<SecurityHeader {...props()} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // Revert: pass `stale={false}` to DataFreshness: the label keeps its normal colour beside the STALE tag, and the mockup's amber stale line is gone.
  it('a stale sync turns the freshness label amber, and a fresh one leaves it grey', () => {
    const stale = syncInfo({ stale: true, lastSuccessfulAt: '2026-09-21T18:00:00Z' });
    const { rerender } = render(<SecurityHeader {...props({ summary: summaryFixture({ sync: stale }) })} />);
    expect(screen.getByText(/last successful sync/).className).toContain('text-amber-400');
    rerender(<SecurityHeader {...props()} />);
    const label = screen.getByText(/last successful sync/);
    expect(label.className).toContain('text-gray-500');
    expect(label.className).not.toContain('amber');
  });

  // Revert: render the tag as a child of PageHeader again (a row of its own under the freshness line): the header grows a row.
  it('the "▲ STALE · NH" tag sits on the freshness row (PageHeader\'s badges slot), next to the label, not in a row of its own', () => {
    const stale = syncInfo({ stale: true, lastSuccessfulAt: '2026-09-21T18:00:00Z' });
    render(<SecurityHeader {...props({ summary: summaryFixture({ sync: stale }) })} />);
    const tag = screen.getByTestId('stale-tag');
    const label = screen.getByText(/last successful sync/);
    // The label is wrapped by DataFreshness in one div; that div and the tag are siblings in the one freshness/badges row.
    expect(label.parentElement?.parentElement).toBe(tag.parentElement);
    expect(tag.className).toContain('whitespace-nowrap');
    // "Updating…" shares the row, after the tag.
    cleanup();
    render(<SecurityHeader {...props({ summary: summaryFixture({ sync: stale }), summaryStale: true })} />);
    expect(screen.getByTestId('stale-tag').parentElement).toBe(screen.getByText('Updating…').parentElement);
  });

  // Revert: put the arrow or the bordered variant back: it no longer matches the app's other secondary button ("Download PDF" on the org report).
  it('"Sync history" is the app\'s secondary button (filled gray-800, no border, no underline, no arrow, 28px: py-1.5 text-xs) linking to the sync list', () => {
    render(<SecurityHeader {...props()} />);
    const btn = screen.getByRole('link', { name: 'Sync history' });
    expect(btn.textContent).toBe('Sync history');
    expect(btn.getAttribute('href')).toBe('/reports?tab=syncs');
    const classes = btn.className.split(' ');
    for (const c of ['bg-gray-800', 'hover:bg-gray-700', 'text-gray-300', 'rounded-lg', 'px-3', 'py-1.5', 'text-xs', 'font-medium']) expect(classes).toContain(c);
    expect(classes).not.toContain('border');
    expect(classes).not.toContain('underline');
  });

  it('keeps the freshness label, the Sync history action and the Updating… indicator', () => {
    const { rerender } = render(<SecurityHeader {...props()} />);
    expect(screen.getByText(/last successful sync/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Sync history/ }).getAttribute('href')).toBe('/reports?tab=syncs');
    expect(screen.queryByText('Updating…')).toBeNull();
    rerender(<SecurityHeader {...props({ summaryStale: true })} />);
    expect(screen.getByText('Updating…')).toBeTruthy();
  });

  // Revert: drop the wrapper's border-t or its padding, or wrap the line in nothing (the line is then flush under the banner).
  it('the coverage line sits under a 1px divider with COVERAGE_RULE_PAD above it, and keeps its own minimum height', () => {
    render(<SecurityHeader {...props()} />);
    const wrap = screen.getByTestId('coverage-divider');
    expect(wrap.className.split(' ')).toEqual(expect.arrayContaining(['border-t', 'border-gray-800']));
    expect(wrap.style.paddingTop).toBe(`${COVERAGE_RULE_PAD}px`);
    expect(wrap.firstElementChild).toBe(screen.getByTestId('coverage-line'));
    expect(screen.getByTestId('coverage-line').style.minHeight).toBe(`${COVERAGE_LINE_MIN_H}px`);
  });

  it('renders the config-error banner under the header', () => {
    render(<SecurityHeader {...props({ summary: summaryFixture({ configErrors: [{ source: 'startup', variable: 'VULN_X', rule: 'VULN_X entry 1: bad' }] }) })} />);
    expect(screen.getByText('VULN_X entry 1: bad')).toBeTruthy();
  });
});

describe('CoverageLine', () => {
  it('keeps its 22px minimum height in every state: loading, error, loaded with the badge, loaded without it', () => {
    const states = [
      slot<CoverageData>(undefined),
      slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }),
      slot(coverageFixture({ unmeasured: [unmeasuredRow] })),
      slot(coverageFixture()),
    ];
    for (const s of states) {
      const { unmount } = render(<CoverageLine coverage={s} openDrawer={jest.fn()} />);
      expect(screen.getByTestId('coverage-line').style.minHeight).toBe(`${COVERAGE_LINE_MIN_H}px`);
      unmount();
    }
  });

  // Revert: render the two count spans only when `coverage.data` exists: the link after them jumps ~280px on first load and after an error.
  it('the excluded and need-tagging slots exist, empty, while the coverage is loading or has failed, so the link keeps its place', () => {
    const states = [
      slot<CoverageData>(undefined),
      slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }),
    ];
    const withData = render(<CoverageLine coverage={slot(coverageFixture())} openDrawer={jest.fn()} />);
    const childCount = screen.getByTestId('coverage-line').children.length;
    withData.unmount();
    for (const s of states) {
      const { unmount } = render(<CoverageLine coverage={s} openDrawer={jest.fn()} />);
      for (const [id, w] of [['coverage-excluded', COVERAGE_EXCLUDED_SLOT_W], ['coverage-tagging', COVERAGE_TAGGING_SLOT_W]] as const) {
        expect(screen.getByTestId(id).textContent).toBe('');
        expect(screen.getByTestId(id).style.width).toBe(`${w}px`);
      }
      // Same elements in the same order as the loaded line, bar the error text that replaces nothing.
      expect(screen.getByTestId('coverage-line').children.length - (s.errorText ? 1 : 0)).toBe(childCount);
      unmount();
    }
  });

  // Revert: render the badge only when the count is above zero (no slot): the items after it slide left and right.
  it('reserves the badge slot in every state, with its width fixed and hidden when there is nothing to show', () => {
    const states: Array<[Slot<CoverageData>, string]> = [
      [slot<CoverageData>(undefined), 'hidden'],
      [slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }), 'hidden'],
      [slot(coverageFixture()), 'hidden'],
      [slot(coverageFixture({ unmeasured: [unmeasuredRow] })), 'visible'],
    ];
    for (const [s, visibility] of states) {
      const { unmount } = render(<CoverageLine coverage={s} openDrawer={jest.fn()} />);
      const reserved = screen.getByTestId('coverage-badge-slot');
      expect(reserved.style.width).toBe(`${COVERAGE_BADGE_SLOT_W}px`);
      expect(reserved.style.visibility).toBe(visibility);
      unmount();
    }
  });

  // Revert: put `minWidth` back for `width` (a two-digit count then widens its slot and pushes the link), or drop `truncate` / the title.
  it('the excluded and needs-tagging counts sit in slots of a fixed width, whatever the counts; a longer text is cut, with its full text in the title', () => {
    for (const [excluded, tagging] of [[0, 0], [3, 1], [12, 11]]) {
      const { unmount } = render(<CoverageLine coverage={slot(coverageFixture({
        excludedByPolicy: Array.from({ length: excluded }, (_, i) => ({ ...unmeasuredRow, repoId: 100 + i })),
        needsTagging: Array.from({ length: tagging }, (_, i) => ({ ...unmeasuredRow, repoId: 200 + i })),
      }))} openDrawer={jest.fn()} />);
      for (const [id, w, text] of [
        ['coverage-excluded', COVERAGE_EXCLUDED_SLOT_W, `· ${excluded} excluded by policy`],
        ['coverage-tagging', COVERAGE_TAGGING_SLOT_W, `· ${tagging} need tagging`],
      ] as const) {
        const el = screen.getByTestId(id);
        expect(el.style.width).toBe(`${w}px`);
        expect(el.style.minWidth).toBe('');
        expect(el.textContent).toBe(text);
        expect(el.getAttribute('title')).toBe(text);
        expect(el.className.split(' ')).toEqual(expect.arrayContaining(['shrink-0', 'truncate']));
      }
      unmount();
    }
  });

  // Revert: put `bg-warn-bg` back for `vuln-hatch` on the badge: the header badge is then a flat wash, unlike every other unmeasured mark.
  it('the unmeasured badge is hatched like the unmeasured rows, truncates inside its fixed slot and carries its text as a title', () => {
    render(<CoverageLine coverage={slot(coverageFixture({ unmeasured: [unmeasuredRow] }))} openDrawer={jest.fn()} />);
    const badge = screen.getByRole('button', { name: unmeasuredBadgeText(1) });
    expect(badge.className.split(' ')).toEqual(expect.arrayContaining(['vuln-hatch', 'max-w-full']));
    expect(badge.className).not.toContain('bg-warn-bg');
    expect(badge.getAttribute('title')).toBe(unmeasuredBadgeText(1));
    expect((badge.firstElementChild as HTMLElement).className).toContain('truncate');
  });

  // Revert: ignore `coverage.stale`: the previous scope's counts look like the new scope's.
  it('dims the badge and both counts while the coverage is the previous scope\'s (stale), and not otherwise', () => {
    const loaded = coverageFixture({ unmeasured: [unmeasuredRow], excludedByPolicy: [{ ...unmeasuredRow, repoId: 1 }] });
    const { rerender } = render(<CoverageLine coverage={slot(loaded)} openDrawer={jest.fn()} />);
    for (const id of ['coverage-badge-slot', 'coverage-excluded', 'coverage-tagging']) expect(screen.getByTestId(id).style.opacity).toBe('');
    rerender(<CoverageLine coverage={slot(loaded, { stale: true })} openDrawer={jest.fn()} />);
    for (const id of ['coverage-badge-slot', 'coverage-excluded', 'coverage-tagging']) expect(screen.getByTestId(id).style.opacity).toBe('0.6');
  });

  it('shows the unmeasured badge only when there are unmeasured repositories, and opens the drawer from the clicked element', () => {
    const openDrawer = jest.fn();
    const { rerender } = render(<CoverageLine coverage={slot(coverageFixture({ unmeasured: [unmeasuredRow, { ...unmeasuredRow, repoId: 10 }] }))} openDrawer={openDrawer} />);
    const badge = screen.getByRole('button', { name: /unmeasured/ });
    // The one badge phrase: the Alerts strip and the team table print the same text.
    expect(badge.textContent).toBe(unmeasuredBadgeText(2));
    expect(badge.textContent).toBe('▲ 2 unmeasured repos');
    fireEvent.click(badge);
    expect(openDrawer).toHaveBeenCalledWith(badge);
    rerender(<CoverageLine coverage={slot(coverageFixture({ unmeasured: [unmeasuredRow] }))} openDrawer={openDrawer} />);
    expect(screen.getByRole('button', { name: /unmeasured/ }).textContent).toBe('▲ 1 unmeasured repo');
    rerender(<CoverageLine coverage={slot(coverageFixture())} openDrawer={openDrawer} />);
    expect(screen.queryByRole('button', { name: /unmeasured/ })).toBeNull();
  });

  // Revert: delete the "Coverage" label span, or make it lower-case text.
  it('starts with a "COVERAGE" section label (sentence case in the DOM, upper-cased by CSS), before the badge slot', () => {
    render(<CoverageLine coverage={slot(coverageFixture())} openDrawer={jest.fn()} />);
    const label = screen.getByText('Coverage');
    expect(label.className).toContain('uppercase');
    expect(screen.getByTestId('coverage-line').firstElementChild).toBe(label);
    expect(label.compareDocumentPosition(screen.getByTestId('coverage-badge-slot')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows the excluded and needs-tagging counts and a "Coverage & policy →" link that opens the drawer', () => {
    const openDrawer = jest.fn();
    render(<CoverageLine coverage={slot(coverageFixture({
      excludedByPolicy: [{ ...unmeasuredRow, repoId: 1 }, { ...unmeasuredRow, repoId: 2 }, { ...unmeasuredRow, repoId: 3 }],
      needsTagging: [{ ...unmeasuredRow, repoId: 4 }],
    }))} openDrawer={openDrawer} />);
    expect(screen.getByText('· 3 excluded by policy')).toBeTruthy();
    expect(screen.getByText('· 1 need tagging')).toBeTruthy();
    const link = screen.getByRole('button', { name: 'Coverage & policy →' });
    expect(link.className).toContain('underline');
    fireEvent.click(link);
    expect(openDrawer).toHaveBeenCalledWith(link);
  });

  it('a coverage error shows its text and keeps the link', () => {
    render(<CoverageLine coverage={slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false })} openDrawer={jest.fn()} />);
    expect(screen.getByText("Couldn't load coverage: boom")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Coverage & policy →' })).toBeTruthy();
  });
});

describe('ConfigErrorBanner (carried over)', () => {
  it('renders nothing when there are no errors', () => {
    const { container } = render(<ConfigErrorBanner errors={[]} />);
    expect(container.textContent).toBe('');
    const { container: c2 } = render(<ConfigErrorBanner errors={undefined} />);
    expect(c2.textContent).toBe('');
  });
  it('lists a startup entry\'s rule with no "clears after" text', () => {
    render(<ConfigErrorBanner errors={[{ source: 'startup', variable: 'VULN_X', rule: 'VULN_X entry 1: bad' }]} />);
    expect(screen.getByText('VULN_X entry 1: bad')).toBeTruthy();
    expect(screen.queryByText(/clears after/)).toBeNull();
  });
  // Revert: print `e.at` raw again: the line shows an ISO instant where every other date on the page reads "Sep 22".
  it('adds "clears after the next successful sync (as of <date>)" for a sync-sourced entry: a display date, the ISO instant in a title', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-01T00:00:00Z'));
    try {
      const { container } = render(<ConfigErrorBanner errors={[{ source: 'sync', variable: 'VULN_Y', rule: 'VULN_Y: unseen', at: '2026-09-22T06:00:00Z' }]} />);
      expect(container.textContent).toBe('VULN_Y: unseen — clears after the next successful sync (as of Sep 22)');
      expect(screen.getByText('Sep 22').getAttribute('title')).toBe('2026-09-22T06:00:00Z');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('a sync-sourced entry with no time reads without "(as of …)", and never prints "undefined"', () => {
    const { container } = render(<ConfigErrorBanner errors={[{ source: 'sync', variable: 'VULN_Y', rule: 'VULN_Y: unseen' }]} />);
    expect(container.textContent).toBe('VULN_Y: unseen — clears after the next successful sync');
  });
});
