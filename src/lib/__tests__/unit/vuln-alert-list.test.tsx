/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-alert-list.test.tsx
// The Alerts view's list column. Replaces vuln-alerts-table.test.tsx: the rows, the fixed
// geometry, the toolbar (search debounce and flush, Status, four toggles), the sort headers, the
// stale / error / not-found branches, and the page clamp.
import React from 'react';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import AlertList, {
  ALERT_COLUMN_CHROME_H, ALERT_COLUMN_PAD, ALERT_DUE_MIN_W, ALERT_GRID_COLS, ALERT_HEAD_H, SEARCH_DEBOUNCE_MS, SORT_ARROW, noSlaHint,
} from '@/app/vulnerabilities/alert-list';
import { PAGER_H } from '@/app/vulnerabilities/pager';
import { ALERTS_CARD_H, ALERT_LIST_H, ALERT_ROW_H, RAIL_W } from '@/app/vulnerabilities/dimensions';
import {
  ALERT_SORT_FIRST_DIR, DEFAULT_ALERT_LIST, sanitiseAlertList, useAlertList, type AlertListState,
} from '@/app/vulnerabilities/security-state';
import { anySlaActive } from '@/app/vulnerabilities/sla-state';
import { REFRESH_FAILED_NOTE, UNAVAILABLE_TEXT } from '@/app/vulnerabilities/slot-view';
import type { AlertsData } from '@/app/vulnerabilities/api-types';
import type { SecurityViewProps } from '@/app/vulnerabilities/view-props';
import { ALERT_SORT_KEYS } from '@/lib/vulnerabilities/alert-sort';
import {
  viewProps, slot, alertsFixture, alAlertRow, alAlertRows, alSummary, AL_OVERDUE_ROW, AL_RESOLVED_ROW, type AlSlaKind,
} from '../support/security-fixtures';

// Dates print through displayDate, whose "current year" is the clock's: pin it so the literal fixture dates read the same every year.
// (Date.now only: the search tests below use fake timers for setTimeout.)
let nowSpy: jest.SpyInstance;
beforeEach(() => { nowSpy = jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-30T12:00:00Z')); });
afterEach(() => { nowSpy.mockRestore(); });

const active = alSummary({ critical: 'active', high: 'active' });
const ERR = { loading: false, error: new Error('HTTP 500'), errorText: "Couldn't load alerts: HTTP 500" };
const noData = () => slot<AlertsData>(undefined, { loading: false });

/** Props with the given rows (and an optional total), list state, SLA states and data overrides. */
function props(opts: {
  rows?: AlertsData['rows']; total?: number; list?: Partial<AlertListState>; summary?: SecurityViewProps['summary'];
  alerts?: SecurityViewProps['data']['alerts']; data?: Partial<SecurityViewProps['data']>;
} = {}): SecurityViewProps {
  const base = viewProps({ summary: opts.summary ?? active });
  const rows = opts.rows ?? alAlertRows(10);
  return {
    ...base,
    list: { ...base.list, list: { ...DEFAULT_ALERT_LIST, ...(opts.list ?? {}) } },
    data: { ...base.data, alerts: opts.alerts ?? slot(alertsFixture(rows, opts.total ?? rows.length)), ...(opts.data ?? {}) },
  };
}
const rowsArea = () => screen.getByTestId('alert-list-rows');
/** The advisory id of a row: the link's visible text (its accessible name also carries "(opens in a new tab)"). */
const idOf = (row: HTMLElement) => within(row).getByRole('link').firstChild!.textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name });

/** The real controller wired into the list, so behaviour that lives in useAlertList shows through the UI. */
function Harness({ summary = active, onList, total }: { summary?: SecurityViewProps['summary']; onList?: (l: AlertListState) => void; total?: number }) {
  const ctl = useAlertList({ codebase: 'backend', team: null, repo: null, severity: 'both' });
  const effective = sanitiseAlertList(ctl.list, { anySlaActive: anySlaActive(summary) });
  onList?.(effective);
  const base = props({ summary, total });
  return <AlertList {...base} list={{ ...ctl, list: effective }} />;
}

describe('fixed geometry', () => {
  it('the list column chrome plus the 560px row area is exactly the 776px card', () => {
    expect(ALERT_COLUMN_CHROME_H + ALERT_LIST_H).toBe(ALERTS_CARD_H);
    expect(ALERT_LIST_H).toBe(10 * ALERT_ROW_H);
  });

  it.each([
    ['populated', props()],
    ['stale', props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true }) })],
    ['loading', props({ alerts: slot<AlertsData>(undefined) })],
    ['error', props({ alerts: slot<AlertsData>(undefined, ERR) })],
    ['refresh failed with rows', props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { error: new Error('x'), errorText: "Couldn't load alerts: x" }) })],
    ['empty', props({ rows: [], total: 0 })],
    ['repository not found', props({ alerts: noData(), data: { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']> })],
  ])('the %s list area is ALERT_LIST_H as an inline style, and the outer list sets no height', (_label, p) => {
    render(<AlertList {...p} />);
    expect(rowsArea().style.height).toBe(`${ALERT_LIST_H}px`);
    expect(screen.getByTestId('alert-list').style.height).toBe('');
    expect(screen.getByTestId('alert-pager').style.height).toBe(`${PAGER_H}px`);
    expect(screen.getByTestId('alert-list-head').style.height).toBe(`${ALERT_HEAD_H}px`);
  });

  it('the list area is the same DOM node, at its height, across loading, populated, error, empty and not-found renders', () => {
    const notFound = { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']>;
    const { rerender } = render(<AlertList {...props({ alerts: slot<AlertsData>(undefined) })} />);
    const area = rowsArea();
    for (const next of [
      props(), props({ alerts: slot<AlertsData>(undefined, ERR) }), props({ rows: [], total: 0 }),
      props({ alerts: noData(), data: notFound }), props({ alerts: slot<AlertsData>(undefined) }),
    ]) {
      rerender(<AlertList {...next} />);
      expect(rowsArea()).toBe(area);
      expect(area.style.height).toBe(`${ALERT_LIST_H}px`);
    }
  });

  it('every row is ALERT_ROW_H tall as an inline style and shares the header\'s grid', () => {
    render(<AlertList {...props()} />);
    const head = screen.getByTestId('alert-list-head');
    const rows = screen.getAllByTestId('alert-row');
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.style.height).toBe(`${ALERT_ROW_H}px`);
      expect(r.style.gridTemplateColumns).toBe(head.style.gridTemplateColumns);
    }
    expect(head.style.gridTemplateColumns).toBe(ALERT_GRID_COLS);
  });

  it('the Due track has a pixel minimum and every other track can shrink to 0, so the minimums fit at 1024px (fix 2 beyond the handoff)', () => {
    const tracks = ALERT_GRID_COLS.split(' ');
    expect(tracks).toHaveLength(6);
    expect(tracks[4]).toBe(`minmax(${ALERT_DUE_MIN_W}px,1fr)`);
    expect(ALERT_DUE_MIN_W).toBeGreaterThanOrEqual(110);
    // Sum what the tracks insist on: px tracks and minmax(Npx, …) minimums. minmax(0, …) insists on nothing.
    const insisted = tracks.reduce((sum, t) => {
      const px = /^(\d+)px$/.exec(t) ?? /^minmax\((\d+)px,/.exec(t);
      return sum + (px ? Number(px[1]) : 0);
    }, 0);
    // 1024px viewport: the page container's side padding (2 × 24), then the rail and the list column's own padding.
    const listWidth = 1024 - 2 * 24 - RAIL_W - 2 * ALERT_COLUMN_PAD.x;
    expect(listWidth).toBe(676);
    expect(insisted).toBeLessThanOrEqual(listWidth);
    expect(tracks.filter(t => t.startsWith('minmax(0,'))).toHaveLength(3);
  });

  it('the Age header drops its left padding, so "AGE ↕" fits the 52px Age track instead of ending in an ellipsis', () => {
    render(<AlertList {...props()} />);
    expect(ALERT_GRID_COLS.split(' ')[3]).toBe('52px');
    expect(screen.getByTestId('sort-age').className.split(/\s+/)).toContain('pl-0');
    expect(screen.getByTestId('sort-age').className.split(/\s+/)).not.toContain('px-2.5');
  });

  it('"Nd OVERDUE" is bold red, never clipped: no ellipsis, no overflow clip, no shrinking, in a cell that does not clip either', () => {
    render(<AlertList {...props({ rows: [AL_OVERDUE_ROW] })} />);
    const sub = screen.getByTestId('alert-due-sub');
    expect(sub.textContent).toBe('71d OVERDUE');
    const cls = sub.className.split(/\s+/);
    for (const c of ['text-red-400', 'font-bold', 'whitespace-nowrap', 'shrink-0']) expect(cls).toContain(c);
    for (const c of ['truncate', 'text-ellipsis', 'overflow-hidden']) expect(cls).not.toContain(c);
    expect(sub.parentElement!.className.split(/\s+/)).not.toContain('overflow-hidden');
    expect(sub.parentElement!.className.split(/\s+/)).not.toContain('truncate');
  });

  it('the Overdue figure sits in the same Due cell as a quiet sub-line would, so rows keep their height', () => {
    render(<AlertList {...props({ rows: [AL_OVERDUE_ROW, alAlertRow(5)] })} />);
    for (const r of screen.getAllByTestId('alert-row')) expect(r.style.height).toBe(`${ALERT_ROW_H}px`);
  });
});

