/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-coverage-drawer.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import { renderHook, act } from '@testing-library/react';
import CoverageDrawer, { useCoverageDrawer, type CoverageDrawerProps } from '@/app/vulnerabilities/coverage-drawer';
import { DRAWER_W, DRAWER_MAX_W, Z } from '@/app/vulnerabilities/dimensions';
import type { CoverageData } from '@/app/vulnerabilities/api-types';
import { unmeasuredReason } from '@/app/vulnerabilities/labels';
import { coverageFixture, coverageRow as row, summaryFixture, slot } from '../support/security-fixtures';

function base(over: Partial<CoverageDrawerProps> = {}): CoverageDrawerProps {
  return {
    open: true, onClose: jest.fn(), opener: null,
    coverage: slot(coverageFixture()),
    summary: summaryFixture(),
    ...over,
  };
}

describe('dialog contract', () => {
  it('renders nothing and attaches no key listener while closed', () => {
    const add = jest.spyOn(document, 'addEventListener');
    render(<CoverageDrawer {...base({ open: false })} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
  });

  it('is a modal dialog labelled by its title, and focuses the close button on open', () => {
    render(<CoverageDrawer {...base()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = within(dialog).getByRole('heading', { name: 'Coverage & policy' });
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
  });

  it('is 460px wide, at most 92vw, above the sticky bar', () => {
    render(<CoverageDrawer {...base()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.width).toBe(`${DRAWER_W}px`);
    expect(dialog.style.maxWidth).toBe(DRAWER_MAX_W);
    const root = dialog.parentElement as HTMLElement;
    expect(root.style.zIndex).toBe(String(Z.drawer));
    expect(Z.drawer).toBeGreaterThan(Z.stickyBar);
  });

  it('Esc closes; the listener is attached only while open and removed on close', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    const onClose = jest.fn();
    const { rerender } = render(<CoverageDrawer {...base({ onClose })} />);
    const attached = add.mock.calls.filter(([type]) => type === 'keydown');
    expect(attached).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<CoverageDrawer {...base({ onClose, open: false })} />);
    const removed = remove.mock.calls.filter(([type]) => type === 'keydown');
    expect(removed).toHaveLength(1);
    expect(removed[0][1]).toBe(attached[0][1]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the backdrop and the × both close', () => {
    const onClose = jest.fn();
    render(<CoverageDrawer {...base({ onClose })} />);
    fireEvent.click(screen.getByTestId('drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('closing returns focus to the element that opened it', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<CoverageDrawer {...base({ opener })} />);
    expect(document.activeElement).not.toBe(opener);
    rerender(<CoverageDrawer {...base({ opener, open: false })} />);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('Tab from the last focusable wraps to the first; Shift+Tab from the first wraps to the last', () => {
    render(<CoverageDrawer {...base({ coverage: slot(coverageFixture({ needsTagging: [row({ repoId: 2, fullName: 'acme/ledger', openCritical: 1 })] })) })} />);
    const dialog = screen.getByRole('dialog');
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href]'));
    expect(focusables.length).toBeGreaterThan(1);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe('header', () => {
  // Revert: delete the subtitle.
  it('says which scope the drawer follows: the codebase, the owning team (or "all"), and that it follows the page filters', () => {
    const { rerender } = render(<CoverageDrawer {...base()} />);
    expect(screen.getByTestId('drawer-scope').textContent).toBe('Backend · Owning team: all · follows the page filters');
    rerender(<CoverageDrawer {...base({ summary: summaryFixture({ appliedFilters: { codebase: 'frontend', team: 'Payments', baseline: 'last' } }) })} />);
    expect(screen.getByTestId('drawer-scope').textContent).toBe('Frontend · Owning team: Payments · follows the page filters');
  });
});

describe('coverage groups', () => {
  it('an unmeasured row never shows its stored open count: the group says "open counts unknown"', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({ unmeasured: [row({ openCritical: 7, openHigh: 3 })] })),
    })} />);
    const unmeasured = screen.getByRole('region', { name: /^Unmeasured/ });
    expect(within(unmeasured).getByText('acme/legacy-batch')).toBeTruthy();
    expect(within(unmeasured).getByText('open counts unknown')).toBeTruthy();
    expect(unmeasured.textContent).not.toMatch(/\b7\b/);
    expect(unmeasured.textContent).not.toMatch(/\b3\b/);
    expect(within(unmeasured).getByRole('listitem').className).toContain('vuln-hatch');
    expect(within(unmeasured).getByText(/Their resolved alerts and measured history still count/)).toBeTruthy();
  });

  it('each group header reads its title, its repository count and a right-hand summary', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({
        unmeasured: [row({ repoId: 1 }), row({ repoId: 2, fullName: 'acme/other' })],
        needsTagging: [row({ repoId: 3, fullName: 'acme/untagged', openCritical: 2, openHigh: 1 }), row({ repoId: 4, fullName: 'acme/untagged-2', openCritical: 1 })],
        excludedByPolicy: [row({ repoId: 5, fullName: 'acme/staging-tools', serviceTier: 'staging', openCritical: 5 })],
      })),
    })} />);
    expect(screen.getByRole('region', { name: 'Unmeasured 2 repos' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Needs tagging 2 repos' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Excluded by policy 1 repo' })).toBeTruthy();
    expect(screen.getByTestId('coverage-group-unmeasured-summary').textContent).toBe('open counts unknown');
    expect(screen.getByTestId('coverage-group-needs-tagging-summary').textContent).toBe('3 open critical');
    expect(screen.getByTestId('coverage-group-excluded-by-policy-summary').textContent).toBe('5 open critical');
  });

  it('a dependabot-off row reads "Dependabot off" and an error row shows the GitHub detail, on the right of the row', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({
        unmeasured: [
          row({ repoId: 1, fullName: 'acme/off-repo', dependabotStatus: 'dependabot-off', detail: 'Dependabot alerts are disabled for this repository.' }),
          row({ repoId: 2, fullName: 'acme/err-repo', dependabotStatus: 'error', detail: 'HTTP 500: status check failed' }),
        ],
      })),
    })} />);
    expect(screen.getByText('Dependabot off').className).toContain('text-warn');
    expect(screen.getByText('HTTP 500: status check failed')).toBeTruthy();
    expect(screen.queryByText('Dependabot alerts are disabled for this repository.')).toBeNull();
    // The owning team rides on the left of the same row.
    expect(screen.getAllByText(/owning team Platform/)).toHaveLength(2);
  });

  it('uses the one unmeasured wording: the same text the Repositories band and the rail print', () => {
    const r = row({ dependabotStatus: 'error', detail: null });
    render(<CoverageDrawer {...base({ coverage: slot(coverageFixture({ unmeasured: [r] })) })} />);
    expect(screen.getByText(unmeasuredReason({ status: 'error', detail: null }))).toBeTruthy();
  });

  it('Needs tagging rows name what is missing and show their open counts; Excluded rows say why they are outside the scope', () => {
    render(<CoverageDrawer {...base({
      coverage: slot(coverageFixture({
        needsTagging: [row({ repoId: 3, fullName: 'acme/untagged', team: null, serviceTier: null, openCritical: 2, openHigh: 1 })],
        excludedByPolicy: [row({ repoId: 4, fullName: 'acme/staging-tools', serviceTier: 'staging', openCritical: 1, openHigh: 0 })],
      })),
    })} />);
    const tagging = screen.getByRole('region', { name: /^Needs tagging/ });
    expect(within(tagging).getByText('2 crit · 1 high')).toBeTruthy();
    expect(within(tagging).getByText(/Counted under “Unassigned”/)).toBeTruthy();
    expect(within(tagging).getByText('Missing: owning team, service tier')).toBeTruthy();
    const excluded = screen.getByRole('region', { name: /^Excluded by policy/ });
    expect(within(excluded).getByText('outside scope (staging)')).toBeTruthy();
    expect(within(excluded).getByText('1 crit · 0 high')).toBeTruthy();
    expect(within(excluded).getByText(/Not counted/)).toBeTruthy();
  });

  it('an empty group still renders, reading None', () => {
    render(<CoverageDrawer {...base()} />);
    for (const name of [/^Unmeasured/, /^Needs tagging/, /^Excluded by policy/]) {
      expect(within(screen.getByRole('region', { name })).getByText('None')).toBeTruthy();
    }
  });

  it('shows the load error and the loading state instead of the groups', () => {
    const { rerender } = render(<CoverageDrawer {...base({ coverage: slot<CoverageData>(undefined, { errorText: "Couldn't load coverage: boom", loading: false }) })} />);
    expect(screen.getByText("Couldn't load coverage: boom")).toBeTruthy();
    rerender(<CoverageDrawer {...base({ coverage: slot<CoverageData>(undefined, { loading: true }) })} />);
    expect(screen.getByText('Loading…')).toBeTruthy();
  });
});

