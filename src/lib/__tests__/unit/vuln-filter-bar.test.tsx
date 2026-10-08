/** @jest-environment jsdom */
// src/lib/__tests__/unit/vuln-filter-bar.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react';
import FilterBar, { type FilterBarProps } from '@/app/vulnerabilities/filter-bar';
import { FILTER_BAR_H, SELECT_W, RESET_SLOT_W, BAR_ROW_H, FILTER_ROW_H, FILTER_SELECT_H, FILTER_ROW_GAP, FILTER_ROW_W, ALERTS_TAB_COUNT_W, Z } from '@/app/vulnerabilities/dimensions';

const DEFAULTS = { codebase: true, team: true, severity: true, baseline: true, repo: true, all: true };
const COUNTS = {
  backend: { critical: 5, high: 3 }, frontend: { critical: 2, high: 0 }, shared: { critical: 0, high: 0 },
  other: { critical: 1, high: 1 }, all: { critical: 8, high: 4 },
};

function props(over: Partial<FilterBarProps['url']> = {}, rest: Partial<FilterBarProps> = {}): FilterBarProps {
  return {
    url: {
      view: 'overview', codebase: 'backend', team: null, severity: 'both', baseline: 'last', isDefault: DEFAULTS,
      setView: jest.fn(), setCodebase: jest.fn(), setTeam: jest.fn(), setSeverity: jest.fn(), setBaseline: jest.fn(), resetFilters: jest.fn(),
      ...over,
    },
    teams: ['Payments', 'Search', 'Unassigned'],
    codebaseCounts: COUNTS,
    alertsCount: 13,
    baselinePrefill: '2026-09-08',
    ...rest,
  };
}