describe('rows', () => {
  it('shows severity, a linked advisory with "CVSS · package", the repository over its owning team, age, due and state over scope', () => {
    render(<AlertList {...props({ rows: [AL_OVERDUE_ROW] })} />);
    const row = screen.getByTestId('alert-row');
    expect(within(row).getByText('CRIT')).toBeTruthy();
    const link = within(row).getByRole('link', { name: 'CVE-2026-43102 (opens in a new tab)' }) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe(AL_OVERDUE_ROW.htmlUrl);
    expect(link.target).toBe('_blank');
    expect(link.rel).toContain('noreferrer');
    expect(within(row).getByText('CVSS 9.1 · golang.org/x/net (go)')).toBeTruthy();
    const repo = within(row).getByText('checkout-api');
    expect(repo.getAttribute('title')).toBe('acme/checkout-api');
    expect(within(row).getByText('Payments')).toBeTruthy();
    expect(within(row).getByText('78d')).toBeTruthy();
    expect(screen.getByTestId('alert-due').textContent).toBe('Jul 21');
    expect(screen.getByTestId('alert-state').textContent).toBe('open');
    expect(within(row).getByText('runtime')).toBeTruthy();
  });

  it('a high alert wears the HIGH badge', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { severity: 'high' })] })} />);
    expect(screen.getByText('HIGH')).toBeTruthy();
    expect(screen.queryByText('CRIT')).toBeNull();
  });

  it('renders rows in the order the server sent them, whatever the active sort (the server sorts, the client does not)', () => {
    const rows = [alAlertRow(3, { ageDays: 5 }), alAlertRow(1, { ageDays: 90 }), alAlertRow(2, { ageDays: 40 })];
    render(<AlertList {...props({ rows, list: { sort: { key: 'age', dir: 'desc' } } })} />);
    const ids = screen.getAllByTestId('alert-row').map(idOf);
    expect(ids).toEqual(['CVE-2026-1003', 'CVE-2026-1001', 'CVE-2026-1002']);
  });

  it('every cell that can truncate carries its full text as a title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, {
      repo: 'acme/a-repository-with-a-very-long-name', team: 'A long owning team name', packageName: 'a-long-package-name', ecosystem: 'npm',
      state: 'dismissed', dismissedReason: 'no_bandwidth', resolvedAt: '2026-09-03T08:00:00Z', dueDate: null, daysRemaining: null,
    })], summary: alSummary({ critical: 'pending', high: 'pending' }) })} />);
    const row = screen.getByTestId('alert-row');
    expect(within(row).getByRole('link').getAttribute('title')).toBe('CVE-2026-1001');
    expect(within(row).getByText('CVSS 9.8 · a-long-package-name (npm)').getAttribute('title')).toBe('CVSS 9.8 · a-long-package-name (npm)');
    expect(within(row).getByText('a-repository-with-a-very-long-name').getAttribute('title')).toBe('acme/a-repository-with-a-very-long-name');
    expect(within(row).getByText('A long owning team name').getAttribute('title')).toBe('A long owning team name');
    expect(screen.getByTestId('alert-state').getAttribute('title')).toBe('dismissed (no_bandwidth), resolved 2026-09-03');
  });

  it('an open alert\'s state-message sub-line in the Due cell carries its text as a title', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'invalid', high: 'invalid' }), rows: [alAlertRow(1, { dueDate: null, daysRemaining: null })] })} />);
    expect(screen.getByTestId('alert-due-sub').getAttribute('title')).toBe("SLA policy can't be read");
  });

  it('a null package renders nothing, never the text "null", in the cell or its title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { packageName: null, ecosystem: 'npm' })] })} />);
    const row = screen.getByTestId('alert-row');
    expect(row.textContent).not.toContain('null');
    expect(row.innerHTML).not.toContain('null');
    expect(within(row).getByText('CVSS 9.8')).toBeTruthy();
  });

  it('no CVSS and no package leaves the sub-line blank with no title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { packageName: null, ecosystem: null, cvss: null })] })} />);
    const row = screen.getByTestId('alert-row');
    expect(row.textContent).not.toContain('CVSS');
    expect(row.querySelector('[title=""]')).toBeNull();
  });

  it('falls back from the CVE id to the GHSA id', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { cveId: null, ghsaId: 'GHSA-p3vc-6q8r-22jw' })] })} />);
    expect(screen.getByRole('link', { name: 'GHSA-p3vc-6q8r-22jw (opens in a new tab)' })).toBeTruthy();
  });

  it('the first row is the same DOM node across a rerender with different rows (rows are keyed by position)', () => {
    const { rerender } = render(<AlertList {...props({ rows: alAlertRows(3) })} />);
    const first = screen.getAllByTestId('alert-row')[0];
    rerender(<AlertList {...props({ rows: alAlertRows(5, { severity: 'high' }) })} />);
    expect(screen.getAllByTestId('alert-row')[0]).toBe(first);
  });

  it('the due date reads as a display date, with the ISO date in its title; an instant stays on its UTC day', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { dueDate: '2026-09-19', daysRemaining: 4 }), alAlertRow(2, { dueDate: '2025-12-31', daysRemaining: -273 })] })} />);
    const dues = screen.getAllByTestId('alert-due');
    expect(dues.map(e => e.textContent)).toEqual(['Sep 19', 'Dec 31, 2025']);
    expect(dues.map(e => e.getAttribute('title'))).toEqual(['2026-09-19', '2025-12-31']);
  });
});