describe('policy ("From deployment configuration")', () => {
  const value = (key: string) => screen.getByTestId(`policy-value-${key}`);

  // Revert: print the entry id and the open-ended window again, or fold the four rows into one run-on line.
  it('has four labelled rows: Critical SLA, High SLA, Resolved count and Scope, and prints no entry id and no pending badge', () => {
    render(<CoverageDrawer {...base({ summary: summaryFixture({ slaStatus: { critical: 'active', high: 'none' }, policy: [
      { id: 'critical-2020-01', severity: 'critical', days: 9, effectiveFrom: '2020-01-08', until: null, pending: false },
      { id: 'high-2099-01', severity: 'high', days: 12, effectiveFrom: '2099-01-01', until: null, pending: true },
    ] }) })} />);
    const policy = screen.getByRole('region', { name: /^Policy/ });
    expect(within(policy).getByText('From deployment configuration')).toBeTruthy();
    for (const label of ['Critical SLA', 'High SLA', 'Resolved count', 'Scope']) expect(within(policy).getByText(label)).toBeTruthy();
    expect(policy.textContent).not.toMatch(/critical-2020-01|high-2099-01|open-ended|pending|→/);
  });

  it('an active severity reads "N days · since <date>", a pending one "N days · starts <date>", with years for dates outside this one', () => {
    render(<CoverageDrawer {...base({ summary: summaryFixture({
      slaStatus: { critical: 'active', high: 'pending' },
      policy: [
        { id: 'critical-old', severity: 'critical', days: 14, effectiveFrom: '2019-06-01', until: '2020-01-07', pending: false },
        { id: 'critical-2020-01', severity: 'critical', days: 7, effectiveFrom: '2020-01-08', until: null, pending: false },
        { id: 'high-2099-01', severity: 'high', days: 12, effectiveFrom: '2099-01-01', until: null, pending: true },
      ],
    }) })} />);
    // The entry in force is the latest that has started, not the first listed.
    expect(value('critical').textContent).toBe('7 days · since Jan 8, 2020');
    expect(value('high').textContent).toBe('12 days · starts Jan 1, 2099');
  });

  it('a window of one day reads "1 day"', () => {
    render(<CoverageDrawer {...base({ summary: summaryFixture({ policy: [{ id: 'c', severity: 'critical', days: 1, effectiveFrom: '2020-01-08', until: null, pending: false }] }) })} />);
    expect(value('critical').textContent).toBe('1 day · since Jan 8, 2020');
  });

  it('a severity with no policy reads "No SLA policy yet"; the state is decided per severity, not once for the page', () => {
    render(<CoverageDrawer {...base()} />);
    expect(value('critical').textContent).toBe('9 days · since Jan 8, 2020');
    expect(value('high').textContent).toBe('No SLA policy yet');
    expect(value('high').className).not.toContain('text-red-400');
  });

  it('an unreadable policy reads the red "! Can\'t be read · check the SLA settings in the deployment config" on both severities, never "No SLA policy yet"', () => {
    render(<CoverageDrawer {...base({
      summary: summaryFixture({ slaPolicyInvalid: true, policy: [], slaStatus: { critical: 'none', high: 'none' } }),
    })} />);
    for (const sev of ['critical', 'high']) {
      expect(value(sev).textContent).toBe("! Can't be read · check the SLA settings in the deployment config");
      expect(value(sev).className).toContain('text-red-400');
    }
    expect(screen.queryByText('No SLA policy yet')).toBeNull();
  });

  it('Resolved count: "Since <date> · fixed + dismissed", "All time · fixed + dismissed", and a red message when the date is unreadable', () => {
    const { rerender } = render(<CoverageDrawer {...base()} />);
    expect(value('resolved').textContent).toBe('Since Jan 8, 2020 · fixed + dismissed');
    rerender(<CoverageDrawer {...base({ summary: summaryFixture({ resolvedSince: { date: null, invalid: false } }) })} />);
    expect(value('resolved').textContent).toBe('All time · fixed + dismissed');
    rerender(<CoverageDrawer {...base({ summary: summaryFixture({ resolvedSince: { date: null, invalid: true } }) })} />);
    expect(value('resolved').textContent).toMatch(/^! Can't be read/);
    expect(value('resolved').className).toContain('text-red-400');
  });

  it('Scope reads "<property> = <value>" from the summary', () => {
    const { rerender } = render(<CoverageDrawer {...base()} />);
    expect(value('scope').textContent).toBe('service_tier = production');
    rerender(<CoverageDrawer {...base({ summary: summaryFixture({ scope: { property: 'service_tier', value: 'live' } }) })} />);
    expect(value('scope').textContent).toBe('service_tier = live');
  });
});

describe('useCoverageDrawer', () => {
  it('opens with the given opener, keeps it through close, and falls back to the active element', () => {
    const { result } = renderHook(() => useCoverageDrawer());
    expect(result.current.open).toBe(false);
    const button = document.createElement('button');
    document.body.appendChild(button);
    act(() => result.current.openDrawer(button));
    expect(result.current.open).toBe(true);
    expect(result.current.opener).toBe(button);
    act(() => result.current.closeDrawer());
    expect(result.current.open).toBe(false);
    expect(result.current.opener).toBe(button);

    button.focus();
    act(() => result.current.openDrawer());
    expect(result.current.opener).toBe(button);
    button.remove();
  });
});

describe('light theme', () => {
  // Revert: give a row, a group or the footer the card-shell class: the light remap's border would resize it.
  it('only the dialog itself uses the card-shell class (bg-gray-900); the rows and groups use the chart surface', () => {
    const full = slot(coverageFixture({ unmeasured: [row({ repoId: 1 })], needsTagging: [row({ repoId: 2 })], excludedByPolicy: [row({ repoId: 3 })] }));
    render(<CoverageDrawer {...base({ coverage: full })} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('bg-gray-900');
    expect(dialog.querySelector('.bg-gray-900')).toBeNull();
  });
});