describe('layout stability', () => {
  it('every select has a fixed inline width, is shrink-0, truncates and carries a title', () => {
    render(<FilterBar {...props({ team: 'A very long owning team name that cannot fit in 170 pixels' })} />);
    const expected: Array<[string, number]> = [
      ['Codebase', SELECT_W.codebase], ['Owning team', SELECT_W.team], ['Severity', SELECT_W.severity], ['Compare to', SELECT_W.baseline],
    ];
    for (const [label, width] of expected) {
      const el = screen.getByLabelText(label) as HTMLSelectElement;
      expect(el.style.width).toBe(`${width}px`);
      expect(el.className).toContain('shrink-0');
      expect(el.className).toContain('truncate');
      expect(el.getAttribute('title')).toBeTruthy();
    }
    expect(screen.getByLabelText('Owning team').getAttribute('title')).toBe('A very long owning team name that cannot fit in 170 pixels');
  });

  it('the bar keeps the same height, the same slot classes and the same slot widths whether Reset and the date input are hidden or shown', () => {
    const hidden = render(<FilterBar {...props()} />);
    const bar1 = screen.getByTestId('security-bar');
    const snap = () => ({
      barHeight: screen.getByTestId('security-bar').style.height,
      rowHeights: Array.from(screen.getByTestId('security-bar').children).map(c => (c as HTMLElement).style.height),
      resetClass: screen.getByTestId('reset-slot').className,
      resetWidth: (screen.getByTestId('reset-slot') as HTMLElement).style.width,
      dateClass: screen.getByTestId('date-slot').className,
      dateWidth: (screen.getByTestId('date-slot') as HTMLElement).style.width,
      // Hidden, not removed: both controls exist in every state.
      hasResetButton: !!screen.queryByText('Reset filters'),
      hasDateInput: !!screen.queryByLabelText('Compare to date'),
    });
    const before = snap();
    expect(before.barHeight).toBe(`${FILTER_BAR_H}px`);
    expect(before.rowHeights).toEqual([`${BAR_ROW_H}px`, `${FILTER_ROW_H}px`]);
    expect(before.resetWidth).toBe(`${RESET_SLOT_W}px`);
    expect(before.dateWidth).toBe(`${SELECT_W.date}px`);
    expect([before.hasResetButton, before.hasDateInput]).toEqual([true, true]);
    expect(bar1).toBeTruthy();
    hidden.unmount();

    render(<FilterBar {...props({
      codebase: 'frontend', team: 'Payments', severity: 'high', baseline: '2026-09-15',
      isDefault: { codebase: false, team: false, severity: false, baseline: false, repo: true, all: false },
    })} />);
    expect(snap()).toEqual(before);
  });

  // Revert: put `h-7` back on the select class: the height is a Tailwind class, not the dimensions.ts number the tests compare.
  it('every select and the date input take their height from FILTER_SELECT_H, inline, not from a utility class', () => {
    render(<FilterBar {...props({ baseline: '2026-09-15', isDefault: { ...DEFAULTS, baseline: false, all: false } })} />);
    for (const el of [...['Codebase', 'Owning team', 'Severity', 'Compare to'].map(l => screen.getByLabelText(l)), screen.getByLabelText('Compare to date')]) {
      expect((el as HTMLElement).style.height).toBe(`${FILTER_SELECT_H}px`);
      expect(el.className.split(' ')).not.toContain('h-7');
    }
  });

  // Revert: drop the border or the box-border class: the rule either vanishes or grows the row to 37px and the bar to 95.
  it('a 1px rule under the tabs sits inside the tabs row, which keeps BAR_ROW_H, so the bar total stays FILTER_BAR_H', () => {
    render(<FilterBar {...props()} />);
    const bar = screen.getByTestId('security-bar');
    const tabsRow = bar.children[0] as HTMLElement;
    expect(tabsRow.style.borderBottom).toMatch(/^1px solid/);
    expect(tabsRow.className).toContain('box-border');
    expect(tabsRow.style.height).toBe(`${BAR_ROW_H}px`);
    expect(bar.style.height).toBe(`${FILTER_BAR_H}px`);
  });

  // Revert: put the `flex-1` spacer back before the Reset slot: the row then has six gaps, and FILTER_ROW_W (five) understates it by 8px.
  it('the filter row is exactly FILTER_ROW_W wide: its children plus the gaps between them, as rendered', () => {
    render(<FilterBar {...props()} />);
    const row = screen.getByTestId('security-bar').children[1] as HTMLElement;
    const widthOf = (el: HTMLElement) => {
      const w = el.style.width || (el.querySelector('select') as HTMLElement | null)?.style.width;
      expect(w).toBeTruthy();   // a child with no fixed width (a spacer) would make the row's fit unknowable
      return parseInt(w as string, 10);
    };
    const kids = Array.from(row.children) as HTMLElement[];
    expect(kids).toHaveLength(6);
    const total = kids.reduce((n, el) => n + widthOf(el), 0) + (kids.length - 1) * FILTER_ROW_GAP;
    expect(total).toBe(FILTER_ROW_W);
    expect(row.style.gap).toBe(`${FILTER_ROW_GAP}px`);
    expect(screen.getByTestId('reset-slot').className).toContain('ml-auto');
  });

  it('is sticky at the top with the body background variable and a z-index between pinned rows and the drawer', () => {
    render(<FilterBar {...props()} />);
    const bar = screen.getByTestId('security-bar');
    expect(bar.style.position).toBe('sticky');
    expect(bar.style.top).toBe('0px');
    expect(bar.style.zIndex).toBe(String(Z.stickyBar));
    expect(bar.getAttribute('style')).toContain('background: var(--body-bg, #0F0F0F)');
  });
});

describe('Owning team options', () => {
  // Revert: list only `teams`: a ?team= the summary has not listed (yet) leaves the select with no matching option, so it shows the first one.
  it('a team from the URL that is not in the list yet still has an option, so the select shows it', () => {
    render(<FilterBar {...props({ team: 'Growth', isDefault: { ...DEFAULTS, team: false, all: false } }, { teams: [] })} />);
    const select = screen.getByLabelText('Owning team') as HTMLSelectElement;
    expect(select.value).toBe('Growth');
    expect(within(select).getAllByRole('option').map(o => o.textContent)).toEqual(['All owning teams', 'Growth']);
  });

  it('a listed team is not duplicated', () => {
    render(<FilterBar {...props({ team: 'Search', isDefault: { ...DEFAULTS, team: false, all: false } })} />);
    expect(within(screen.getByLabelText('Owning team')).getAllByRole('option').map(o => o.textContent)).toEqual(['All owning teams', 'Payments', 'Search', 'Unassigned']);
  });
});