describe('State column: line 1 is short, the dates ride in titles, line 2 is the scope', () => {
  const state = () => screen.getByTestId('alert-state');

  // Revert: put "↺ reopened {date}" back in the visible text (it was cut to "open · ↺ reopen…").
  it('an open alert that was reopened reads "open ↺"; the glyph carries the date in its aria-label and the cell in its title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { reopenedCount: 2, lastReopenedAt: '2026-08-14T10:30:00Z' })] })} />);
    expect(state().textContent).toBe('open');
    const glyph = screen.getByTestId('alert-reopened');
    expect(glyph.textContent).toBe('↺');
    expect(glyph.getAttribute('aria-label')).toBe('reopened Aug 14');
    expect(glyph.getAttribute('role')).toBe('img');
    expect(state().getAttribute('title')).toBe('open · reopened 2 times, last on 2026-08-14');
    expect(state().textContent).not.toMatch(/Aug|reopened/);
  });

  it('a reopened alert with no recorded date still shows the glyph, and its label says only "reopened"', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { reopenedCount: 1, lastReopenedAt: null })] })} />);
    expect(state().textContent).toBe('open');
    expect(screen.getByTestId('alert-reopened').getAttribute('aria-label')).toBe('reopened');
    expect(state().getAttribute('title')).toBe('open · reopened');
  });

  it('an alert that never reopened shows no glyph, even if a stale date is present', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { reopenedCount: 0, lastReopenedAt: '2026-08-14T10:30:00Z' })] })} />);
    expect(state().textContent).toBe('open');
    expect(screen.queryByTestId('alert-reopened')).toBeNull();
  });

  // Revert: print the resolved date or the state word in the visible line again.
  it('a resolved alert reads "resolved · <reason>" (no date on screen), with the dates in the title, and the glyph when it was reopened', () => {
    render(<AlertList {...props({ rows: [AL_RESOLVED_ROW] })} />);
    expect(state().textContent).toBe('resolved · fixed');
    expect(state().getAttribute('title')).toBe('fixed, resolved 2026-09-03 · reopened, last on 2026-08-14');
    expect(screen.getByTestId('alert-reopened').getAttribute('aria-label')).toBe('reopened Aug 14');
  });

  it('a dismissed alert reads "resolved · <its reason>", truncating at the cell edge, and names the dismissal and its date in the title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { state: 'dismissed', dismissedReason: 'no_bandwidth', resolvedAt: '2026-09-03T08:00:00Z', dueDate: null, daysRemaining: null })] })} />);
    expect(state().textContent).toBe('resolved · no bandwidth');   // the API token reads as words
    expect(state().className).toContain('truncate');
    expect(state().getAttribute('title')).toBe('dismissed (no_bandwidth), resolved 2026-09-03');
  });

  it('a dismissed alert with no reason reads "resolved · dismissed"', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { state: 'dismissed', dismissedReason: null, resolvedAt: null, dueDate: null, daysRemaining: null })] })} />);
    expect(state().textContent).toBe('resolved · dismissed');
    expect(state().getAttribute('title')).toBe('dismissed');
  });

  it('the scope sits under the state, and a missing scope reads "unknown"', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { scope: 'development' }), alAlertRow(2, { scope: null })] })} />);
    expect(screen.getByText('development')).toBeTruthy();
    expect(screen.getByText('unknown')).toBeTruthy();
  });
});

describe('Due column, per SLA state (alert-list consumer of sla-state)', () => {
  it('active: the date over "in Nd", "today" or "Nd OVERDUE"', () => {
    render(<AlertList {...props({ rows: [
      alAlertRow(1, { dueDate: '2026-09-19', daysRemaining: 4 }),
      alAlertRow(2, { dueDate: '2026-09-15', daysRemaining: 0 }),
      alAlertRow(3, { dueDate: '2026-09-10', daysRemaining: -5 }),
    ] })} />);
    const dues = screen.getAllByTestId('alert-due').map(e => e.textContent);
    const subs = screen.getAllByTestId('alert-due-sub').map(e => e.textContent);
    expect(dues).toEqual(['Sep 19', 'Sep 15', 'Sep 10']);
    expect(subs).toEqual(['in 4d', 'today', '5d OVERDUE']);
    expect(screen.getAllByTestId('alert-due')[2].className).toContain('text-red-400');
    expect(screen.getAllByTestId('alert-due')[0].className).not.toContain('text-red-400');
  });

  it.each<[AlSlaKind, string]>([
    ['pending', 'SLA starts Feb 1, 2099'],
    ['none', 'no SLA policy yet'],
    ['invalid', "SLA policy can't be read"],
  ])('%s: a dash over "%s", never a due date or an overdue count', (kind, message) => {
    render(<AlertList {...props({
      summary: alSummary({ critical: kind, high: kind }),
      rows: [alAlertRow(1, { dueDate: null, daysRemaining: null })],
    })} />);
    expect(screen.getByTestId('alert-due').textContent).toBe('—');
    expect(screen.getByTestId('alert-due-sub').textContent).toBe(message);
    expect(screen.getByTestId('alert-row').textContent).not.toMatch(/OVERDUE/);
  });

  it('each row follows ITS severity: critical active shows a date, high pending shows its state message', () => {
    render(<AlertList {...props({
      summary: alSummary({ critical: 'active', high: 'pending' }),
      rows: [alAlertRow(1, { severity: 'critical', dueDate: '2026-09-19', daysRemaining: 4 }), alAlertRow(2, { severity: 'high', dueDate: null, daysRemaining: null })],
    })} />);
    const dues = screen.getAllByTestId('alert-due').map(e => e.textContent);
    const subs = screen.getAllByTestId('alert-due-sub').map(e => e.textContent);
    expect(dues).toEqual(['Sep 19', '—']);
    expect(subs).toEqual(['in 4d', 'SLA starts Feb 1, 2099']);
  });

  it('a resolved alert has no due date: a dash, and whether it was fixed in time', () => {
    render(<AlertList {...props({ rows: [AL_RESOLVED_ROW, alAlertRow(3, { state: 'fixed', resolvedOnTime: false, resolvedDaysLate: 3, dueDate: null, daysRemaining: null })] })} />);
    expect(screen.getAllByTestId('alert-due').map(e => e.textContent)).toEqual(['—', '—']);
    expect(screen.getAllByTestId('alert-due-sub').map(e => e.textContent)).toEqual(['resolved on time', 'resolved 3d late']);
  });
});

describe('Overdue and Due ≤ 7d toggles: disabled with a hint while no SLA is active', () => {
  const timeToggles = () => [button('Overdue'), button('Due ≤ 7d')] as HTMLButtonElement[];

  it('every severity pending: both disabled, the hint reads "Due dates start <display date>"', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'pending', high: 'pending' }) })} />);
    for (const t of timeToggles()) { expect(t.disabled).toBe(true); expect(t.title).toBe('Due dates start Feb 1, 2099'); }
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe('Due dates start Feb 1, 2099');
  });

  it('pending beats none: with one severity pending and the other without a policy the hint names the start date', () => {
    expect(noSlaHint(alSummary({ critical: 'none', high: 'pending' }), '2026-09-30')).toBe('Due dates start Feb 1, 2099');
    // In the start date's own year it drops the year.
    expect(noSlaHint(alSummary({ critical: 'none', high: 'pending' }), '2099-01-05')).toBe('Due dates start Feb 1');
  });

  it('an empty policy with none everywhere reads "no SLA policy yet"', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'none', high: 'none' }) })} />);
    for (const t of timeToggles()) expect(t.disabled).toBe(true);
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe('no SLA policy yet');
  });

  it('an unreadable policy reads "SLA policy can\'t be read", never "no SLA policy yet"', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'invalid', high: 'invalid' }) })} />);
    for (const t of timeToggles()) expect(t.disabled).toBe(true);
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe("SLA policy can't be read");
    expect(screen.queryByText(/no SLA policy yet/i)).toBeNull();
  });

  it.each<[AlSlaKind, AlSlaKind]>([['active', 'active'], ['active', 'pending'], ['none', 'active'], ['pending', 'active']])(
    'critical %s, high %s: at least one SLA is active, so both are enabled and there is no hint', (critical, high) => {
      render(<AlertList {...props({ summary: alSummary({ critical, high }) })} />);
      for (const t of timeToggles()) { expect(t.disabled).toBe(false); expect(t.title).toBe(''); }
      expect(screen.queryByTestId('alert-sla-hint')).toBeNull();
    });

  it('a disabled toggle ignores clicks, and Reopened and Runtime only stay enabled', () => {
    const p = props({ summary: alSummary({ critical: 'none', high: 'none' }) });
    render(<AlertList {...p} />);
    fireEvent.click(button('Overdue'));
    fireEvent.click(button('Due ≤ 7d'));
    expect(p.list.toggleOverdue).not.toHaveBeenCalled();
    expect(p.list.toggleDueSoon).not.toHaveBeenCalled();
    fireEvent.click(button('Reopened'));
    fireEvent.click(button('Runtime only'));
    expect(p.list.toggleReopened).toHaveBeenCalledTimes(1);
    expect(p.list.toggleRuntimeOnly).toHaveBeenCalledTimes(1);
  });

  it('a toggle that is "on" in the state but disabled never reads as pressed', () => {
    render(<AlertList {...props({ summary: alSummary({ critical: 'none', high: 'none' }), list: { overdue: true } })} />);
    expect(button('Overdue').getAttribute('aria-pressed')).toBe('false');
  });

  // Revert: show the SLA hint only (`slaHint`): under Resolved the toolbar says nothing about why the toggles are off.
  it('Resolved disables both time toggles, and the toolbar hint says why in the toggles\' own words (grey, never an SLA state)', () => {
    render(<AlertList {...props({ list: { status: 'resolved' } })} />);
    for (const t of timeToggles()) { expect(t.disabled).toBe(true); expect(t.title).toBe('Resolved alerts have no due date'); }
    const hint = screen.getByTestId('alert-sla-hint');
    expect(hint.textContent).toBe('Resolved alerts have no due date');
    expect(hint.getAttribute('title')).toBe('Resolved alerts have no due date');
    expect(hint.className).toContain('text-gray-500');
  });

  it('Resolved wins over an SLA state in the hint: with no SLA yet it still says "no due date", not "no SLA policy yet"', () => {
    render(<AlertList {...props({ list: { status: 'resolved' }, summary: alSummary({ critical: 'invalid', high: 'invalid' }) })} />);
    expect(screen.getByTestId('alert-sla-hint').textContent).toBe('Resolved alerts have no due date');
    expect(screen.getByTestId('alert-sla-hint').className).not.toContain('text-red-400');
  });

  it('active toggles call their handlers', () => {
    const p = props();
    render(<AlertList {...p} />);
    fireEvent.click(button('Overdue'));
    fireEvent.click(button('Due ≤ 7d'));
    expect(p.list.toggleOverdue).toHaveBeenCalledTimes(1);
    expect(p.list.toggleDueSoon).toHaveBeenCalledTimes(1);
  });
});

describe('toggles and Status with the real list controller', () => {
  const pressed = (name: string) => button(name).getAttribute('aria-pressed');

  it('Overdue and Due ≤ 7d are mutually exclusive: turning one on turns the other off', () => {
    render(<Harness />);
    fireEvent.click(button('Overdue'));
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['true', 'false']);
    fireEvent.click(button('Due ≤ 7d'));
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['false', 'true']);
    fireEvent.click(button('Overdue'));
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['true', 'false']);
  });

  it('choosing Resolved disables the time toggles and clears whatever they were set to', () => {
    render(<Harness />);
    fireEvent.click(button('Overdue'));
    expect(pressed('Overdue')).toBe('true');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'resolved' } });
    expect((button('Overdue') as HTMLButtonElement).disabled).toBe(true);
    expect((button('Due ≤ 7d') as HTMLButtonElement).disabled).toBe(true);
    expect([pressed('Overdue'), pressed('Due ≤ 7d')]).toEqual(['false', 'false']);
    // Back to Open: still off, and enabled again.
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'open' } });
    expect((button('Overdue') as HTMLButtonElement).disabled).toBe(false);
    expect(pressed('Overdue')).toBe('false');
  });

  it('Reopened and Runtime only toggle independently of the time toggles', () => {
    render(<Harness />);
    fireEvent.click(button('Overdue'));
    fireEvent.click(button('Reopened'));
    fireEvent.click(button('Runtime only'));
    expect([pressed('Overdue'), pressed('Reopened'), pressed('Runtime only')]).toEqual(['true', 'true', 'true']);
    fireEvent.click(button('Reopened'));
    expect([pressed('Overdue'), pressed('Reopened'), pressed('Runtime only')]).toEqual(['true', 'false', 'true']);
  });

  it('no SLA active: nothing can turn a time toggle on', () => {
    render(<Harness summary={alSummary({ critical: 'none', high: 'none' })} />);
    fireEvent.click(button('Overdue'));
    expect(pressed('Overdue')).toBe('false');
  });

  it('Status offers Open, Resolved and Open + resolved and reports the choice', () => {
    const p = props();
    render(<AlertList {...p} />);
    const select = screen.getByLabelText('Status') as HTMLSelectElement;
    expect(Array.from(select.options).map(o => [o.value, o.textContent])).toEqual([
      ['open', 'Open'], ['resolved', 'Resolved'], ['all', 'Open + resolved'],
    ]);
    fireEvent.change(select, { target: { value: 'all' } });
    expect(p.list.setStatus).toHaveBeenCalledWith('all');
  });
});

describe('sort headers', () => {
  const HEAD_LABELS: Record<string, string> = { severity: 'Sev', advisory: 'Advisory', repo: 'Repository', age: 'Age', due: 'Due', state: 'State' };

  it('there is one sortable header per sort key the server accepts, in column order', () => {
    render(<AlertList {...props()} />);
    const heads = within(screen.getByTestId('alert-list-head')).getAllByRole('columnheader');
    expect(heads).toHaveLength(ALERT_SORT_KEYS.length);
    expect(heads.map(h => within(h).getByRole('button').getAttribute('data-testid'))).toEqual(
      ['severity', 'advisory', 'repo', 'age', 'due', 'state'].map(k => `sort-${k}`),
    );
    for (const k of ALERT_SORT_KEYS) expect(screen.getByTestId(`sort-${k}`).textContent).toContain(HEAD_LABELS[k]);
  });

  it.each(ALERT_SORT_KEYS.map(k => [k]))('clicking the %s header calls setSort with that key', key => {
    const p = props();
    render(<AlertList {...p} />);
    fireEvent.click(screen.getByTestId(`sort-${key}`));
    expect(p.list.setSort).toHaveBeenCalledWith(key);
  });

  // Revert: draw no header as active while sort is null (the default order then looks unexplained), or mark a header other than Due.
  it('with no sort the server\'s default order is drawn as "Due ↑": Due is the one active header, every other shows ↕', () => {
    render(<AlertList {...props()} />);
    for (const k of ALERT_SORT_KEYS) {
      const arrow = screen.getByTestId(`sort-arrow-${k}`);
      const head = screen.getByRole('columnheader', { name: new RegExp(HEAD_LABELS[k]) });
      if (k === 'due') {
        expect(arrow.textContent).toBe('↑');
        expect(arrow.className).toContain('text-accent-light');
        expect(head.getAttribute('aria-sort')).toBe('ascending');
      } else {
        expect(arrow.textContent).toBe(SORT_ARROW.none);
        expect(SORT_ARROW.none.replace('\uFE0E', '')).toBe('↕');
        expect(arrow.className).not.toContain('text-accent-light');
        expect(head.getAttribute('aria-sort')).toBe('none');
      }
    }
  });

  // Revert: draw Due ↑ under Resolved too (resolved alerts have no due date).
  it('under Resolved there is no due date, so no header is drawn as active until one is chosen', () => {
    render(<AlertList {...props({ list: { status: 'resolved' } })} />);
    for (const k of ALERT_SORT_KEYS) expect(screen.getByTestId(`sort-arrow-${k}`).textContent).toBe(SORT_ARROW.none);
  });

  // Revert: sort ascending on the first click (nothing would change on screen) — the controller rule is pinned in the hooks test.
  it('the first click on Due, with no header chosen, flips the drawn arrow to ↓ (real controller); the next click flips it back', () => {
    const seen: AlertListState[] = [];
    render(<Harness onList={l => seen.push(l)} />);
    expect(screen.getByTestId('sort-arrow-due').textContent).toBe('↑');
    fireEvent.click(screen.getByTestId('sort-due'));
    expect(seen[seen.length - 1].sort).toEqual({ key: 'due', dir: 'desc' });
    expect(screen.getByTestId('sort-arrow-due').textContent).toBe('↓');
    fireEvent.click(screen.getByTestId('sort-due'));
    expect(screen.getByTestId('sort-arrow-due').textContent).toBe('↑');
  });

  it.each([['asc', '↑', 'ascending'], ['desc', '↓', 'descending']] as const)(
    'the active header shows %s as %s in the accent colour and the others keep ↕', (dir, arrow, aria) => {
      render(<AlertList {...props({ list: { sort: { key: 'due', dir } } })} />);
      expect(screen.getByTestId('sort-arrow-due').textContent).toBe(arrow);
      expect(screen.getByTestId('sort-arrow-due').className).toContain('text-accent-light');
      expect(screen.getByRole('columnheader', { name: /Due/ }).getAttribute('aria-sort')).toBe(aria);
      expect(screen.getByTestId('sort-arrow-age').textContent).toBe(SORT_ARROW.none);
    });

  it('Age starts descending (oldest first), every other key ascending, and a second click reverses (real controller)', () => {
    const seen: AlertListState[] = [];
    render(<Harness onList={l => seen.push(l)} />);
    const last = () => seen[seen.length - 1].sort;
    fireEvent.click(screen.getByTestId('sort-age'));
    expect(last()).toEqual({ key: 'age', dir: ALERT_SORT_FIRST_DIR.age });
    expect(screen.getByTestId('sort-arrow-age').textContent).toBe('↓');
    fireEvent.click(screen.getByTestId('sort-age'));
    expect(screen.getByTestId('sort-arrow-age').textContent).toBe('↑');
    fireEvent.click(screen.getByTestId('sort-repo'));
    expect(last()).toEqual({ key: 'repo', dir: 'asc' });
    expect(screen.getByTestId('sort-arrow-repo').textContent).toBe('↑');
    expect(screen.getByTestId('sort-arrow-age').textContent).toBe(SORT_ARROW.none);
  });

  it('the Advisory, Repository and State headers carry their second line', () => {
    render(<AlertList {...props()} />);
    expect(screen.getByTestId('sort-advisory').textContent).toContain('CVSS · package');
    expect(screen.getByTestId('sort-repo').textContent).toContain('owning team');
    expect(screen.getByTestId('sort-state').textContent).toContain('scope');
  });
});