describe('field captions', () => {
  // Revert: delete a <label htmlFor> (or its `uppercase` class), or put the "Compare to" span back inline.
  it('every select sits under a visible caption that is its accessible name, upper-cased by CSS (the DOM text stays sentence case)', () => {
    render(<FilterBar {...props()} />);
    for (const name of ['Codebase', 'Owning team', 'Severity', 'Compare to']) {
      const caption = screen.getByText(name, { selector: 'label' });
      expect(caption.className).toContain('uppercase');
      expect(caption.className).toContain('text-[10.5px]');
      const select = screen.getByLabelText(name) as HTMLSelectElement;
      expect(select.tagName).toBe('SELECT');
      expect(caption.getAttribute('for')).toBe(select.id);
      // The caption is above the select inside one field.
      expect(caption.parentElement).toBe(select.parentElement);
      expect(caption.compareDocumentPosition(select) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('"Compare to" is a caption only: there is no second, inline "Compare to" text', () => {
    render(<FilterBar {...props()} />);
    expect(screen.getAllByText('Compare to')).toHaveLength(1);
  });
});

describe('Reset filters', () => {
  it('stays in the DOM but hidden (invisible, disabled, out of the tab order) when every filter is at its default', () => {
    render(<FilterBar {...props()} />);
    const btn = screen.getByText('Reset filters') as HTMLButtonElement;
    expect(btn.className).toContain('invisible');
    expect(btn.disabled).toBe(true);
    expect(btn.tabIndex).toBe(-1);
    expect(btn.getAttribute('aria-hidden')).toBe('true');
  });

  it('is visible when any filter differs and calls resetFilters', () => {
    const resetFilters = jest.fn();
    render(<FilterBar {...props({ resetFilters, isDefault: { ...DEFAULTS, team: false, all: false }, team: 'Payments' })} />);
    const btn = screen.getByText('Reset filters') as HTMLButtonElement;
    expect(btn.className).not.toContain('invisible');
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(resetFilters).toHaveBeenCalledTimes(1);
  });

  // Revert: move the slot back into the tabs row.
  it('sits at the right end of the filter row, after the date slot, and reads as a link', () => {
    render(<FilterBar {...props({ isDefault: { ...DEFAULTS, team: false, all: false }, team: 'Payments' })} />);
    const bar = screen.getByTestId('security-bar');
    const filterRow = bar.children[1] as HTMLElement;
    const slot = screen.getByTestId('reset-slot');
    expect(filterRow.contains(slot)).toBe(true);
    expect(filterRow.lastElementChild).toBe(slot);
    expect(screen.getByTestId('date-slot').compareDocumentPosition(slot) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Reset filters').className).toContain('underline');
  });

  // Revert: drop the focus call: once the button hides itself, focus falls to the page body and a keyboard user loses their place.
  it('moves focus to the Codebase select, since the button hides itself when the filters are default again', () => {
    render(<FilterBar {...props({ isDefault: { ...DEFAULTS, team: false, all: false }, team: 'Payments' })} />);
    const btn = screen.getByText('Reset filters');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(document.activeElement).toBe(screen.getByLabelText('Codebase'));
  });

  it('appears when only the selected repository differs (Reset clears it too)', () => {
    render(<FilterBar {...props({ isDefault: { ...DEFAULTS, repo: false, all: false } })} />);
    expect((screen.getByText('Reset filters') as HTMLButtonElement).className).not.toContain('invisible');
  });
});

describe('accent treatment', () => {
  it('a non-default select gets the accent border, fill and text; a default one gets none of them', () => {
    render(<FilterBar {...props({ codebase: 'frontend', isDefault: { ...DEFAULTS, codebase: false, all: false } })} />);
    const changed = screen.getByLabelText('Codebase').className;
    expect(changed).toContain('border-accent');
    expect(changed).toContain('bg-accent-bg');
    expect(changed).toContain('text-accent-light');
    expect(changed).not.toContain('bg-chart-surface');
    const plain = screen.getByLabelText('Severity').className;
    expect(plain).not.toContain('border-accent');
    expect(plain).not.toContain('bg-accent-bg');
    expect(plain).toContain('bg-chart-surface');
  });
});

describe('Codebase options', () => {
  // Revert: sum critical and high again, or drop the unit.
  it('show the kSev count with its unit: "open crit" under Critical + high and Critical only, "open high" under High only', () => {
    const { rerender } = render(<FilterBar {...props()} />);
    expect(screen.getByRole('option', { name: 'Backend · 5 open crit' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'All · 8 open crit' })).toBeTruthy();
    rerender(<FilterBar {...props({ severity: 'critical' })} />);
    expect(screen.getByRole('option', { name: 'Backend · 5 open crit' })).toBeTruthy();
    rerender(<FilterBar {...props({ severity: 'high' })} />);
    expect(screen.getByRole('option', { name: 'Backend · 3 open high' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'All · 4 open high' })).toBeTruthy();
  });

  it('show the label alone while the counts have not loaded', () => {
    render(<FilterBar {...props({}, { codebaseCounts: undefined })} />);
    expect(screen.getByRole('option', { name: 'Backend' })).toBeTruthy();
  });
});

describe('controls call the url handlers', () => {
  it('Codebase, Owning team and Severity', () => {
    const url = props().url;
    render(<FilterBar {...props({}, {})} url={url} />);
    fireEvent.change(screen.getByLabelText('Codebase'), { target: { value: 'frontend' } });
    expect(url.setCodebase).toHaveBeenCalledWith('frontend');
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: 'Search' } });
    expect(url.setTeam).toHaveBeenCalledWith('Search');
    fireEvent.change(screen.getByLabelText('Owning team'), { target: { value: '' } });
    expect(url.setTeam).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'high' } });
    expect(url.setSeverity).toHaveBeenCalledWith('high');
  });

  it('lists the severity choices as Critical + high / Critical only / High only', () => {
    render(<FilterBar {...props()} />);
    const sev = screen.getByLabelText('Severity');
    expect(within(sev).getAllByRole('option').map(o => o.textContent)).toEqual(['Critical + high', 'Critical only', 'High only']);
  });

  it('lists the Compare to choices as Last sync / 7 days ago / 30 days ago / A date…', () => {
    render(<FilterBar {...props()} />);
    const compare = screen.getByLabelText('Compare to');
    expect(within(compare).getAllByRole('option').map(o => o.textContent)).toEqual(['Last sync', '7 days ago', '30 days ago', 'A date…']);
  });
});