describe('search', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const type = (v: string) => fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: v } });
  const advance = (ms: number) => act(() => { jest.advanceTimersByTime(ms); });

  it('applies the typed text once, SEARCH_DEBOUNCE_MS after the last keystroke', () => {
    const p = props();
    render(<AlertList {...p} />);
    type('lod'); advance(SEARCH_DEBOUNCE_MS - 100);
    type('lodash'); advance(SEARCH_DEBOUNCE_MS - 1);
    expect(p.list.setQuery).not.toHaveBeenCalled();
    advance(1);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
  });

  it('a toggle clicked inside the debounce window applies the typed text first, once, and the timer then does nothing', () => {
    const p = props();
    render(<AlertList {...p} />);
    type('lodash');
    fireEvent.click(button('Reopened'));
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
    expect(p.list.toggleReopened).toHaveBeenCalledTimes(1);
    const q = (p.list.setQuery as jest.Mock).mock.invocationCallOrder[0];
    const t = (p.list.toggleReopened as jest.Mock).mock.invocationCallOrder[0];
    expect(q).toBeLessThan(t);
    advance(SEARCH_DEBOUNCE_MS * 3);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  // Revert: pass `onPage={p => ctl.setPage(p)}` straight through (no flush): the typed text is applied after the page, or never within the window.
  it('the pager flushes the typed text first, then pages: setQuery is called before setPage', () => {
    const p = props({ rows: alAlertRows(10), total: 26 });
    render(<AlertList {...p} />);
    type('lodash');
    fireEvent.click(button(/Next/));
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
    expect(p.list.setPage).toHaveBeenCalledWith(2);
    expect((p.list.setQuery as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((p.list.setPage as jest.Mock).mock.invocationCallOrder[0]);
    advance(SEARCH_DEBOUNCE_MS * 3);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  // Revert: as above. Without the flush the page moves to 2 now and the search lands later, so the user pages through the OLD query.
  it('with the real controller, Next inside the debounce window lands on page 1 of the new search (the search resets the page)', () => {
    const seen: AlertListState[] = [];
    render(<Harness onList={l => seen.push(l)} total={26} />);
    type('lodash');
    fireEvent.click(button(/Next/));
    expect(seen[seen.length - 1]).toMatchObject({ q: 'lodash', page: 1 });
    advance(SEARCH_DEBOUNCE_MS * 3);
    expect(seen[seen.length - 1]).toMatchObject({ q: 'lodash', page: 1 });
  });

  // Revert: send `typedRef.current` untrimmed: "lodash " and "lodash" become two searches (two requests), and a blank box sends a query of spaces.
  it('applies the search trimmed, and a box of only spaces applies nothing', () => {
    const p = props();
    render(<AlertList {...p} />);
    type('  lodash  '); advance(SEARCH_DEBOUNCE_MS);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenLastCalledWith('lodash');
    type('lodash   '); advance(SEARCH_DEBOUNCE_MS);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    type('    '); advance(SEARCH_DEBOUNCE_MS);
    expect(p.list.setQuery).toHaveBeenLastCalledWith('');
  });

  it.each([
    ['the Status select', () => fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'all' } })],
    ['a sort header', () => fireEvent.click(screen.getByTestId('sort-due'))],
    ['the Overdue toggle', () => fireEvent.click(button('Overdue'))],
  ])('%s clicked inside the window applies the typed text too', (_label, act_) => {
    const p = props();
    render(<AlertList {...p} />);
    type('semver');
    act_();
    expect(p.list.setQuery).toHaveBeenCalledWith('semver');
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it('a view switch (the list unmounts) inside the window applies the typed text instead of dropping it', () => {
    const p = props();
    const { unmount } = render(<AlertList {...p} />);
    type('lodash');
    unmount();
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
    advance(SEARCH_DEBOUNCE_MS * 3);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it('unmounting after the debounce already fired does not send the same text a second time', () => {
    const p = props();
    const { unmount } = render(<AlertList {...p} />);
    type('lodash'); advance(SEARCH_DEBOUNCE_MS);
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
    unmount();
    expect(p.list.setQuery).toHaveBeenCalledTimes(1);
  });

  it('unmounting with nothing typed, or with the text typed back to what it was, sends nothing', () => {
    const p = props({ list: { q: 'abc' } });
    const { unmount } = render(<AlertList {...p} />);
    expect((screen.getByLabelText('Search alerts') as HTMLInputElement).value).toBe('abc');
    type('abcd'); type('abc');
    unmount();
    expect(p.list.setQuery).not.toHaveBeenCalled();
  });

  it('starts from the list state\'s query, so coming back to the view shows what was applied', () => {
    render(<AlertList {...props({ list: { q: 'express' } })} />);
    expect((screen.getByLabelText('Search alerts') as HTMLInputElement).value).toBe('express');
  });

  it('the search box keeps its node, its focus and its typed text while the next page loads, goes stale or fails', () => {
    const p = props();
    const { rerender } = render(<AlertList {...p} />);
    const input = screen.getByLabelText('Search alerts') as HTMLInputElement;
    input.focus();
    type('lodash');
    const next = (alerts: SecurityViewProps['data']['alerts'], list: Partial<AlertListState> = {}) =>
      rerender(<AlertList {...props({ alerts, list })} />);
    next(slot<AlertsData>(undefined), { overdue: true });               // the new key has not resolved yet
    expect(screen.getByLabelText('Search alerts')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('lodash');
    next(slot(alertsFixture(alAlertRows(10), 26), { stale: true }));                // previous data while the new key loads
    expect(screen.getByLabelText('Search alerts')).toBe(input);
    expect(document.activeElement).toBe(input);
    next(slot<AlertsData>(undefined, ERR));                             // the request failed
    expect(screen.getByLabelText('Search alerts')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('lodash');
  });
});

describe('stale, loading and error', () => {
  it('stale: the row area dims and "Updating…" shows; the controls are not dimmed', () => {
    render(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true }) })} />);
    expect(rowsArea().className).toContain('opacity-60');
    expect(screen.getByText('Updating…')).toBeTruthy();
    for (const el of [screen.getByLabelText('Search alerts'), button('Overdue'), button('Reopened'), screen.getByTestId('sort-due')]) {
      for (let a: HTMLElement | null = el; a && a.getAttribute('data-testid') !== 'alert-list'; a = a.parentElement) {
        expect(a.className).not.toContain('opacity-60');
      }
    }
  });

  it('not stale: no dimming and no "Updating…"', () => {
    render(<AlertList {...props()} />);
    expect(rowsArea().className).not.toContain('opacity-60');
    expect(screen.queryByText('Updating…')).toBeNull();
  });

  // Slot-view rule (deviation from the brief, which let the error replace the rows): the slot's own rows win.
  it('stale data that also carries an error keeps its rows, dimmed, with "Updating…" and the refresh note (the slot-view rule)', () => {
    render(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true, error: new Error('x'), errorText: "Couldn't load alerts: x" }) })} />);
    expect(screen.getAllByTestId('alert-row')).toHaveLength(10);
    expect(rowsArea().className).toContain('opacity-60');
    expect(screen.getByText('Updating…')).toBeTruthy();
    expect(screen.getByTestId('alert-refresh-note').textContent).toBe(REFRESH_FAILED_NOTE);
    expect(screen.queryByText("Couldn't load alerts: x")).toBeNull();
  });

  it('loading reads "Loading…" with a blank pager, never a fake "0 alerts"', () => {
    render(<AlertList {...props({ alerts: slot<AlertsData>(undefined) })} />);
    expect(within(rowsArea()).getByText('Loading…')).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).not.toMatch(/alerts/);
    expect(screen.queryAllByTestId('alert-row')).toHaveLength(0);
  });

  it('an error replaces the rows with its text inside the list area and keeps every control mounted', () => {
    render(<AlertList {...props({ alerts: slot<AlertsData>(undefined, ERR) })} />);
    expect(within(rowsArea()).getByText("Couldn't load alerts: HTTP 500")).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByLabelText('Search alerts')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    for (const name of ['Overdue', 'Due ≤ 7d', 'Reopened', 'Runtime only']) expect(button(name)).toBeTruthy();
    for (const k of ALERT_SORT_KEYS) expect(screen.getByTestId(`sort-${k}`)).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).not.toMatch(/alerts/);
  });

  // Deviation from the brief ("an error wins over data still held"): under the slot-view rule own rows win over a failed refresh.
  it('a failed refresh of the same key keeps the rows (undimmed) and adds the red note in a reserved line; the error text stays out', () => {
    render(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(3), 3), { error: new Error('x'), errorText: "Couldn't load alerts: x" }) })} />);
    expect(screen.getAllByTestId('alert-row')).toHaveLength(3);
    expect(rowsArea().className).not.toContain('opacity-60');
    expect(screen.queryByText('Updating…')).toBeNull();
    const note = screen.getByTestId('alert-refresh-note');
    expect(note.textContent).toBe(REFRESH_FAILED_NOTE);
    expect(note.className).toContain('text-red-400');
    expect(note.getAttribute('title')).toBe("Couldn't load alerts: x");
    expect(screen.queryByText("Couldn't load alerts: x")).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // The note sits in the toolbar's fixed-height second row, so nothing else is moved by it.
    expect(note.closest('[data-testid="alert-toolbar-row2"]')).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).toContain('1–3 of 3 alerts');
  });

  it('with no failed refresh the note slot is empty, and the second toolbar row is the same fixed height either way', () => {
    const { rerender } = render(<AlertList {...props()} />);
    expect(screen.getByTestId('alert-refresh-note').textContent).toBe('');
    const row2 = screen.getByTestId('alert-toolbar-row2');
    expect(row2.style.height).toBe('32px');
    rerender(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(10), 10), { error: new Error('x'), errorText: "Couldn't load alerts: x" }) })} />);
    expect(screen.getByTestId('alert-toolbar-row2')).toBe(row2);
    expect(row2.style.height).toBe('32px');
    expect(rowsArea().style.height).toBe(`${ALERT_LIST_H}px`);
  });

  it('an unavailable answer reads its short message in the list area, never an endless "Loading…"', () => {
    render(<AlertList {...props({ alerts: slot<AlertsData>(undefined, { loading: false, unavailable: { available: false as const, reason: 'No sync yet' } }) })} />);
    expect(within(rowsArea()).getByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByTestId('alert-pager').textContent).not.toMatch(/alerts/);
  });

  it('an empty result reads "No alerts match these filters." with "0 alerts" in the pager', () => {
    render(<AlertList {...props({ rows: [], total: 0 })} />);
    expect(within(rowsArea()).getByText('No alerts match these filters.')).toBeTruthy();
    expect(screen.getByTestId('alert-pager').textContent).toContain('0 alerts · counted per Dependabot alert, not per CVE');
  });
});

describe('repository not found', () => {
  const notFound = () => props({
    alerts: noData(),
    data: { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']>,
  });

  it('shows "Repository not found · Show all repositories" inside the list area, with the controls still mounted', () => {
    render(<AlertList {...notFound()} />);
    expect(within(rowsArea()).getByText(/Repository not found/)).toBeTruthy();
    expect(within(rowsArea()).getByRole('button', { name: 'Show all repositories' })).toBeTruthy();
    expect(screen.getByLabelText('Search alerts')).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.queryByText('No alerts match these filters.')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();     // never a page-level error
  });

  it('"Show all repositories" clears the repository', () => {
    const p = notFound();
    render(<AlertList {...p} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all repositories' }));
    expect(p.url.clearRepo).toHaveBeenCalledTimes(1);
  });

  // Revert: `onClick={() => url.clearRepo()}` (no flush): the typed search is applied after the repository is cleared, or dropped.
  it('"Show all repositories" applies the typed search first', () => {
    jest.useFakeTimers();
    try {
      const p = notFound();
      render(<AlertList {...p} />);
      fireEvent.change(screen.getByLabelText('Search alerts'), { target: { value: 'lodash' } });
      fireEvent.click(screen.getByRole('button', { name: 'Show all repositories' }));
      expect(p.list.setQuery).toHaveBeenCalledWith('lodash');
      expect((p.list.setQuery as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan((p.url.clearRepo as jest.Mock).mock.invocationCallOrder[0]);
    } finally { jest.useRealTimers(); }
  });

  it('is checked before loading and empty: the empty alerts slot of this state is not "No alerts match"', () => {
    const p = props({ alerts: slot<AlertsData>(undefined, { loading: true }), data: { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']> });
    render(<AlertList {...p} />);
    expect(screen.getByText(/Repository not found/)).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('pager and the page clamp', () => {
  it('shows the range, "Page X of Y" and reports Next / Previous through setPage', () => {
    const p = props({ rows: alAlertRows(10), total: 26, list: { page: 2 } });
    render(<AlertList {...p} />);
    expect(screen.getByTestId('alert-pager').textContent).toContain('11–20 of 26 alerts · counted per Dependabot alert, not per CVE');
    expect(screen.getByText('Page 2 of 3')).toBeTruthy();
    fireEvent.click(button(/Next/));
    expect(p.list.setPage).toHaveBeenLastCalledWith(3);
    fireEvent.click(button(/Previous/));
    expect(p.list.setPage).toHaveBeenLastCalledWith(1);
  });

  it('a page past the end (no rows, a total above 0) goes to the last page', () => {
    const p = props({ rows: [], total: 25, list: { page: 4 } });
    render(<AlertList {...p} />);
    expect(p.list.setPage).toHaveBeenCalledTimes(1);
    expect(p.list.setPage).toHaveBeenCalledWith(3);
  });

  it.each([
    ['page 1 with no results', props({ rows: [], total: 0, list: { page: 1 } })],
    ['page 3 with no results at all (a total of 0)', props({ rows: [], total: 0, list: { page: 3 } })],
    ['rows present on page 4', props({ rows: alAlertRows(5), total: 35, list: { page: 4 } })],
    ['an empty page 1 whose total is above 0', props({ rows: [], total: 25, list: { page: 1 } })],
    ['previous-key data still on screen (stale)', props({ alerts: slot(alertsFixture([], 25), { stale: true }), list: { page: 4 } })],
    ['a request still loading', props({ alerts: slot<AlertsData>(undefined), list: { page: 4 } })],
    ['an error', props({ alerts: slot<AlertsData>(undefined, ERR), list: { page: 4 } })],
  ])('does not clamp for %s', (_label, p) => {
    render(<AlertList {...p} />);
    expect(p.list.setPage).not.toHaveBeenCalled();
  });
});

describe('toolbar content', () => {
  it('has the search box with its placeholder, the Status select and the four toggles', () => {
    render(<AlertList {...props()} />);
    expect(screen.getByPlaceholderText('Search CVE, GHSA, package, repo')).toBeTruthy();
    expect(screen.getByLabelText('Status')).toBeTruthy();
    for (const name of ['Overdue', 'Due ≤ 7d', 'Reopened', 'Runtime only']) expect(button(name)).toBeTruthy();
  });

  it('marks the active toggles as pressed', () => {
    render(<AlertList {...props({ list: { reopened: true, runtimeOnly: true } })} />);
    expect(button('Reopened').getAttribute('aria-pressed')).toBe('true');
    expect(button('Runtime only').getAttribute('aria-pressed')).toBe('true');
    expect(button('Overdue').getAttribute('aria-pressed')).toBe('false');
  });
});

describe('table semantics (B1)', () => {
  // Revert: drop role="table" (or the rowgroups, rows or cells): the list is a pile of divs to a screen reader.
  it('the header and the rows form one table named "Alerts": a rowgroup of header cells, a rowgroup of rows of six cells', () => {
    render(<AlertList {...props({ rows: alAlertRows(3) })} />);
    const table = screen.getByRole('table', { name: 'Alerts' });
    const groups = within(table).getAllByRole('rowgroup');
    expect(groups).toHaveLength(2);
    // Header: one row of six column headers, each with its sort state.
    const head = within(groups[0]).getAllByRole('row');
    expect(head).toHaveLength(1);
    expect(head[0]).toBe(screen.getByTestId('alert-list-head'));
    const heads = within(head[0]).getAllByRole('columnheader');
    expect(heads).toHaveLength(6);
    for (const h of heads) expect(h.getAttribute('aria-sort')).toMatch(/^(none|ascending|descending)$/);
    // Body: the second rowgroup holds the rows (inside the 560px area), each row has six cells.
    expect(groups[1]).toBe(screen.getByTestId('alert-list-rowgroup'));
    expect(rowsArea().contains(groups[1])).toBe(true);
    const rows = within(groups[1]).getAllByRole('row');
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(within(r).getAllByRole('cell')).toHaveLength(6);
  });

  it('the wrapper keeps the column\'s gap between the header and the rows, so the 776px card still adds up', () => {
    render(<AlertList {...props()} />);
    const table = screen.getByRole('table', { name: 'Alerts' });
    expect(table.style.gap).toBe('12px');
    expect(table.contains(screen.getByTestId('alert-list-head'))).toBe(true);
    expect(table.contains(rowsArea())).toBe(true);
    expect(table.contains(screen.getByTestId('alert-pager'))).toBe(false);
  });

  it('the Sev header, whose label is an abbreviation, names what it sorts by in its title', () => {
    render(<AlertList {...props()} />);
    expect(screen.getByTestId('sort-severity').getAttribute('title')).toBe('Sort by severity');
  });

  // Revert: drop the sr-only suffix: a link that opens a new tab says nothing about it to a screen reader.
  it('the advisory link announces that it opens in a new tab, in text a sighted user never sees', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1)] })} />);
    const link = screen.getByRole('link', { name: 'CVE-2026-1001 (opens in a new tab)' });
    const hidden = link.querySelector('.sr-only');
    expect(hidden?.textContent).toBe(' (opens in a new tab)');
  });
});

describe('the rows rowgroup holds only rows (B1 follow-up)', () => {
  const notFound = { repoStatus: 'not-found', effectiveRepo: null } as Partial<SecurityViewProps['data']>;
  // Revert: put the overlays back inside the rowgroup: a table would own a message that is not a row.
  it.each([
    ['rows', props({ rows: alAlertRows(3) }), 3, null],
    ['loading', props({ alerts: slot<AlertsData>(undefined) }), 0, 'Loading…'],
    ['empty', props({ rows: [], total: 0 }), 0, 'No alerts match these filters.'],
    ['error', props({ alerts: slot<AlertsData>(undefined, ERR) }), 0, "Couldn't load alerts: HTTP 500"],
    ['unavailable', props({ alerts: slot<AlertsData>(undefined, { loading: false, unavailable: { available: false as const, reason: 'No sync yet' } }) }), 0, UNAVAILABLE_TEXT],
    ['repository not found', props({ alerts: noData(), data: notFound }), 0, 'Repository not found'],
  ])('%s: every child of the rowgroup is a row, and the message (if any) is a sibling inside the 560px area', (_label, p, rowCount, message) => {
    render(<AlertList {...p} />);
    const group = screen.getByTestId('alert-list-rowgroup');
    expect(group.getAttribute('role')).toBe('rowgroup');
    expect(Array.from(group.children).every(c => c.getAttribute('role') === 'row')).toBe(true);
    expect(group.children).toHaveLength(rowCount);
    if (message) {
      const el = within(rowsArea()).getByText(message, { exact: false });
      expect(group.contains(el)).toBe(false);
      expect(rowsArea().contains(el)).toBe(true);
    }
    // The 560px height and the dimming stay on the area, not on the rowgroup.
    expect(rowsArea().style.height).toBe(`${ALERT_LIST_H}px`);
    expect(group.style.height).toBe('');
  });
});

describe('State cell: the reopened glyph is outside the truncating text (B4)', () => {
  // Revert: put the glyph back inside the truncating span: a long "resolved · …" is cut and takes the glyph with it.
  it('the glyph is a sibling of the truncating text, shrink-0, so it shows however long the reason is', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { state: 'dismissed', dismissedReason: 'a_very_long_dismissal_reason_indeed', resolvedAt: '2026-09-03T08:00:00Z', dueDate: null, daysRemaining: null, reopenedCount: 1, lastReopenedAt: '2026-08-14T10:30:00Z' })] })} />);
    const text = screen.getByTestId('alert-state');
    const glyph = screen.getByTestId('alert-reopened');
    expect(text.className).toContain('truncate');
    expect(text.contains(glyph)).toBe(false);
    expect(glyph.className).toContain('shrink-0');
    expect(glyph.parentElement).toBe(text.parentElement);
    // The dates stay in the title and the aria-label.
    expect(glyph.getAttribute('aria-label')).toBe('reopened Aug 14');
    expect(text.getAttribute('title')).toContain('reopened');
  });

  it('the scope under the state carries its text as a title', () => {
    render(<AlertList {...props({ rows: [alAlertRow(1, { scope: 'development' })] })} />);
    expect(screen.getByText('development').getAttribute('title')).toBe('development');
  });

  // Revert: render the reason as it comes from the API.
  it.each([['auto_dismissed', 'auto dismissed'], ['no_bandwidth', 'no bandwidth'], ['tolerable_risk', 'tolerable risk'], ['fix_started', 'fix started']])(
    'the dismissal reason "%s" reads "resolved · %s"', (reason, words) => {
      render(<AlertList {...props({ rows: [alAlertRow(1, { state: 'dismissed', dismissedReason: reason, dueDate: null, daysRemaining: null })] })} />);
      expect(screen.getByTestId('alert-state').textContent).toBe(`resolved · ${words}`);
    });
});