describe('Compare to', () => {
  it('7 days and 30 days write the preset; the date input stays hidden', () => {
    const url = props().url;
    render(<FilterBar {...props({}, {})} url={url} />);
    fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: '7d' } });
    expect(url.setBaseline).toHaveBeenCalledWith('7d');
    expect(screen.getByLabelText('Compare to date').className).toContain('invisible');
    expect((screen.getByLabelText('Compare to date') as HTMLInputElement).disabled).toBe(true);
  });

  it('"A date…" immediately writes the pre-filled date, so the select cannot snap back', () => {
    const url = props().url;
    render(<FilterBar {...props({}, { baselinePrefill: '2026-09-08' })} url={url} />);
    fireEvent.change(screen.getByLabelText('Compare to'), { target: { value: 'date' } });
    expect(url.setBaseline).toHaveBeenCalledWith('2026-09-08');
  });

  it('with a date baseline the select reads "A date…" and the date input is visible, enabled and filled', () => {
    render(<FilterBar {...props({ baseline: '2026-09-15', isDefault: { ...DEFAULTS, baseline: false, all: false } })} />);
    expect((screen.getByLabelText('Compare to') as HTMLSelectElement).value).toBe('date');
    const input = screen.getByLabelText('Compare to date') as HTMLInputElement;
    expect(input.value).toBe('2026-09-15');
    expect(input.className).not.toContain('invisible');
    expect(input.disabled).toBe(false);
    expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  // Revert: read the day from toISOString() (UTC) again: for a user west of UTC in the evening, the picker would allow tomorrow.
  it('the date input\'s max is the browser\'s own calendar day (local date parts), not the UTC day', () => {
    // Local clock says 2026-10-08, the UTC clock already says the 9th (a user in the evening, west of UTC).
    jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
    jest.spyOn(Date.prototype, 'getMonth').mockReturnValue(9);
    jest.spyOn(Date.prototype, 'getDate').mockReturnValue(8);
    jest.spyOn(Date.prototype, 'toISOString').mockReturnValue('2026-10-09T03:00:00.000Z');
    try {
      render(<FilterBar {...props({ baseline: '2026-09-15', isDefault: { ...DEFAULTS, baseline: false, all: false } })} />);
      expect((screen.getByLabelText('Compare to date') as HTMLInputElement).max).toBe('2026-10-08');
    } finally {
      jest.restoreAllMocks();
    }
  });

  it('changing the date writes it; clearing the input is ignored', () => {
    const url = props({ baseline: '2026-09-15', isDefault: { ...DEFAULTS, baseline: false, all: false } }).url;
    render(<FilterBar {...props({}, {})} url={url} />);
    const input = screen.getByLabelText('Compare to date');
    fireEvent.change(input, { target: { value: '2026-09-01' } });
    expect(url.setBaseline).toHaveBeenCalledWith('2026-09-01');
    (url.setBaseline as jest.Mock).mockClear();
    fireEvent.change(input, { target: { value: '' } });
    expect(url.setBaseline).not.toHaveBeenCalled();
  });
});