describe('titles on truncating header text (B8)', () => {
  // Revert: drop the titles on the header's label and second line.
  it('each header\'s label and second line carry their text as a title', () => {
    render(<AlertList {...props()} />);
    const head = screen.getByTestId('alert-list-head');
    for (const [label, sub] of [['Advisory', 'CVSS · package'], ['Repository', 'owning team'], ['State', 'scope']]) {
      expect(within(head).getByText(label).getAttribute('title')).toBe(label);
      expect(within(head).getByText(sub).getAttribute('title')).toBe(sub);
    }
    expect(within(head).getByText('Age').getAttribute('title')).toBe('Age');
  });
});

describe('an unreadable SLA policy is red wherever the list says it (B3)', () => {
  const invalid = alSummary({ critical: 'invalid', high: 'invalid' });
  const markIn = (el: HTMLElement) => el.parentElement!.querySelector('[aria-hidden="true"]');

  // Revert: draw the hint grey for every state.
  it('the toolbar hint is bold red with the aria-hidden "!" beside it; any other state stays grey with no mark', () => {
    const { unmount } = render(<AlertList {...props({ summary: invalid })} />);
    const hint = screen.getByTestId('alert-sla-hint');
    expect(hint.textContent).toBe("SLA policy can't be read");
    expect(hint.className).toContain('text-red-400');
    expect(hint.className).toContain('font-bold');
    expect(hint.className).not.toContain('text-gray-500');
    expect(markIn(hint)?.textContent).toBe('!');
    unmount();
    render(<AlertList {...props({ summary: alSummary({ critical: 'none', high: 'none' }) })} />);
    const grey = screen.getByTestId('alert-sla-hint');
    expect(grey.className).toContain('text-gray-500');
    expect(grey.className).not.toContain('text-red-400');
    expect(markIn(grey)).toBeNull();
  });

  // Revert: keep the Due sub-line grey for the invalid state.
  it('an open alert\'s Due sub-line is bold red with the "!" mark; with a readable policy it stays grey', () => {
    const { unmount } = render(<AlertList {...props({ summary: invalid, rows: [alAlertRow(1, { dueDate: null, daysRemaining: null })] })} />);
    const sub = screen.getByTestId('alert-due-sub');
    expect(sub.textContent).toBe("SLA policy can't be read");
    expect(sub.className).toContain('text-red-400');
    expect(sub.className).toContain('font-bold');
    expect(markIn(sub)?.textContent).toBe('!');
    unmount();
    render(<AlertList {...props({ summary: alSummary({ critical: 'pending', high: 'pending' }), rows: [alAlertRow(1, { dueDate: null, daysRemaining: null })] })} />);
    const grey = screen.getByTestId('alert-due-sub');
    expect(grey.className).not.toContain('text-red-400');
    expect(markIn(grey)).toBeNull();
  });
});