describe('view tabs', () => {
  it('shows Overview and Alerts with the open count, marks the active tab and calls setView on click', () => {
    const url = props({ view: 'alerts' }).url;
    render(<FilterBar {...props({}, { alertsCount: 1234 })} url={url} />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const alerts = screen.getByRole('tab', { name: /^Alerts/ });
    expect(alerts.getAttribute('aria-selected')).toBe('true');
    expect(overview.getAttribute('aria-selected')).toBe('false');
    expect(screen.getByTestId('alerts-tab-count').textContent).toBe('1,234 open');
    fireEvent.click(overview);
    expect(url.setView).toHaveBeenCalledWith('overview');
  });

  it('keeps the count slot (with a minimum width) while the count is unknown', () => {
    render(<FilterBar {...props({}, { alertsCount: null })} />);
    const slot = screen.getByTestId('alerts-tab-count');
    expect(slot.textContent).toBe('');
    expect(slot.style.minWidth).toBe(`${ALERTS_TAB_COUNT_W}px`);
  });

  // Revert: render every tab with tabIndex 0 (or drop the attribute).
  it('uses a roving tabindex: the selected tab is in the tab order, the other is not', () => {
    const { rerender } = render(<FilterBar {...props({ view: 'overview' })} />);
    expect([screen.getByRole('tab', { name: 'Overview' }).tabIndex, screen.getByRole('tab', { name: /^Alerts/ }).tabIndex]).toEqual([0, -1]);
    rerender(<FilterBar {...props({ view: 'alerts' })} />);
    expect([screen.getByRole('tab', { name: 'Overview' }).tabIndex, screen.getByRole('tab', { name: /^Alerts/ }).tabIndex]).toEqual([-1, 0]);
  });

  // Revert: delete the keydown handler, or call onChange from it (automatic activation would push a history entry per arrow press).
  it('ArrowLeft, ArrowRight, Home and End move focus between the tabs (wrapping) and never change the view', () => {
    const url = props({ view: 'overview' }).url;
    render(<FilterBar {...props({}, {})} url={url} />);
    const overview = screen.getByRole('tab', { name: 'Overview' });
    const alerts = screen.getByRole('tab', { name: /^Alerts/ });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(alerts);
    fireEvent.keyDown(alerts, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(overview);   // wraps
    fireEvent.keyDown(overview, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(alerts);     // wraps the other way
    fireEvent.keyDown(alerts, { key: 'Home' });
    expect(document.activeElement).toBe(overview);
    fireEvent.keyDown(overview, { key: 'End' });
    expect(document.activeElement).toBe(alerts);
    expect(url.setView).not.toHaveBeenCalled();
  });

  // Revert: preventDefault Enter and Space too: a button's own activation would stop working.
  it('Enter and Space are left to the button, which activates the focused tab (manual activation); the arrows are not', () => {
    render(<FilterBar {...props()} />);
    const alerts = screen.getByRole('tab', { name: /^Alerts/ });
    alerts.focus();
    expect(alerts.tagName).toBe('BUTTON');
    expect(fireEvent.keyDown(alerts, { key: 'Enter' })).toBe(true);    // not default-prevented
    expect(fireEvent.keyDown(alerts, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(alerts, { key: 'ArrowRight' })).toBe(false);   // prevented: no page scroll
  });
});