describe('the refresh note (B12)', () => {
  // Revert: render the note only while the refresh has failed (a conditional mount): a screen reader misses it.
  it('is a live region that is in the page before it has text, and carries the error in its title', () => {
    const { rerender } = render(<AlertList {...props()} />);
    const note = screen.getByTestId('alert-refresh-note');
    expect(note.getAttribute('role')).toBe('status');
    expect(note.textContent).toBe('');
    rerender(<AlertList {...props({ alerts: slot(alertsFixture(alAlertRows(10), 10), { error: new Error('x'), errorText: "Couldn't load alerts: x" }) })} />);
    expect(screen.getByTestId('alert-refresh-note')).toBe(note);
    expect(note.textContent).toBe(REFRESH_FAILED_NOTE);
    expect(note.getAttribute('title')).toBe("Couldn't load alerts: x");
    expect(note.className).toContain('text-xs');
    expect(note.className).toContain('truncate');
  });
});

describe('header padding lives in HEAD_COPY (B15)', () => {
  // Revert: put a header's padding back in a key special case (or drop one entry's `pad`): Sev and Age lose their left padding rule, the rest keep px-2.5.
  it('Sev and Age drop their left padding, and every other header keeps px-2.5', () => {
    render(<AlertList {...props()} />);
    for (const k of ALERT_SORT_KEYS) {
      const cls = screen.getByTestId(`sort-${k}`).className.split(/\s+/);
      if (k === 'severity' || k === 'age') {
        expect(cls).toEqual(expect.arrayContaining(['pl-0', 'pr-2.5']));
        expect(cls).not.toContain('px-2.5');
      } else {
        expect(cls).toContain('px-2.5');
        expect(cls).not.toContain('pl-0');
      }
    }
  });
});

describe('the toolbar row\'s flexible text (B15)', () => {
  // Revert: drop shrink-0 from the note: the failure note shrinks with the SLA hint and is cut before it.
  it('the refresh note keeps its width while the SLA hint, which can truncate, gives way first', () => {
    render(<AlertList {...props({
      summary: alSummary({ critical: 'none', high: 'none' }),
      alerts: slot(alertsFixture(alAlertRows(3), 3), { error: new Error('x'), errorText: "Couldn't load alerts: x" }),
    })} />);
    const note = screen.getByTestId('alert-refresh-note').className.split(/\s+/);
    expect(note).toContain('shrink-0');
    const hint = screen.getByTestId('alert-sla-hint');
    expect(hint.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'truncate']));
    expect(hint.className.split(/\s+/)).not.toContain('shrink-0');
    expect(hint.parentElement!.className.split(/\s+/)).toContain('min-w-0');
  });
});

describe('the right end of toolbar row 2', () => {
  const row2 = () => screen.getByTestId('alert-toolbar-row2');
  const withNote = (extra: Record<string, unknown> = {}) => props({
    alerts: slot(alertsFixture(alAlertRows(3), 3), { error: new Error('x'), errorText: "Couldn't load alerts: x", ...extra }),
  });

  // Revert: put the `<span className="flex-1" />` spacer back before the note: it is a zero-width flex item that still costs one gap-2,
  // and with the SLA hint squeezed to 0 that 8px pushed the note 0.23px past the row's clip edge (1024px, light, classic scrollbar).
  it.each([
    ['no note and not stale', props()],
    ['a failed refresh', withNote()],
    ['stale', props({ alerts: slot(alertsFixture(alAlertRows(10), 26), { stale: true }) })],
    ['stale with a failed refresh', withNote({ stale: true })],
  ])('%s: no spacer item; the note takes the auto margin, so it and "Updating…" pack to the row\'s right edge', (_label, p) => {
    render(<AlertList {...p} />);
    const items = Array.from(row2().children);
    expect(items.some(el => el.className.split(/\s+/).includes('flex-1'))).toBe(false);
    const note = screen.getByTestId('alert-refresh-note');
    expect(note.className.split(/\s+/)).toEqual(expect.arrayContaining(['ml-auto', 'shrink-0']));
    // The note is the first right-end item; the only thing after it is "Updating…", when it shows.
    const after = items.slice(items.indexOf(note) + 1);
    expect(after.map(el => el.getAttribute('data-testid'))).toEqual(p.data.alerts.stale ? ['alert-updating'] : []);
    // Nothing before the note takes an auto margin (it would split the free space).
    expect(items.slice(0, items.indexOf(note)).some(el => el.className.split(/\s+/).includes('ml-auto'))).toBe(false);
  });
});

describe('toolbar focus (B6)', () => {
  // Revert: overflow-hidden on the toggle row: the toggles' focus rings are cut at the row's edge.
  it('the toggle row clips only sideways, so a focus ring is not cut above or below', () => {
    render(<AlertList {...props()} />);
    const row2 = screen.getByTestId('alert-toolbar-row2');
    const cls = row2.className.split(/\s+/);
    expect(cls).toContain('overflow-x-clip');
    expect(cls).not.toContain('overflow-hidden');
    expect(row2.style.height).toBe('32px');
  });

  // Revert: drop `pl-0.5`: the Overdue toggle sits flush at the clipped row's left edge and its 1px focus ring loses its left pixel.
  it('the row has 2px of room on the left for the first toggle\'s focus ring, and none on the right (the note still ends at the row\'s edge)', () => {
    render(<AlertList {...props()} />);
    const cls = screen.getByTestId('alert-toolbar-row2').className.split(/\s+/);
    expect(cls).toContain('pl-0.5');
    expect(cls.some(c => /^(px|pr)-/.test(c))).toBe(false);
    expect(screen.getByTestId('alert-toolbar-row2').firstElementChild).toBe(button('Overdue'));
    expect(screen.getByTestId('alert-toolbar-row2').lastElementChild).toBe(screen.getByTestId('alert-refresh-note'));
  });
});

describe('light theme', () => {
  // Revert: put the card-shell class on the list, a row, the header or a control: the light remap's border would resize a fixed-height row.
  it.each([
    ['populated', props()],
    ['no rows', props({ rows: [], total: 0 })],
    ['error', props({ alerts: slot<AlertsData>(undefined, ERR) })],
  ])('%s: nothing inside the list uses the card-shell class (bg-gray-900)', (_label, p) => {
    const { container } = render(<AlertList {...p} />);
    expect(container.querySelector('.bg-gray-900')).toBeNull();
  });
});
